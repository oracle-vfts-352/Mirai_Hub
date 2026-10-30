import nodemailer, { Transporter } from 'nodemailer';
import { smtpConfig } from './config';

let transporter: Transporter | undefined;

function getTransporter() {
  if (!transporter) {
    const cfg = smtpConfig();
    transporter = nodemailer.createTransport({
      host: cfg.host,
      port: cfg.port,
      secure: cfg.secure,
      auth: cfg.user && cfg.pass ? { user: cfg.user, pass: cfg.pass } : undefined,
    });
  }
  return transporter;
}

export type Mail = { to: string; subject: string; text: string; html?: string };

// Throws if the mail server refuses or is unreachable: the caller decides what that means.
export async function sendMail(mail: Mail) {
  await getTransporter().sendMail({ from: smtpConfig().from, ...mail });
}