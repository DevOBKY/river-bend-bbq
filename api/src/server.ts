import { serve } from "@hono/node-server";
import { createApp } from "./app.ts";
import { logEmailSender } from "./email.ts";
import { ClaudeModel } from "./model.ts";

// The AI features switch on only when there's a key to use.
const model = process.env.ANTHROPIC_API_KEY ? new ClaudeModel() : null;
if (!model) console.log("ANTHROPIC_API_KEY isn't set: the catering helper is switched off.");

const app = createApp({ email: logEmailSender, model });

const port = Number(process.env.PORT ?? 3000);
serve({ fetch: app.fetch, port }, () => {
  console.log(`River Bend BBQ API on http://localhost:${port}`);
});
