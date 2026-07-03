import { PROVIDER_MAP } from "../middleware/providers.js";
import { ConnectionModel } from "../Models/Connection.js";

export const createConnection = async (req, res) => {
  try {
    const { userId, provider, username, password } = req.body;

    const config = PROVIDER_MAP[provider];

    if (!config) {
      return res.status(400).json({
        success: false,
        message: "Unsupported provider",
      });
    }

    const connection = await ConnectionModel.create({
      userId,
      providerGroup: config.group,
      provider,
      email: username,
      auth: {
        username,
        password,
      },
      imap: config.imap || null,
      smtp: config.smtp || null,
      verified: false,
      status: "active",
    });

    return res.json({
      success: true,
      data: connection,
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: err.message,
    });
  }
};