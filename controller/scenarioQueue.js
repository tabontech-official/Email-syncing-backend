/*
|--------------------------------------------------------------------------
| Paused-scenario queue
|--------------------------------------------------------------------------
|
| Switching a scenario Off stops it replying. It does not stop leads
| arriving: they keep syncing in and keep landing in the Lead Inbox,
| they just go unanswered.
|
| executeScenarios() records each of those on the email itself
| (queuedForScenarioId), so there is an exact list of the messages the
| automation WOULD have answered while it was paused. This module reads
| that list and acts on it.
|
| Switching the scenario back on is the decision point, and it is the
| user's decision, not ours:
|
|   - send    replay each queued message through the scenario it was
|             queued for, so the backlog gets the replies it missed
|   - discard clear the queue and answer nothing
|
| Discarding never deletes the emails. They are still real leads and
| still belong in the inbox — only the intent to auto-reply is dropped.
|
| WHY A BATCH CAP
|
| A backlog can be arbitrarily large, and this runs under a request
| timeout. So a release processes at most RELEASE_BATCH messages and
| reports how many are left; the caller repeats until `remaining` is 0.
| The cap is reported, never silent — a half-sent backlog that claimed to
| be finished would be worse than a slow one.
*/

import mongoose from 'mongoose';
import { EmailModel } from '../Models/Email.js';
import { scenarioModel } from '../Models/Scenario.js';
import { executeScenarios } from './smtpServer.js';
import { isOwnerOrAdmin } from '../middleware/authmiddleware.js';

const RELEASE_BATCH = 25;
const PREVIEW_LIMIT = 5;

/* Shared lookup: the scenario, if it exists and the caller may touch it. */
const loadOwnedScenario = async (req, res) => {
  const { id } = req.params;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    res.status(400).json({ success: false, message: 'Invalid scenario id' });
    return null;
  }

  const scenario = await scenarioModel.findById(id);

  if (!scenario) {
    res.status(404).json({ success: false, message: 'Scenario not found' });
    return null;
  }

  if (!isOwnerOrAdmin(req, scenario.userId)) {
    res.status(403).json({
      success: false,
      message: 'Forbidden: this scenario belongs to another user',
    });
    return null;
  }

  return scenario;
};

/*
 * GET /scenario/:id/queue
 *
 * What is waiting, so the resume prompt can state a real number and show
 * what it is about to answer.
 */
export const getScenarioQueue = async (req, res) => {
  try {
    const scenario = await loadOwnedScenario(req, res);
    if (!scenario) return;

    const filter = { queuedForScenarioId: scenario._id, isDeleted: { $ne: true } };

    const [count, preview] = await Promise.all([
      EmailModel.countDocuments(filter),
      EmailModel.find(filter)
        .sort({ queuedAt: 1 })
        .limit(PREVIEW_LIMIT)
        .select('subject senderAddress senderFirstName senderLastName date queuedAt')
        .lean(),
    ]);

    return res.status(200).json({
      success: true,
      scenarioId: scenario._id,
      scenarioName: scenario.name,
      scenarioActive: scenario.scenarioActive !== false,
      count,
      /* Only the first few — the prompt needs a sample, not the backlog. */
      preview: preview.map((email) => ({
        _id: email._id,
        subject: email.subject || '(no subject)',
        from: email.senderAddress || '',
        name:
          [email.senderFirstName, email.senderLastName].filter(Boolean).join(' ') ||
          '',
        receivedAt: email.date || email.queuedAt || null,
      })),
      previewTruncated: count > preview.length,
    });
  } catch (err) {
    console.error('❌ getScenarioQueue error:', err);
    return res
      .status(500)
      .json({ success: false, message: 'Could not read the queue' });
  }
};

/*
 * POST /scenario/:id/queue   { action: 'send' | 'discard' }
 */
export const releaseScenarioQueue = async (req, res) => {
  try {
    const action = String(req.body?.action || '').toLowerCase();

    if (!['send', 'discard'].includes(action)) {
      return res.status(400).json({
        success: false,
        message: "action must be 'send' or 'discard'",
      });
    }

    const scenario = await loadOwnedScenario(req, res);
    if (!scenario) return;

    const filter = { queuedForScenarioId: scenario._id, isDeleted: { $ne: true } };

    if (action === 'discard') {
      /*
       * Emails stay; only the pending-reply intent is cleared. They were
       * genuine leads and the user may still answer them by hand.
       */
      const result = await EmailModel.updateMany(filter, {
        $set: { queuedForScenarioId: null, queuedAt: null },
      });

      console.log(
        `🗑️ Discarded ${result.modifiedCount} queued lead(s) for scenario "${scenario.name}".`
      );

      return res.status(200).json({
        success: true,
        action: 'discard',
        discarded: result.modifiedCount,
        remaining: 0,
      });
    }

    /*
     * Sending requires the scenario to be running. Replaying into a
     * scenario that is still Off would hit the same Off check inside
     * executeScenarios() and re-queue every message — a no-op that
     * reports success. Refuse instead and say why.
     */
    if (scenario.scenarioActive === false) {
      return res.status(409).json({
        success: false,
        message:
          'Switch the scenario on before sending its queued replies — a paused scenario would hold them again.',
      });
    }

    const batch = await EmailModel.find(filter)
      .sort({ queuedAt: 1 })
      .limit(RELEASE_BATCH)
      .lean();

    let sent = 0;
    let failed = 0;

    for (const email of batch) {
      /*
       * Claim first. Clearing queuedForScenarioId is the claim: a second
       * concurrent release will not find this message, so it cannot send
       * a duplicate reply. Losing the race is not an error, just a skip.
       */
      const claimed = await EmailModel.findOneAndUpdate(
        { _id: email._id, queuedForScenarioId: scenario._id },
        { $set: { queuedForScenarioId: null, queuedAt: null } }
      );

      if (!claimed) continue;

      try {
        await executeScenarios({
          userId: scenario.userId,
          from: email.senderAddress,
          subject: email.subject,
          body: email.textBody || email.htmlBody || '',
          emailId: String(email._id),
          parsedEmailObj: {
            text: email.textBody || '',
            html: email.htmlBody || '',
            subject: email.subject || '',
            from: email.senderAddress || '',
            messageId: email.messageId || email.rfcMessageId || '',
          },
          onlyScenarioId: scenario._id,
          replayQueued: true,
        });

        sent += 1;
      } catch (err) {
        failed += 1;
        console.error(
          `❌ Queue replay failed for email ${email._id}:`,
          err.message
        );

        /*
         * Put it back. A message that failed to send is still owed a
         * reply, and dropping it here would lose it silently.
         */
        await EmailModel.updateOne(
          { _id: email._id, queuedForScenarioId: null },
          {
            $set: {
              queuedForScenarioId: scenario._id,
              queuedAt: email.queuedAt || new Date(),
            },
          }
        );
      }
    }

    const remaining = await EmailModel.countDocuments(filter);

    console.log(
      `📤 Released ${sent} queued lead(s) for scenario "${scenario.name}" (${failed} failed, ${remaining} still queued).`
    );

    return res.status(200).json({
      success: true,
      action: 'send',
      sent,
      failed,
      /*
       * Anything the batch cap left behind, plus anything that failed and
       * went back on the queue. The caller repeats while this is > 0.
       */
      remaining,
      batchSize: RELEASE_BATCH,
    });
  } catch (err) {
    console.error('❌ releaseScenarioQueue error:', err);
    return res
      .status(500)
      .json({ success: false, message: 'Could not process the queue' });
  }
};
