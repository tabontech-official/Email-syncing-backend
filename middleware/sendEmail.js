import nodemailer from "nodemailer";

export const welComeEmail = async ({ to, subject, html }) => {
  const transporter = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 587,
    secure: false,
    auth: {
      user: process.env.EMAIL_USER, 
      pass: process.env.EMAIL_PASS,
    },
  });

  return transporter.sendMail({
    from: `"Replex Engine" <${process.env.EMAIL_USER}>`,
    to,
    subject,
    html,
  });
};
