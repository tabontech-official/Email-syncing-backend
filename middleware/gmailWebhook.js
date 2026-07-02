export const gmailWebhook = async (req, res) => {

  try {

    const message = req.body.message;



    const data = JSON.parse(

      Buffer.from(message.data, 'base64').toString()

    );



    const { emailAddress, historyId } = data;



    console.log("📩 Gmail event:", emailAddress, historyId);



    await processGmailEmail(emailAddress, historyId);



    res.status(200).send("OK");

  } catch (err) {

    console.log("Webhook error:", err);

    res.status(500).send("Error");

  }

};