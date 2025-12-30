import nodemailer from "nodemailer";

export const welComeEmail = async ({ to, subject, html }) => {
  const transporter = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 587,
    secure: false,
    auth: {
      user: process.env.SMTP_USER, // e.g. noreply@brandfer.com
      pass: process.env.SMTP_PASS,
    },
  });

  return transporter.sendMail({
    from: `"Brandfer" <${process.env.SMTP_USER}>`,
    to,
    subject,
    html,
  });
};
