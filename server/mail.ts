/**
 * @file Sending e-mails: the "forgotten password" links.
 *
 * The mail server is given by `SMTP_URL` (and the sender by `MAIL_FROM`).
 * Without it no e-mail can leave the server: in development the message is
 * written in the server log instead (handy to try the feature locally), in
 * production the "forgotten password" page says to contact the team.
 * Messages are plain text, built by the server only.
 */
import nodemailer from 'nodemailer';
import type { Config } from './config.js';

/** An e-mail to send. */
export interface Mail {
  to: string;
  subject: string;
  text: string;
}

/** Something that sends e-mails. */
export interface Mailer {
  /** E-mails can be delivered (a mail server is set, or the development log stands in for it). */
  readonly enabled: boolean;
  /** Sends a message; rejects when the mail server refuses it. */
  send(mail: Mail): Promise<void>;
}

/**
 * Creates the mailer of the server.
 * @param config - `smtpUrl`, `mailFrom` and `production`.
 */
export function createMailer(config: Pick<Config, 'smtpUrl' | 'mailFrom' | 'production'>): Mailer {
  if (config.smtpUrl) {
    const transport = nodemailer.createTransport(config.smtpUrl, { disableFileAccess: true, disableUrlAccess: true });
    const from = config.mailFrom ?? 'Brindiwanko <no-reply@localhost>';
    return {
      enabled: true,
      async send(mail) {
        await transport.sendMail({ from, to: mail.to, subject: mail.subject, text: mail.text, disableFileAccess: true, disableUrlAccess: true });
      },
    };
  }
  if (!config.production) {
    return {
      enabled: true,
      async send(mail) {
        console.log(`[brindiwanko] e-mail (no SMTP_URL, development): to ${mail.to}\n  ${mail.subject}\n  ${mail.text.replaceAll('\n', '\n  ')}`);
      },
    };
  }
  return {
    enabled: false,
    async send() {
      throw new Error('No mail server (SMTP_URL) is configured');
    },
  };
}

/** Mailer keeping the messages in a list (tests). */
export function memoryMailer(): Mailer & { outbox: Mail[] } {
  const outbox: Mail[] = [];
  return {
    enabled: true,
    outbox,
    async send(mail) {
      outbox.push(mail);
    },
  };
}
