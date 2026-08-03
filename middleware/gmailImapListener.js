import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { ConnectionModel } from '../Models/Connection.js';
import { EmailModel } from '../Models/Email.js';
import { executeScenarios, saveIncomingReplyIfExists } from '../controller/smtpServer.js';
import { decrypt } from './encryption.js';
import { uploadBufferToCloudinary } from './cloudinary.js';

/*
 * All currently running Gmail listeners.
 *
 * Key:
 * connectionId
 *
 * Value:
 * ImapFlow client
 */
const activeGmailListeners = new Map();

/*
 * Used when we intentionally stop a listener.
 * This prevents automatic reconnect.
 */
const intentionallyStoppedListeners = new Set();

const normalizeEmail = (value = '') => {
  return String(value).trim().toLowerCase();
};

const getConnectionPassword = (connection) => {
  const encryptedPassword =
    connection.imap?.password ||
    connection.smtp?.password;

  if (!encryptedPassword) {
    throw new Error(
      `App Password missing for ${connection.email}`
    );
  }

  return decrypt(encryptedPassword);
};

const processIncomingGmailEmail = async ({
  connection,
  source,
  uid,
}) => {
  const parsed = await simpleParser(source);

  const senderAddress = normalizeEmail(
    parsed.from?.value?.[0]?.address
  );

  const recipientAddress = normalizeEmail(
    parsed.to?.value?.[0]?.address ||
      connection.email
  );

  if (!senderAddress) {
    console.log(
      'Gmail email skipped because sender is missing'
    );

    return;
  }

  /*
   * Skip emails sent from the same connected account.
   */
  if (
    senderAddress ===
    normalizeEmail(connection.email)
  ) {
    console.log(
      'Outgoing/self email skipped:',
      senderAddress
    );

    return;
  }

  /*
   * Avoid processing the same email twice.
   */
  if (parsed.messageId) {
    const rawId = parsed.messageId;
    const cleanIdStr = parsed.messageId ? parsed.messageId.replace(/^<|>$/g, '').trim() : '';
    if (cleanIdStr) {
      const existingEmail = await EmailModel.findOne({
        $or: [
          { messageId: parsed.messageId },
          { messageId: cleanIdStr },
          { messageId: `<${cleanIdStr}>` },
          { rfcMessageId: parsed.messageId },
          { rfcMessageId: cleanIdStr },
          { rfcMessageId: `<${cleanIdStr}>` },
        ],
      }).select('_id');

      if (existingEmail) {
        console.log(
          '⚠️ Duplicate email event ignored (already saved & scenario already executed):',
          parsed.subject
        );
        return;
      }
    }
  }

  /*
   * First check whether this email is a reply
   * to an existing conversation.
   */
  const savedAsReply =
    await saveIncomingReplyIfExists({
      userId: connection.userId,
      connectionId: connection._id,

      from: senderAddress,
      to: recipientAddress,

      subject: parsed.subject || '',
      body: parsed.text || '',
      html: parsed.html || '',

      emailId: parsed.messageId || '',
      threadId: '',
      inReplyTo: parsed.inReplyTo || '',
      references: Array.isArray(parsed.references)
        ? parsed.references
        : typeof parsed.references === 'string'
        ? [parsed.references]
        : [],

      attachments: await Promise.all(
        (parsed.attachments || []).map(async (attachment) => {
          let cUrl = null;
          if (attachment.content) {
            cUrl = await uploadBufferToCloudinary(
              attachment.content,
              attachment.filename || 'attachment'
            );
          }
          return {
            filename: attachment.filename || 'attachment',
            contentType: attachment.contentType,
            size: attachment.size,
            url: cUrl || '',
          };
        })
      ),
    });

  if (savedAsReply) {
    console.log(
      'Customer reply saved. Initial scenario skipped:',
      parsed.subject
    );

    return;
  }

  /*
   * Save as a new incoming email.
   */
  const msgDate = parsed.date || new Date();
  if (parsed.messageId) {
    const rawId = parsed.messageId;
    const cleanIdStr = rawId.replace(/^<|>$/g, '').trim();
    if (cleanIdStr) {
      const existingDoc = await EmailModel.findOne({
        $or: [
          { messageId: rawId },
          { messageId: cleanIdStr },
          { messageId: `<${cleanIdStr}>` },
          { rfcMessageId: rawId },
          { rfcMessageId: cleanIdStr },
          { rfcMessageId: `<${cleanIdStr}>` },
        ],
      }).select('_id');

      if (existingDoc) {
        console.log('⚠️ Duplicate IMAP email event skipped (already saved in DB):', parsed.subject);
        return;
      }
    }
  }

  const emailDoc =
    await EmailModel.create({
      userId: connection.userId,
      connectionId: connection._id,

      senderAddress,
      recipientAddress,

      subject: parsed.subject || '',
      textBody: parsed.text || '',
      htmlBody: parsed.html || '',

      date: msgDate,
      lastActivityAt: msgDate,

      messageId: parsed.messageId || '',
      threadId: parsed.threadId || null,
      inReplyTo: parsed.inReplyTo || '',
      references: parsed.references || [],

      direction: 'incoming',
      provider: 'gmail',
      service: 'gmail',

      imapUid: uid,

      attachments:
        parsed.attachments?.map(
          (attachment) => ({
            filename:
              attachment.filename ||
              'attachment',
            contentType:
              attachment.contentType,
            size: attachment.size,
          })
        ) || [],

      notes:
        'Incoming Gmail email received through IMAP IDLE',
    });

  if (!emailDoc.threadId) {
    emailDoc.threadId = parsed.threadId || parsed.messageId || emailDoc._id.toString();
    await emailDoc.save();
  }

  console.log(
    'New Gmail email saved:',
    emailDoc._id
  );

  /*
   * Execute automation scenario.
   */
  await executeScenarios({
    userId: connection.userId,
    from: senderAddress,
    subject: parsed.subject || '',
    body:
      parsed.text ||
      parsed.html ||
      '',
    emailId: emailDoc._id.toString(),
    parsedEmailObj: parsed,
  });

  console.log(
    'Scenario execution completed:',
    parsed.subject
  );
};

export const startGmailListener = async (
  connectionId
) => {
  const key = connectionId.toString();

  /*
   * Avoid starting the same listener twice.
   */
  if (activeGmailListeners.has(key)) {
    console.log(
      'Gmail listener already running:',
      key
    );

    return {
      success: true,
      alreadyRunning: true,
    };
  }

  intentionallyStoppedListeners.delete(key);

  /*
   * Password fields are normally select:false,
   * so they must be explicitly selected.
   */
  const connection =
    await ConnectionModel.findOne({
      _id: connectionId,
      status: 'active',
    }).select(
      '+smtp.password +imap.password'
    );

  if (!connection) {
    throw new Error(
      'Active Gmail connection not found'
    );
  }

  const provider = String(
    connection.provider || ''
  ).toLowerCase();

  if (provider !== 'gmail') {
    throw new Error(
      'Selected connection is not Gmail'
    );
  }

  const username =
    connection.imap?.username ||
    connection.smtp?.username ||
    connection.email;

  if (!username) {
    throw new Error(
      'Gmail username is missing'
    );
  }

  const appPassword =
    getConnectionPassword(connection);

  const client = new ImapFlow({
    host:
      connection.imap?.host ||
      'imap.gmail.com',

    port:
      Number(
        connection.imap?.port ||
          993
      ),

    secure: true,

    auth: {
      user: username,
      pass: appPassword,
    },

    logger: false,

    /*
     * Keep the IMAP connection alive.
     */
    socketTimeout: 0,
  });

  client.on('error', (error) => {
    console.error(
      `Gmail IMAP error for ${username}:`,
      error.message
    );
  });

  client.on('close', () => {
    console.log(
      `Gmail listener disconnected: ${username}`
    );

    activeGmailListeners.delete(key);

    /*
     * Do not reconnect when the listener was
     * deliberately stopped.
     */
    if (
      intentionallyStoppedListeners.has(
        key
      )
    ) {
      return;
    }

    console.log(
      `Reconnecting Gmail listener in 10 seconds: ${username}`
    );

    setTimeout(() => {
      startGmailListener(
        connectionId
      ).catch((error) => {
        console.error(
          `Gmail reconnect failed for ${username}:`,
          error.message
        );
      });
    }, 10000);
  });

  await client.connect();

  /*
   * Open INBOX and keep it open.
   * ImapFlow will use IMAP IDLE internally.
   */
  await client.mailboxOpen('INBOX');

  activeGmailListeners.set(
    key,
    client
  );

  console.log(
    `Gmail real-time listener active: ${username}`
  );

  /*
   * Serial promise prevents multiple incoming
   * messages from being processed at the same time
   * on the same connection.
   */
  let processingQueue =
    Promise.resolve();

  client.on('exists', (event) => {
    processingQueue =
      processingQueue
        .then(async () => {
          console.log(
            `New Gmail message detected for ${username}:`,
            event
          );

          const totalMessages =
            client.mailbox?.exists;

          if (!totalMessages) {
            return;
          }

          /*
           * Fetch the latest message by sequence number.
           */
          for await (const message of client.fetch(
            totalMessages.toString(),
            {
              uid: true,
              source: true,
              envelope: true,
            }
          )) {
            await processIncomingGmailEmail({
              connection,
              source: message.source,
              uid: message.uid,
            });
          }
        })
        .catch((error) => {
          console.error(
            `Gmail incoming processing error for ${username}:`,
            error
          );
        });
  });

  return {
    success: true,
    connectionId: key,
    email: username,
  };
};

export const stopGmailListener = async (
  connectionId
) => {
  const key = connectionId.toString();

  intentionallyStoppedListeners.add(
    key
  );

  const client =
    activeGmailListeners.get(key);

  if (!client) {
    return {
      success: true,
      alreadyStopped: true,
    };
  }

  activeGmailListeners.delete(key);

  try {
    await client.logout();
  } catch (error) {
    console.warn(
      'Gmail logout warning:',
      error.message
    );
  }

  console.log(
    'Gmail listener stopped:',
    key
  );

  return {
    success: true,
  };
};

export const restartGmailListener =
  async (connectionId) => {
    await stopGmailListener(
      connectionId
    );

    intentionallyStoppedListeners.delete(
      connectionId.toString()
    );

    return startGmailListener(
      connectionId
    );
  };

export const startAllGmailListeners =
  async () => {
    const connections =
      await ConnectionModel.find({
        provider: 'gmail',
        status: 'active',
      }).select('_id email');

    console.log(
      `Starting ${connections.length} Gmail listener(s)`
    );

    const results = [];

    for (const connection of connections) {
      try {
        const result =
          await startGmailListener(
            connection._id
          );

        results.push({
          connectionId:
            connection._id,
          email: connection.email,
          success: true,
          result,
        });
      } catch (error) {
        console.error(
          `Failed to start Gmail listener for ${connection.email}:`,
          error.message
        );

        results.push({
          connectionId:
            connection._id,
          email: connection.email,
          success: false,
          error: error.message,
        });
      }
    }

    return results;
  };