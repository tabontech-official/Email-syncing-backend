import { authModel } from '../Models/auth.js';
import { mailhookModel } from '../Models/MailhookSchema.js';
import { validationModel } from '../Models/ValidationEmail.js';
import { EmailModel } from '../Models/Email.js';
import mongoose from 'mongoose';
import { isOwnerOrAdmin, getAuthUserId } from '../middleware/authmiddleware.js';

/*
 * Every user gets `<userId>@mail.replexengine.com` at signup, but accounts
 * created before that field existed (and some social-login paths) never got
 * one. The mailhook webhook resolves the owner by looking this address up,
 * so a user without it can never receive forwarded mail. Generate it on
 * demand instead of refusing to start the connection.
 */
const MAILHOOK_DOMAIN = 'mail.replexengine.com';

const ensureUserMailhook = async (user) => {
  if (user.mailhook) return user.mailhook;

  const address = `${user._id}@${MAILHOOK_DOMAIN}`.toLowerCase();
  await authModel.findByIdAndUpdate(user._id, { mailhook: address });
  user.mailhook = address;

  return address;
};

export const addMailhookCard = async (req, res) => {
  try {
    const authUserId = getAuthUserId(req);
    const userId = req.body.userId || authUserId;

    if (!isOwnerOrAdmin(req, userId)) {
      return res.status(403).json({ success: false, message: "Forbidden: Cannot create mailhook card for another user" });
    }

    const user = await authModel.findById(userId).select('mailhook email');

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    const mailhook = await ensureUserMailhook(user);
    const forwardingEmail = (req.body.forwardingEmail || '').trim().toLowerCase();

    /*
     * Step 1 of the setup modal posts here every time it is opened. Without
     * this, abandoning the flow and starting again leaves a trail of empty,
     * unverified cards on the connections page. Reuse the draft card the
     * user already has instead of stacking another one.
     */
    if (!forwardingEmail) {
      const draft = await mailhookModel
        .findOne({
          userId,
          connectionVerified: { $ne: true },
          $or: [{ forwardingEmail: '' }, { forwardingEmail: null }],
        })
        .sort({ createdAt: -1 });

      if (draft) {
        if (draft.mailhook !== mailhook) {
          draft.mailhook = mailhook;
          await draft.save();
        }

        return res.status(200).json({
          success: true,
          message: 'Existing mailhook connection resumed',
          mailhook,
          data: draft,
        });
      }
    }

    const newMailhook = new mailhookModel({
      userId,
      mailhook,
      forwardingEmail,
    });

    await newMailhook.save();

    res.status(201).json({
      success: true,
      message: 'Mailhook created successfully',
      mailhook,
      data: newMailhook,
    });
  } catch (error) {
    console.error('Error creating mailhook:', error);
    res.status(500).json({
      success: false,
      message: 'Server error creating mailhook',
    });
  }
};

export const getMailhookCard = async (req, res) => {
  try {
    const { userId } = req.params;

    if (!isOwnerOrAdmin(req, userId)) {
      return res.status(403).json({ success: false, message: "Forbidden: Cannot access another user's mailhook cards" });
    }

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: 'User ID is required',
      });
    }

    const mailhooks = await mailhookModel
      .find({ userId })
      .sort({ createdAt: -1 });

    if (!mailhooks.length) {
      return res.status(404).json({
        success: false,
        message: 'No mailhook records found for this user',
      });
    }

    res.status(200).json({
      success: true,
      count: mailhooks.length,
      data: mailhooks,
    });
  } catch (error) {
    console.error('Error fetching mailhooks:', error);
    res.status(500).json({
      success: false,
      message: 'Server error fetching mailhooks',
    });
  }
};

export const deleteMailhookCard = async (req, res) => {
  try {
    const { cardId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(cardId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid Mailhook card ID.',
      });
    }
    

    const mailhook = await mailhookModel.findById(cardId);

    if (!mailhook) {
      return res.status(404).json({
        success: false,
        message: 'Mailhook card not found.',
      });
    }

    if (!isOwnerOrAdmin(req, mailhook.userId)) {
      return res.status(403).json({ success: false, message: "Forbidden: Cannot delete another user's mailhook card" });
    }

    if (mailhook.validationId) {
      const deletedValidation = await validationModel.findByIdAndDelete(
        mailhook.validationId
      );
      if (deletedValidation) {
      }
    }

    await mailhookModel.findByIdAndDelete(cardId);

    return res.status(200).json({
      success: true,
      message:
        'Mailhook card and linked validation record deleted successfully.',
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Server error deleting mailhook card.',
      error: error.message,
    });
  }
};

/*
 * POST /mailhookcard/validate
 *
 * The connections-page setup modal asks the user to forward mail to their
 * mailhook address and then calls this to confirm it worked. The route did
 * not exist, so "Validate Forwarding" always failed with a 404 and no
 * mailhook connection could ever be completed from that page.
 *
 * Proof that forwarding is live is the mail itself: either the round-trip
 * test message the webhook marks verified (the setup-wizard flow), or any
 * message that actually landed on the user's mailhook address. Without one
 * of those this reports failure rather than marking the card verified —
 * a card that claims to be connected when nothing is arriving is worse
 * than an honest "not yet".
 */
export const validateMailhookCard = async (req, res) => {
  try {
    const authUserId = getAuthUserId(req);
    const userId = req.body.userId || authUserId;
    const { cardId } = req.body;

    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ success: false, message: 'Invalid user ID.' });
    }

    if (!isOwnerOrAdmin(req, userId)) {
      return res.status(403).json({
        success: false,
        message: "Forbidden: Cannot validate another user's mailhook",
      });
    }

    const user = await authModel.findById(userId).select('mailhook email');

    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const mailhook = await ensureUserMailhook(user);

    /* Evidence A — the forwarding test message came back verified. */
    const testRecord = await validationModel
      .findOne({ userId, verified: true })
      .sort({ createdAt: -1 })
      .lean();

    /* Evidence B — a real message was delivered to the mailhook address. */
    const forwardedEmail = await EmailModel.findOne({
      userId,
      recipientAddress: mailhook,
    })
      .sort({ createdAt: -1 })
      .lean();

    if (!testRecord && !forwardedEmail) {
      return res.status(200).json({
        success: false,
        message:
          'No forwarded email has reached your mailhook yet. Check that forwarding is enabled and points at your mailhook address, then try again.',
      });
    }

    const forwardingEmail = (req.body.forwardingEmail || '').trim().toLowerCase();
    const resolvedForwardingEmail =
      forwardingEmail ||
      (testRecord?.toEmail || '').toLowerCase() ||
      (forwardedEmail?.forwardedMeta?.to || '').toLowerCase() ||
      (forwardedEmail?.senderAddress || '').toLowerCase();

    if (!resolvedForwardingEmail) {
      return res.status(400).json({
        success: false,
        message: 'Please confirm which email address forwards into your mailhook.',
      });
    }

    const update = {
      userId,
      mailhook,
      forwardingEmail: resolvedForwardingEmail,
      connectionVerified: true,
      ...(testRecord ? { validationId: testRecord._id } : {}),
    };

    let card = null;

    if (cardId && mongoose.Types.ObjectId.isValid(cardId)) {
      card = await mailhookModel.findOneAndUpdate({ _id: cardId, userId }, update, {
        new: true,
      });
    }

    /*
     * No cardId (or it no longer exists): finish the draft card step 1
     * created, or an earlier card for the same address, before creating one.
     */
    if (!card) {
      card = await mailhookModel.findOneAndUpdate(
        {
          userId,
          $or: [
            { forwardingEmail: resolvedForwardingEmail },
            { forwardingEmail: '' },
            { forwardingEmail: null },
          ],
        },
        update,
        { new: true, sort: { createdAt: -1 } }
      );
    }

    if (!card) {
      card = await mailhookModel.create(update);
    }

    return res.status(200).json({
      success: true,
      message: 'Forwarding verified successfully.',
      data: card,
    });
  } catch (error) {
    console.error('Error validating mailhook card:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error validating mailhook connection',
      error: error.message,
    });
  }
};
