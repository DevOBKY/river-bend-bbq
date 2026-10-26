import { existsSync, readFileSync } from "node:fs";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { createApp } from "./app.ts";
import { logEmailSender } from "./email.ts";
import { jobHandlers } from "./job-handlers.ts";
import { startWorker } from "./jobs.ts";

const api = createApp();

// In production, one service serves both halves (lesson 3): the API under /api, and the built
// React site for everything else. In development, Vite serves the site and forwards /api here.
const webDist = process.env.WEB_DIST;
let fetch = api.fetch;
if (webDist && existsSync(webDist)) {
  const site = new Hono();
  site.route("/api", api);
  // Without this, a mistyped API path would fall through to the website below and answer with HTML.
  site.all("/api/*", (c) => c.json({ error: "Not found" }, 404));
  site.use("/*", serveStatic({ root: webDist }));
  const index = readFileSync(`${webDist}/index.html`, "utf8");
  site.get("*", (c) => c.html(index)); // the React app's own pages, like /checkout
  fetch = site.fetch;
}

// The job worker runs inside this process. With PGlite only one program can open the database,
// so it can't be separate; with a server database like Postgres, it usually is (lesson 2).
startWorker(jobHandlers({ email: logEmailSender }));

const port = Number(process.env.PORT ?? 3000);
serve({ fetch, port }, () => {
  console.log(`River Bend BBQ API on http://localhost:${port}${webDist ? ", serving the site too" : ""}`);
});
