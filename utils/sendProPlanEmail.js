import nodemailer from "nodemailer";

const formatDate = (date) => {
  if (!date) return "N/A";

  return new Date(date).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
};

const buildProPlanEmailHtml = ({
  name = "there",
  durationInDays,
  startDate,
  endDate,
}) => {
  return `
    <div style="margin:0;padding:0;background:#f8fafc;font-family:Arial,Helvetica,sans-serif;color:#0f172a;">
      <div style="max-width:600px;margin:0 auto;padding:32px 16px;">
        <div style="background:#ffffff;border:1px solid #e2e8f0;border-radius:16px;overflow:hidden;box-shadow:0 10px 25px rgba(15,23,42,0.08);">
          
          <div style="background:#4f46e5;padding:24px 28px;color:#ffffff;">
            <h1 style="margin:0;font-size:22px;font-weight:700;">Replex Engine</h1>
            <p style="margin:6px 0 0;font-size:14px;opacity:0.9;">Pro plan activation</p>
          </div>

          <div style="padding:28px;">
            <h2 style="margin:0 0 12px;font-size:24px;color:#0f172a;">
              Your Pro plan is active
            </h2>

            <p style="margin:0 0 20px;font-size:15px;line-height:1.7;color:#475569;">
              Hi ${name}, your Pro plan has been activated successfully. You can now access Pro features in your Replex Engine account.
            </p>

            <div style="border:1px solid #e2e8f0;border-radius:14px;background:#f8fafc;padding:18px;margin:22px 0;">
              <div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #e2e8f0;">
                <span style="font-size:14px;color:#64748b;">Plan</span>
                <strong style="font-size:14px;color:#0f172a;">Pro</strong>
              </div>

              <div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #e2e8f0;">
                <span style="font-size:14px;color:#64748b;">Duration</span>
                <strong style="font-size:14px;color:#0f172a;">${durationInDays} days</strong>
              </div>

              <div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #e2e8f0;">
                <span style="font-size:14px;color:#64748b;">Starts</span>
                <strong style="font-size:14px;color:#0f172a;">${formatDate(startDate)}</strong>
              </div>

              <div style="display:flex;justify-content:space-between;padding:8px 0;">
                <span style="font-size:14px;color:#64748b;">Expires</span>
                <strong style="font-size:14px;color:#0f172a;">${formatDate(endDate)}</strong>
              </div>
            </div>

            <p style="margin:20px 0 0;font-size:14px;line-height:1.7;color:#64748b;">
              Thank you for using Replex Engine.
            </p>
          </div>
        </div>

        <p style="text-align:center;margin:18px 0 0;font-size:12px;color:#94a3b8;">
          This is an automated notification. Please do not reply to this email.
        </p>
      </div>
    </div>
  `;
};

const buildProPlanEmailText = ({
  name = "there",
  durationInDays,
  startDate,
  endDate,
}) => {
  return `
Hi ${name},

Your Pro plan has been activated successfully.

Plan: Pro
Duration: ${durationInDays} days
Starts: ${formatDate(startDate)}
Expires: ${formatDate(endDate)}

Thank you for using Replex Engine.
  `;
};

export const sendProPlanActivatedEmail = async ({
  to,
  name,
  durationInDays,
  startDate,
  endDate,
}) => {
  if (!to) {
    throw new Error("Recipient email is required");
  }

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT) || 587,
    secure: process.env.SMTP_SECURE === "true",
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS,
    },
  });

  const html = buildProPlanEmailHtml({
    name,
    durationInDays,
    startDate,
    endDate,
  });

  const text = buildProPlanEmailText({
    name,
    durationInDays,
    startDate,
    endDate,
  });

  return transporter.sendMail({
    from: process.env.SMTP_FROM || `"Replex Engine" <${process.env.EMAIL_USER}>`,
    to,
    subject: "Your Pro plan is now active",
    html,
    text,
  });
};