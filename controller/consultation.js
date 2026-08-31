import { consultationModel } from '../Models/consultation.js';
import { sendPlatformMail } from '../utils/platformMailer.js';

/*
 * This file used to build its own Gmail transport from an address and app
 * password written directly into the source, and sent as a third address
 * again in the From header. It now sends as the configured platform
 * mailbox (master admin -> Platform Email) like every other system mail.
 */

export const addConsultation = async (req, res) => {
  try {
    const { fullName, email, storeUrl, consultataionType, goals, userId } =
      req.body;

    const newConsultation = await consultationModel.create({
      fullName,
      email,
      storeUrl,
      consultataionType,
      goals,
      userId,
    });

    const mailOptions = {
      to: email,
      subject: 'Consultation Booked Successfully',
      html: `
          <h2>Hi ${fullName},</h2>
          <p>Your consultation has been booked successfully.</p>
          <p><strong>Store URL:</strong> ${storeUrl}</p>
          <p><strong>Consultation Type:</strong> ${consultataionType}</p>
          <p><strong>Goals:</strong> ${goals}</p>
          <br/>
          <p>Thank you for choosing us!</p>
        `,
    };

    await sendPlatformMail(mailOptions);

    res.status(201).json({
      message: 'Consultation booked and email sent.',
      data: newConsultation,
    });
  } catch (error) {
    console.error('Error booking consultation:', error);
    res.status(500).json({ message: 'Something went wrong.' });
  }
};
