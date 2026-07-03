import { AuthorizationCode } from "simple-oauth2";
import cron from "node-cron";
import { ConnectionModel } from "../Models/Connection.js";

const oauthConfig = {
  client: {
    id: process.env.MICROSOFT_CLIENT_ID,
    secret: process.env.MICROSOFT_CLIENT_SECRET,
  },
  auth: {
    tokenHost: "https://login.microsoftonline.com",
    tokenPath: "/common/oauth2/v2.0/token",
  },
};

const client = new AuthorizationCode(oauthConfig);


export const refreshMicrosoftToken = async (connection) => {
  try {
    if (!connection?.tokens?.refresh_token) {
      console.log("❌ No refresh token found");
      return null;
    }

    const tokenObject = client.createToken({
      refresh_token: connection.tokens.refresh_token,
    });

    const newToken = await tokenObject.refresh();

    connection.tokens = {
      ...connection.tokens,
      access_token: newToken.token.access_token,
      expires_at: newToken.token.expires_at,
    };

    await connection.save();

    console.log("🔄 Microsoft token refreshed:", connection.email);

    return connection;
  } catch (err) {
    console.log("❌ Token refresh failed:", err.message);

    // optional: mark disconnected
    connection.status = "disconnected";
    await connection.save();

    return null;
  }
};


cron.schedule("*/30 * * * *", async () => {
  console.log("⏰ Microsoft token refresh cron started");

  try {
    const connections = await ConnectionModel.find({
      provider: "outlook",
      status: "active",
    });

    console.log(`📡 Found ${connections.length} Outlook connections`);

    for (const connection of connections) {
      try {
        const expiresAt = connection.tokens?.expires_at
          ? new Date(connection.tokens.expires_at)
          : null;

        const now = new Date();

        // refresh if expires in next 10 minutes
        const shouldRefresh =
          !expiresAt || expiresAt.getTime() - now.getTime() < 10 * 60 * 1000;

        if (shouldRefresh) {
          console.log("🔄 Refreshing token for:", connection.email);

          await refreshMicrosoftToken(connection);
        } else {
          console.log("✅ Token still valid:", connection.email);
        }
      } catch (err) {
        console.log("❌ Connection refresh error:", err.message);
      }
    }

    console.log("✅ Microsoft cron completed");
  } catch (err) {
    console.log("❌ Cron job failed:", err.message);
  }
});