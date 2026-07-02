import { google } from 'googleapis';

import { executeScenarios } from '../controller/smtpServer.js';

import { ConnectionModel } from '../Models/Connection.js';



export async function processGmailEmail(emailAddress, historyId) {

  try {

    // 1. Find connection

    const connection = await ConnectionModel.findOne({

      email: emailAddress,

      provider: 'gmail',

    });



    if (!connection) {

      console.log('❌ No connection found for:', emailAddress);

      return;

    }



    // 2. Setup OAuth

    const oauth2Client = new google.auth.OAuth2(

      process.env.GOOGLE_CLIENT_ID,

      process.env.GOOGLE_CLIENT_SECRET,

      process.env.GOOGLE_REDIRECT_URI

    );



    oauth2Client.setCredentials(connection.tokens);



    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });



    // 3. Fetch Gmail history safely

    const history = await gmail.users.history.list({

      userId: 'me',

      startHistoryId: connection.gmailWatch?.historyId || historyId,

      historyTypes: ['messageAdded'],

    });



    const histories = history.data.history || [];



    const messages = histories.flatMap(h => h.messages || []);



    if (!messages.length) {

      console.log('ℹ️ No new emails found');

      return;

    }



    // 4. Prevent duplicate processing (in-memory safeguard)

    const processed = new Set();



    // 5. Process each email

    for (const msg of messages) {

      try {

        if (!msg?.id) continue;



        // duplicate protection

        if (processed.has(msg.id)) continue;

        processed.add(msg.id);



        const email = await gmail.users.messages.get({

          userId: 'me',

          id: msg.id,

        });



        const payload = email.data;



        const headers = payload.payload?.headers || [];



        const getHeader = (name) =>

          headers.find((h) => h.name === name)?.value || '';



        // 6. Better body extraction

        const body =

          payload.snippet ||

          payload.payload?.body?.data ||

          '';



        const normalizedEmail = {

          emailId: msg.id,

          from: getHeader('From'),

          subject: getHeader('Subject'),

          body,

          parsedEmailObj: payload,

        };



        console.log('📩 Processing Email:', normalizedEmail.subject);



        // 7. RUN YOUR EXISTING ENGINE

        await executeScenarios({

          userId: connection.userId,

          from: normalizedEmail.from,

          subject: normalizedEmail.subject,

          body: normalizedEmail.body,

          emailId: normalizedEmail.emailId,

          parsedEmailObj: normalizedEmail.parsedEmailObj,

        });



      } catch (err) {

        console.log('❌ Error processing message:', msg.id, err.message);

      }

    }



    // 8. Update historyId safely

    if (historyId) {

      await ConnectionModel.updateOne(

        { _id: connection._id },

        {

          $set: {

            'gmailWatch.historyId': historyId,

          },

        }

      );

    }



    console.log('✅ Gmail processing complete');



  } catch (err) {

    console.log('🔥 processGmailEmail fatal error:', err.message);

  }

}