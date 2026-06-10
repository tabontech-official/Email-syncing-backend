import nodemailer from "nodemailer";

const formatDate = (date) => {
  if (!date) return "N/A";

  return new Date(date).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
};

const buildProPlanRevokedEmailHtml = ({
  name = "there",
  previousPlan = "Pro",
  previousEndDate,
}) => {
  return `
    <div style="margin:0;padding:0;background:#f8fafc;font-family:Arial,Helvetica,sans-serif;color:#0f172a;">
      <div style="max-width:640px;margin:0 auto;padding:32px 16px;">
        <div style="background:#ffffff;border:1px solid #e2e8f0;border-radius:18px;overflow:hidden;box-shadow:0 14px 35px rgba(15,23,42,0.10);">
          
          <div style="background:linear-gradient(135deg,#475569,#334155);padding:30px 28px;color:#ffffff;text-align:center;">
            <div style="display:inline-block;background:rgba(255,255,255,0.16);border:1px solid rgba(255,255,255,0.25);border-radius:999px;padding:8px 14px;margin-bottom:14px;font-size:13px;font-weight:700;">
              PLAN UPDATED
            </div>

            <h1 style="margin:0;font-size:26px;font-weight:800;letter-spacing:-0.4px;">
              Your plan has been updated
            </h1>

            <p style="margin:8px 0 0;font-size:15px;line-height:1.6;opacity:0.92;">
              Your Replex Engine account is now on the Free plan.
            </p>
          </div>

          <div style="padding:30px 28px;">
            <h2 style="margin:0 0 12px;font-size:22px;color:#0f172a;">
              Pro access has ended
            </h2>

            <p style="margin:0 0 20px;font-size:15px;line-height:1.8;color:#475569;">
              Hi ${name}, your Pro access has been ended successfully. Your account has been moved back to the Free plan.
            </p>

            <div style="border:1px solid #e2e8f0;border-radius:16px;background:#f8fafc;padding:18px;margin:24px 0;">
              <div style="display:flex;justify-content:space-between;gap:16px;padding:10px 0;border-bottom:1px solid #e2e8f0;">
                <span style="font-size:14px;color:#64748b;">Previous Plan</span>
                <strong style="font-size:14px;color:#0f172a;">${previousPlan}</strong>
              </div>

              <div style="display:flex;justify-content:space-between;gap:16px;padding:10px 0;border-bottom:1px solid #e2e8f0;">
                <span style="font-size:14px;color:#64748b;">Previous Expiry</span>
                <strong style="font-size:14px;color:#0f172a;">${formatDate(previousEndDate)}</strong>
              </div>

              <div style="display:flex;justify-content:space-between;gap:16px;padding:10px 0;">
                <span style="font-size:14px;color:#64748b;">Current Plan</span>
                <strong style="font-size:14px;color:#0f172a;">Free</strong>
              </div>
            </div>

            <div style="background:#f1f5f9;border:1px solid #e2e8f0;border-radius:16px;padding:18px;margin:22px 0;">
              <p style="margin:0;font-size:14px;line-height:1.7;color:#475569;">
                You can continue using Replex Engine with Free plan access. Some Pro features may no longer be available on your account.
              </p>
            </div>

            <p style="margin:22px 0 0;font-size:14px;line-height:1.7;color:#64748b;">
              Thank you for using Replex Engine.
            </p>
          </div>
        </div>

        <p style="text-align:center;margin:18px 0 0;font-size:12px;color:#94a3b8;">
          This is an automated notification from Replex Engine.
        </p>
      </div>
    </div>
  `;
};

const buildProPlanRevokedEmailText = ({
  name = "there",
  previousPlan = "Pro",
  previousEndDate,
}) => {
  return `
Hi ${name},

Your Pro access has been ended successfully.
Your account is now on the Free plan.

Previous Plan: ${previousPlan}
Previous Expiry: ${formatDate(previousEndDate)}
Current Plan: Free

You can continue using Replex Engine with Free plan access. Some Pro features may no longer be available.

Thank you for using Replex Engine.
  `;
};

export const sendProPlanRevokedEmail = async ({
  to,
  name,
  previousPlan,
  previousEndDate,
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

  const html = buildProPlanRevokedEmailHtml({
    name,
    previousPlan,
    previousEndDate,
  });

  const text = buildProPlanRevokedEmailText({
    name,
    previousPlan,
    previousEndDate,
  });

  return transporter.sendMail({
    from: process.env.SMTP_FROM || `"Replex Engine" <${process.env.EMAIL_USER}>`,
    to,
    subject: "Your Replex Engine plan has been updated",
    html,
    text,
  });
};