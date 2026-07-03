import { ConnectionModel } from "../Models/Connection.js";

export const outlookWebhook = async (req, res) => {
  const validationToken = req.query.validationToken;

  // Microsoft webhook validation
  if (validationToken) {
    return res
      .status(200)
      .type('text/plain')
      .send(validationToken);
  }

  const notifications = req.body.value || [];

  for (const notification of notifications) {
    try {
      if (notification.clientState !== process.env.MS_CLIENT_STATE) {
        console.log('❌ Invalid Outlook clientState');
        continue;
      }

      const connection = await ConnectionModel.findOne({
        provider: 'outlook',
        'outlookSubscription.id': notification.subscriptionId,
      });

      if (!connection) {
        console.log('❌ No Outlook connection found');
        continue;
      }

      const resource = notification.resource;
      const messageId = resource.split('/messages/')[1];

      if (!messageId) {
        console.log('❌ No messageId found:', resource);
        continue;
      }

      const emailRes = await fetch(
        `https://graph.microsoft.com/v1.0/me/messages/${messageId}`,
        {
          headers: {
            Authorization: `Bearer ${connection.tokens.access_token}`,
          },
        }
      );

      const email = await emailRes.json();

      if (!emailRes.ok) {
        console.log('❌ Failed to fetch Outlook email:', email);
        continue;
      }

      console.log('📧 New Outlook email:', {
        subject: email.subject,
        from: email.from?.emailAddress?.address,
        receivedDateTime: email.receivedDateTime,
      });

      // yahan apni DB mein email save/process karo
    } catch (err) {
      console.log('❌ Outlook webhook loop error:', err.message);
    }
  }

  return res.sendStatus(202);
};