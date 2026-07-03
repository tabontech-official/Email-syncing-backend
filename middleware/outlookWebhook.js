import { ConnectionModel } from "../Models/Connection.js";
import { processOutlookEmail } from "./gmailService.js";
import { htmlToText } from "html-to-text";
export const outlookWebhook = async (req, res) => {
  console.log('🚨===============================');
  console.log('📩 [OUTLOOK WEBHOOK HIT]');
  console.log('⏰ Time:', new Date().toISOString());
  console.log('📦 Query:', req.query);
  console.log('📦 Body:', JSON.stringify(req.body, null, 2));
  console.log('🚨===============================');

  const validationToken = req.query.validationToken;

  // -------------------------------
  // MICROSOFT VALIDATION REQUEST
  // -------------------------------
  if (validationToken) {
    console.log('🔐 VALIDATION REQUEST');
    return res.status(200).type('text/plain').send(validationToken);
  }

  const notifications = req.body?.value || [];

  console.log('📨 Notifications count:', notifications.length);

  for (const notification of notifications) {
    try {
      console.log('-------------------------------');
      console.log('🔔 NEW NOTIFICATION');

      // -------------------------------
      // CLIENT STATE CHECK
      // -------------------------------
      console.log('👉 clientState:', notification.clientState);

      if (notification.clientState !== process.env.MS_CLIENT_STATE) {
        console.log('❌ INVALID CLIENT STATE');
        continue;
      }

      // -------------------------------
      // FIND CONNECTION
      // -------------------------------
      const connection = await ConnectionModel.findOne({
        provider: 'outlook',
        'outlookSubscription.id': notification.subscriptionId,
      });

      if (!connection) {
        console.log('❌ CONNECTION NOT FOUND');
        continue;
      }

      console.log('✅ Connection found:', connection._id);

      // -------------------------------
      // FIXED MESSAGE ID (IMPORTANT)
      // -------------------------------
      const messageId =
        notification.resourceData?.id ||
        notification.resourceData?.['@odata.id']?.split('/Messages/')?.[1] ||
        notification.resourceData?.['@odata.id']?.split('/messages/')?.[1] ||
        notification.resource?.split('/Messages/')?.[1] ||
        notification.resource?.split('/messages/')?.[1];

      console.log('🆔 Message ID:', messageId);

      if (!messageId) {
        console.log('❌ NO MESSAGE ID FOUND');
        continue;
      }

      // -------------------------------
      // FETCH EMAIL FROM GRAPH
      // -------------------------------
      console.log('📡 Fetching email from Graph...');

      const emailRes = await fetch(
        `https://graph.microsoft.com/v1.0/me/messages/${messageId}`,
        {
          headers: {
            Authorization: `Bearer ${connection.tokens?.access_token}`,
          },
        }
      );

      const email = await emailRes.json();

      console.log('📡 Graph Status:', emailRes.status);

      if (!emailRes.ok) {
        console.log('❌ GRAPH ERROR:', email);
        continue;
      }

      // -------------------------------
      // SUCCESS EMAIL DATA
      // -------------------------------
      console.log('🎉 EMAIL RECEIVED');
      console.log('📧 Subject:', email.subject);
      console.log('👤 From:', email.from?.emailAddress?.address);
      console.log('🕒 Time:', email.receivedDateTime);

      // -------------------------------
      // IMPORTANT FIX: PASS RAW NOTIFICATION + CONNECTION
      // -------------------------------
      console.log('⚙️ Sending to automation engine...');

      await processOutlookEmail(notification, connection);

    } catch (err) {
      console.log('❌ WEBHOOK ERROR:', err.message);
      console.log(err.stack);
    }

    console.log('-------------------------------');
  }

  console.log('✅ WEBHOOK COMPLETE');
  return res.sendStatus(202);
};