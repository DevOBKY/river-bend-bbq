// Runs the staff assistant on a scripted model (not AI), against a fresh in-memory copy of the
// sample data, so it never changes your ./db folder. Emails are written to the log, not sent.
//
// Usage: node agent.ts <ready|hijack|loop> [--yes | --no]
//   --yes / --no answer every approval question automatically; otherwise you're asked each time.
import { createInterface } from "node:readline/promises";

process.env.DB_DIR = "memory://"; // set before the database module loads, hence the imports below

const { runAgent } = await import("./src/agent/agent.ts");
const { scenarios } = await import("./src/agent/scenarios.ts");
const { ScriptedModel } = await import("./src/agent/scripted-model.ts");
const { staffPolicy, staffTools, STAFF_SYSTEM_PROMPT } = await import("./src/agent/staff-tools.ts");
const { db } = await import("./src/db.ts");
const { logEmailSender } = await import("./src/email.ts");

const [name, flag] = process.argv.slice(2);
const scenario = scenarios[name];
if (!scenario) {
  console.log(`Usage: node agent.ts <${Object.keys(scenarios).join("|")}> [--yes | --no]`);
  process.exit(1);
}

await scenario.setup?.();
const model = new ScriptedModel(scenario.script);
const prompt = createInterface({ input: process.stdin, output: process.stdout });

console.log(`Scenario: ${scenario.title}`);
console.log(`Model: ${model.name}`);
console.log(`Task: ${scenario.task}\n`);

const run = await runAgent({
  model,
  system: STAFF_SYSTEM_PROMPT,
  task: scenario.task,
  tools: staffTools({ email: logEmailSender }),
  policy: staffPolicy,
  limits: scenario.limits,
  approve: async ({ summary }) => {
    console.log(`    APPROVAL NEEDED\n    ${summary.replaceAll("\n", "\n    ")}`);
    if (flag === "--yes" || flag === "--no") {
      console.log(`    Allow? [y/N] ${flag === "--yes" ? "y" : "n"} (${flag})`);
      return flag === "--yes";
    }
    const answer = await prompt.question("    Allow? [y/N] ");
    return answer.trim().toLowerCase() === "y";
  },
  onTurn: (step, turn) => {
    console.log(`[step ${step}] model: ${turn.text}`);
    if (turn.type === "tool_calls") {
      for (const call of turn.calls) console.log(`  calls ${call.name} ${JSON.stringify(call.input)}`);
    }
  },
  onAudit: (entry) => {
    console.log(`    ${entry.outcome}: ${entry.result.length > 140 ? `${entry.result.slice(0, 140)}…` : entry.result}`);
  },
});

console.log(`\n${run.status === "done" ? "Finished" : "Stopped"} after ${run.steps} steps, ${run.writes} change(s) attempted.`);
console.log(`Answer: ${run.text}`);
prompt.close();
await db.close();
