import { z } from "zod";
import type { EmailSender } from "./email.ts";
import type { JobHandlers } from "./jobs.ts";

const orderReady = z.object({ orderId: z.number().int(), to: z.email() });

// What each kind of job does. Payloads come from the database, so they're checked like any input.
export function jobHandlers({ email }: { email: EmailSender }): JobHandlers {
  return {
    "email.order_ready": async (payload) => {
      const { orderId, to } = orderReady.parse(payload);
      await email.send({ to, subject: "Your River Bend order is ready", text: `Order #${orderId} is ready for pickup.` });
    },
  };
}
