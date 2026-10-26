import Anthropic from "@anthropic-ai/sdk";
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { db } from "./db.ts";

// A tool the model can call: how many pounds of meat are already booked for a day.
const checkCapacity = betaZodTool({
  name: "check_capacity",
  description:
    "Look up how many pounds of meat are already ordered for pickup on a date. The kitchen can smoke 120 lb a day.",
  inputSchema: z.object({
    date: z.string().describe("The pickup date, as YYYY-MM-DD"),
  }),
  run: async ({ date }) => {
    const result = await db.query<{ pounds: number }>(
      `SELECT coalesce(sum(oi.quantity), 0)::int AS pounds
       FROM order_items oi
       JOIN orders o ON o.id = oi.order_id
       JOIN menu_items m ON m.id = oi.menu_item_id
       WHERE m.category = 'meat' AND o.status <> 'cancelled'
         AND (o.pickup_at AT TIME ZONE 'America/Chicago')::date = $1::date`,
      [date],
    );
    const booked = result.rows[0].pounds;
    return `${booked} lb booked for ${date}; ${120 - booked} lb still available.`;
  },
});

export async function askAboutCapacity(question: string) {
  const client = new Anthropic();
  const finalMessage = await client.beta.messages.toolRunner({
    model: "claude-opus-5-5",
    max_tokens: 16000,
    system: "You help River Bend BBQ staff answer questions about kitchen capacity. Use the tool to check real bookings.",
    tools: [checkCapacity],
    messages: [{ role: "user", content: question }],
  });
  return finalMessage.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("");
}

// Exported so the tool's own logic can be tested without a model.
export const runCheckCapacity = (date: string) => checkCapacity.run({ date });
