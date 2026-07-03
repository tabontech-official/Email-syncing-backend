// import { processGmailEmail } from "./gmailService.js";

// export const gmailWebhook = async (req, res) => {
//   try {
//     const message = req.body.message;

//     const data = JSON.parse(Buffer.from(message.data, 'base64').toString());

//     const { emailAddress, historyId } = data;

//     console.log('📩 Gmail event:', emailAddress, historyId);

//     await processGmailEmail(emailAddress, historyId);

//     res.status(200).send('OK');
//   } catch (err) {
//     console.log('Webhook error:', err);

//     res.status(500).send('Error');
//   }
// };


import { processGmailEmail } from "./gmailService.js";

export const gmailWebhook = async (req, res) => {
  try {
    console.log("🚀 [WEBHOOK HIT] Gmail webhook received");

    console.log("📦 Request headers:", req.headers);
    console.log("📨 Request body:", req.body);

    const message = req.body.message;

    if (!message) {
      console.log("❌ No message found in request body");
      return res.status(400).send("No message found");
    }

    console.log("📩 Encoded message received:", message);

    const decodedData = Buffer.from(message.data, "base64").toString();

    console.log("🔓 Decoded base64 data:", decodedData);

    const data = JSON.parse(decodedData);

    console.log("📊 Parsed JSON data:", data);

    const { emailAddress, historyId } = data;

    if (!emailAddress || !historyId) {
      console.log("❌ Missing emailAddress or historyId");
      return res.status(400).send("Invalid data");
    }

    console.log("📧 Email Address:", emailAddress);
    console.log("🆔 History ID:", historyId);

    console.log("⚙️ Calling processGmailEmail...");

    await processGmailEmail(emailAddress, historyId);

    console.log("✅ processGmailEmail completed successfully");

    res.status(200).send("OK");
    console.log("🎉 Webhook response sent successfully");
  } catch (err) {
    console.log("❌ Webhook error occurred");
    console.log("🧨 Error message:", err.message);
    console.log("🧾 Full error:", err);
    console.log("📍 Stack trace:", err.stack);

    res.status(500).send("Error");
  }
};