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

// The email a customer gets when their order is ready. Used by the staff dashboard and the agent.
export const readyEmail = (orderId: number, to: string): Email => ({
  to,
  subject: "Your River Bend order is ready",
  text: `Order #${orderId} is ready for pickup.`,
});
