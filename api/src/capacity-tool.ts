import Anthropic from "@anthropic-ai/sdk";
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { kitchenCapacity } from "./capacity.ts";

// A tool the model can call: how many pounds of meat are already booked for a day.
const checkCapacity = betaZodTool({
  name: "check_capacity",
  description:
    "Look up how many pounds of meat are already ordered for pickup on a date. The kitchen can smoke 120 lb a day.",
  inputSchema: z.object({
    date: z.string().describe("The pickup date, as YYYY-MM-DD"),
  }),
  run: async ({ date }) => {
    const { bookedPounds, availablePounds } = await kitchenCapacity(date);
    return `${bookedPounds} lb booked for ${date}; ${availablePounds} lb still available.`;
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
