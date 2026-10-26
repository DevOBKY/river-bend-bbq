import { serve } from "@hono/node-server";
import { createApp } from "./app.ts";
import { logEmailSender } from "./email.ts";

const app = createApp({ email: logEmailSender });

const port = Number(process.env.PORT ?? 3000);
serve({ fetch: app.fetch, port }, () => {
  console.log(`River Bend BBQ API on http://localhost:${port}`);
});
