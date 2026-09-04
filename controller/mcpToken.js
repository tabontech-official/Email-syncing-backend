import mongoose from 'mongoose';
import {
  McpTokenModel,
  generateMcpToken,
  hashMcpToken,
} from '../Models/McpToken.js';
import { getAuthUserId } from '../middleware/authmiddleware.js';

/*
|--------------------------------------------------------------------------
| MCP token management
|--------------------------------------------------------------------------
|
| Issue, list and revoke the credentials an MCP client uses. Every route
| here is mounted behind adminMiddleware — while the connector is private,
| only the master account may hold a token at all.
|
| Tokens are always issued to the CALLER. An admin cannot mint a token for
| somebody else: that would create a credential the owner never asked for
| and cannot see, which is not a thing this feature should be able to do.
*/

export const createMcpToken = async (req, res) => {
  try {
    const userId = getAuthUserId(req);

    if (!userId) {
      return res.status(401).json({ success: false, message: 'Not signed in.' });
    }

    const label =
      typeof req.body?.label === 'string' && req.body.label.trim()
        ? req.body.label.trim().slice(0, 60)
        : 'MCP client';

    const scope = req.body?.scope === 'read_write' ? 'read_write' : 'read';

    const expiresInDays = Number(req.body?.expiresInDays);
    const expiresAt =
      Number.isFinite(expiresInDays) && expiresInDays > 0
        ? new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000)
        : null;

    const token = generateMcpToken();

    const record = await McpTokenModel.create({
      userId,
      label,
      scope,
      expiresAt,
      tokenHash: hashMcpToken(token),
      tokenHint: token.slice(-6),
    });

    return res.status(201).json({
      success: true,
      /*
       * The only time the plaintext exists in a response. There is no
       * endpoint that can return it again, by design.
       */
      token,
      warning:
        'Copy this token now — it cannot be shown again. Anyone holding it can read this account through the MCP connector.',
      tokenRecord: {
        id: String(record._id),
        label: record.label,
        scope: record.scope,
        hint: record.tokenHint,
        expiresAt: record.expiresAt,
        createdAt: record.createdAt,
      },
    });
  } catch (error) {
    console.error('[createMcpToken]', error);
    return res
      .status(500)
      .json({ success: false, message: 'Could not create the token.' });
  }
};

export const listMcpTokens = async (req, res) => {
  try {
    const userId = getAuthUserId(req);

    const tokens = await McpTokenModel.find({ userId })
      .sort({ createdAt: -1 })
      .select('-tokenHash')
      .lean();

    return res.json({
      success: true,
      tokens: tokens.map((t) => ({
        id: String(t._id),
        label: t.label,
        scope: t.scope,
        hint: t.tokenHint,
        lastUsedAt: t.lastUsedAt,
        revokedAt: t.revokedAt,
        expiresAt: t.expiresAt,
        createdAt: t.createdAt,
        active:
          !t.revokedAt && (!t.expiresAt || new Date(t.expiresAt) > new Date()),
      })),
    });
  } catch (error) {
    console.error('[listMcpTokens]', error);
    return res
      .status(500)
      .json({ success: false, message: 'Could not list tokens.' });
  }
};

export const revokeMcpToken = async (req, res) => {
  try {
    const userId = getAuthUserId(req);

    /*
     * An id that is not an ObjectId at all makes Mongoose throw a
     * CastError, which the catch below would report as a 500 — "the server
     * broke" for what is really "no such token". Same answer as an id that
     * simply does not exist, for the same reason: it reveals nothing.
     */
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res
        .status(404)
        .json({ success: false, message: 'No such token on this account.' });
    }

    /*
     * Scoped to the caller's own tokens: an id from another account must
     * read as "not found", not as a permission error, so this cannot be
     * used to discover which ids exist.
     */
    const record = await McpTokenModel.findOne({
      _id: req.params.id,
      userId,
    });

    if (!record) {
      return res
        .status(404)
        .json({ success: false, message: 'No such token on this account.' });
    }

    if (!record.revokedAt) {
      record.revokedAt = new Date();
      await record.save();
    }

    return res.json({
      success: true,
      message: `Token "${record.label}" is revoked and can no longer be used.`,
    });
  } catch (error) {
    console.error('[revokeMcpToken]', error);
    return res
      .status(500)
      .json({ success: false, message: 'Could not revoke the token.' });
  }
};
