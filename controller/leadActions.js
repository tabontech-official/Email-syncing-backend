/*
|--------------------------------------------------------------------------
| Per-lead actions from the inbox context menu
|--------------------------------------------------------------------------
|
| Archiving and re-running a scenario against one lead. Both act on a
| single email the caller owns; ownership is re-checked here rather than
| trusted from the request, because an email id is guessable and the
| inbox is the one place a user's own leads are addressable by id.
|
| Read/unread deliberately lives on the client. The unread dot, the
| sidebar badge and the "mark as read on open" behaviour all already read
| one store (localStorage readEmailIds), and adding a second source of
| truth on the server would let the two disagree — a row showing unread
| with a badge that says zero. Moving read state to the server is a
| worthwhile change, but it is a migration of all three, not a fourth
| writer bolted on here.
*/

import mongoose from 'mongoose';
import { EmailModel } from '../Models/Email.js';
import { scenarioModel } from '../Models/Scenario.js';
import { executeScenarios } from './smtpServer.js';
import { findMatchingScenario } from '../utils/scenarioMatch.js';
import { loadPlatformRules } from '../utils/platformScenarioConfig.js';

/* The email, if it exists and this caller owns it. */
const loadOwnedEmail = async (req, res) => {
  const { emailId } = req.params;

  if (!mongoose.Types.ObjectId.isValid(emailId)) {
    res.status(400).json({ success: false, message: 'Invalid email id' });
    return null;
  }

  const email = await EmailModel.findById(emailId);

  if (!email) {
    res.status(404).json({ success: false, message: 'Email not found' });
    return null;
  }

  const authUserId = String(
    req.user?._id || req.user?.id || req.user?.userId || ''
  );

  if (
    !authUserId ||
    (String(email.userId) !== authUserId && req.user?.role !== 'admin')
  ) {
    res.status(403).json({
      success: false,
      message: "Forbidden: that lead belongs to another user",
    });
    return null;
  }

  return email;
};

/*
 * PATCH /mailhook/lead-archive/:emailId   { archived: true | false }
 */
export const setLeadArchived = async (req, res) => {
  try {
    const email = await loadOwnedEmail(req, res);
    if (!email) return;

    const archived = Boolean(req.body?.archived);

    /*
     * The whole thread moves together. Archiving a root and leaving its
     * replies in the inbox would split one conversation across two
     * places, and the inbox lists threads, not messages.
     */
    const threadKey =
      email.conversationId || email.providerThreadId || email.threadId || null;

    const scope = threadKey
      ? {
          userId: email.userId,
          $or: [
            { _id: email._id },
            { conversationId: threadKey },
            { providerThreadId: threadKey },
            { threadId: threadKey },
            { rootEmailId: email._id },
          ],
        }
      : { _id: email._id };

    const result = await EmailModel.updateMany(scope, {
      $set: { isArchived: archived },
    });

    return res.status(200).json({
      success: true,
      archived,
      updated: result.modifiedCount,
    });
  } catch (err) {
    console.error('❌ setLeadArchived error:', err);
    return res
      .status(500)
      .json({ success: false, message: 'Could not update the lead' });
  }
};

/*
 * POST /mailhook/lead-process-scenario/:emailId
 *
 * Run the automation against one lead on demand — for a lead that arrived
 * before the scenario was finished, one whose reply failed, or one the
 * user held back and now wants answered.
 *
 * This is an explicit instruction, so it bypasses the once-only execution
 * lock that stops the mail listeners double-replying. That means it CAN
 * send a second reply to a lead that already got one, which is exactly
 * what "process this again" has to mean — the caller is told the lead was
 * already processed so the confirmation can say so.
 */
export const processLeadScenario = async (req, res) => {
  try {
    const email = await loadOwnedEmail(req, res);
    if (!email) return;

    /*
     * Run only the scenario this lead was recognised by. Letting every
     * scenario evaluate would fire replies from scenarios that already
     * ran against this message when it arrived.
     */
    const targetScenarioId = email.matchedScenarioId || null;
    let scenario = null;

    if (targetScenarioId) {
      scenario = await scenarioModel.findById(targetScenarioId).lean();
    }

    /*
     * Mail that arrived before matchedScenarioId was being stamped has no
     * link to work from, and it is exactly the mail someone reaches for
     * this action to deal with. Fall back to the same matcher the inbox
     * filter uses, so an unstamped lead resolves to the scenario that
     * would have claimed it.
     */
    if (!scenario) {
      const rules = await loadPlatformRules();
      const scenarios = await scenarioModel.find({ userId: email.userId }).lean();

      scenario = findMatchingScenario(
        scenarios,
        {
          subject: email.subject,
          textBody: email.textBody || email.htmlBody || '',
          senderAddress: email.senderAddress,
        },
        rules
      );
    }

    if (!scenario) {
      return res.status(409).json({
        success: false,
        message:
          "This lead does not meet any of your scenarios' criteria, so there is nothing to run against it.",
      });
    }

    if (scenario.scenarioActive === false) {
      return res.status(409).json({
        success: false,
        message: `"${scenario.name}" is switched off. Switch it on first, then run it against this lead.`,
      });
    }

    const alreadyProcessed = email.scenarioExecuted === true;

    /*
     * It is being handled right now, so it is no longer waiting on the
     * paused queue — otherwise resuming the scenario later would reply to
     * it a second time.
     */
    if (email.queuedForScenarioId) {
      await EmailModel.updateOne(
        { _id: email._id },
        { $set: { queuedForScenarioId: null, queuedAt: null } }
      );
    }

    await executeScenarios({
      userId: email.userId,
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

    return res.status(200).json({
      success: true,
      scenarioName: scenario.name,
      /*
       * Whether this lead had already been through the scenario once.
       * Reported rather than blocked — re-running is the point — but the
       * caller should be able to say "sent again", not just "sent".
       */
      alreadyProcessed,
      message: alreadyProcessed
        ? `Ran "${scenario.name}" again against this lead.`
        : `Ran "${scenario.name}" against this lead.`,
    });
  } catch (err) {
    console.error('❌ processLeadScenario error:', err);
    return res.status(500).json({
      success: false,
      message: 'The scenario could not be run against this lead.',
    });
  }
};
