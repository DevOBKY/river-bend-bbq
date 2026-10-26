import { serve } from "@hono/node-server";
import { createApp } from "./app.ts";
import { logEmailSender } from "./email.ts";
import { DemoModel } from "./demo-model.ts";
import { ClaudeModel } from "./model.ts";

// No key needed: without one, the catering helper runs on simple rules (DemoModel), and says so.
const model = process.env.ANTHROPIC_API_KEY ? new ClaudeModel() : new DemoModel();
console.log(`Catering helper: ${model.name}`);

const app = createApp({ email: logEmailSender, model });

const port = Number(process.env.PORT ?? 3000);
serve({ fetch: app.fetch, port }, () => {
  console.log(`River Bend BBQ API on http://localhost:${port}`);
});
