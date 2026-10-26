// What the app needs from an email service, and nothing more. Any provider can sit behind it.
export type Email = { to: string; subject: string; text: string };

export interface EmailSender {
  send(email: Email): Promise<void>;
}

// For development: writes emails to the log instead of sending them.
export const logEmailSender: EmailSender = {
  async send(email) {
    console.log(JSON.stringify({ email: { to: email.to, subject: email.subject } }));
  },
};
