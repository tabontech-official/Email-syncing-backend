import { sendPlatformMail } from "../utils/platformMailer.js";

/*
 * Welcome mail goes out as the platform, so it uses the configured
 * platform mailbox (master admin -> Platform Email) rather than its own
 * hardcoded Gmail transport. `from` is filled in by the mailer.
 */
export const welComeEmail = async ({ to, subject, html }) =>
  sendPlatformMail({ to, subject, html });
