import nodemailer from 'nodemailer';
import MailComposer from 'nodemailer/lib/mail-composer';
import { AccountRow } from '../db/database';
import { decrypt } from '../utils/crypto';

interface SendOpts {
  to: string;
  cc?: string;
  bcc?: string;
  subject: string;
  text: string;
  html?: string;
  inReplyTo?: string;
  references?: string;
}

export class SmtpService {
  async send(account: AccountRow, opts: SendOpts): Promise<Buffer> {
    const mailOpts = {
      from: `"${account.name}" <${account.email}>`,
      to: opts.to,
      cc: opts.cc || undefined,
      bcc: opts.bcc || undefined,
      subject: opts.subject,
      text: opts.text,
      html: opts.html || undefined,
      inReplyTo: opts.inReplyTo || undefined,
      references: opts.references || undefined,
    };

    const transporter = nodemailer.createTransport({
      host: account.smtp_host || account.imap_host!,
      port: account.smtp_port || 587,
      secure: (account.smtp_port || 587) === 465,
      auth: {
        user: account.username || account.email,
        pass: decrypt(account.password!),
      },
    });

    await transporter.sendMail(mailOpts);

    const composer = new MailComposer(mailOpts);
    const rawMessage = await composer.compile().build();
    return rawMessage;
  }
}

export const smtpService = new SmtpService();
