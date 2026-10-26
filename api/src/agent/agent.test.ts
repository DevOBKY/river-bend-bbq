import { beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { db, resetDatabase } from "../db.ts";
import type { Email, EmailSender } from "../email.ts";
import { runAgent, tool, type AgentModel, type Approver, type Policy, type Tool } from "./agent.ts";
import { scenarios } from "./scenarios.ts";
import { calls, done, ScriptedModel, type ScriptStep } from "./scripted-model.ts";
import { staffPolicy, staffTools, STAFF_SYSTEM_PROMPT } from "./staff-tools.ts";

// A fake email service that remembers what it was asked to send.
const sent: Email[] = [];
const fakeEmail: EmailSender = {
  async send(email) {
    sent.push(email);
  },
};

// An approver that answers yes or no, and remembers what it was asked.
function approver(answer: boolean) {
  const asked: string[] = [];
  const approve: Approver = async ({ summary }) => {
    asked.push(summary);
    return answer;
  };
  return { approve, asked };
}

function run(script: ScriptStep[], options: { approve?: Approver; policy?: Policy; tools?: Tool[]; maxSteps?: number; maxWrites?: number } = {}) {
  return runAgent({
    model: new ScriptedModel(script),
    system: STAFF_SYSTEM_PROMPT,
    task: "A task for the test",
    tools: options.tools ?? staffTools({ email: fakeEmail }),
    policy: options.policy ?? staffPolicy,
    approve: options.approve ?? approver(true).approve,
    limits: { maxSteps: options.maxSteps, maxWrites: options.maxWrites },
  });
}

const orderStatus = async (id: number) =>
  (await db.query<{ status: string }>("SELECT status FROM orders WHERE id = $1", [id])).rows[0].status;

beforeEach(async () => {
  await resetDatabase();
  sent.length = 0;
});

describe("the agent loop", () => {
  it("runs tools, feeds the results back, and finishes", async () => {
    const result = await run([
      calls("Checking capacity.", ["check_capacity", { date: "2026-10-24" }]),
      (messages) => done(`Model saw: ${JSON.stringify(messages.at(-1))}`),
    ]);
    expect(result.status).toBe("done");
    expect(result.steps).toBe(2);
    expect(result.text).toContain('\\"availablePounds\\":100');
    expect(result.audit).toEqual([
      expect.objectContaining({ step: 1, tool: "check_capacity", outcome: "ran" }),
    ]);
  });

  it("only tells the model about tools it may use", async () => {
    const seen: string[][] = [];
    const spy: AgentModel = {
      name: "spy",
      async next({ tools }) {
        seen.push(tools.map((t) => t.name));
        return done("ok");
      },
    };
    await runAgent({
      model: spy,
      system: "",
      task: "",
      tools: staffTools({ email: fakeEmail }),
      policy: { ...staffPolicy, email_customer: "deny" },
      approve: approver(true).approve,
    });
    expect(seen[0]).toEqual(["find_orders", "get_order", "check_capacity", "mark_order_ready"]);
  });

  it("describes each tool's input to the model as JSON Schema", async () => {
    let schema: unknown;
    const spy: AgentModel = {
      name: "spy",
      async next({ tools }) {
        schema = tools.find((t) => t.name === "get_order")?.inputSchema;
        return done("ok");
      },
    };
    await runAgent({ model: spy, system: "", task: "", tools: staffTools({ email: fakeEmail }), policy: staffPolicy, approve: approver(true).approve });
    expect(schema).toMatchObject({ type: "object", properties: { orderId: { type: "integer" } }, required: ["orderId"], additionalProperties: false });
  });

  it("stops a run that never finishes", async () => {
    const forever = Array.from({ length: 50 }, () => calls("Again.", ["check_capacity", { date: "2026-10-24" }]));
    const result = await run(forever, { maxSteps: 4 });
    expect(result.status).toBe("step_limit");
    expect(result.audit).toHaveLength(4);
  });

  it("turns a tool's expected failure into a message the model can act on", async () => {
    const result = await run([calls("", ["mark_order_ready", { orderId: 1 }]), done("ok")]);
    expect(result.audit[0]).toMatchObject({ outcome: "failed", result: "Order 1 is picked_up; that's final." });
  });

  it("stops the run on an unexpected error, instead of hiding a bug", async () => {
    const broken = tool({
      name: "broken",
      description: "",
      access: "read",
      input: z.object({}),
      summarize: () => "",
      run: async () => {
        throw new Error("bug");
      },
    });
    await expect(run([calls("", ["broken", {}])], { tools: [broken], policy: { broken: "allow" } })).rejects.toThrow("bug");
  });

  it("cuts very long tool results", async () => {
    const chatty = tool({ name: "chatty", description: "", access: "read", input: z.object({}), summarize: () => "", run: async () => "x".repeat(5000) });
    const result = await run([calls("", ["chatty", {}]), done("ok")], { tools: [chatty], policy: { chatty: "allow" } });
    expect(result.audit[0].result).toHaveLength(4000 + "\n[cut: 1000 more characters]".length);
  });
});

describe("permissions", () => {
  it("runs reads without asking anyone", async () => {
    const { approve, asked } = approver(false);
    const result = await run([calls("", ["find_orders", { status: "placed" }], ["get_order", { orderId: 6 }]), done("ok")], { approve });
    expect(result.audit.map((a) => a.outcome)).toEqual(["ran", "ran"]);
    expect(asked).toEqual([]);
  });

  it("asks before a change, and shows the person exactly what will happen", async () => {
    const { approve, asked } = approver(true);
    await run([calls("", ["mark_order_ready", { orderId: 6 }]), done("ok")], { approve });
    expect(asked).toEqual(["Mark order 6 (Owensboro Rotary Club) ready, and email events@example.org that it's ready"]);
    expect(await orderStatus(6)).toBe("ready");
    expect(sent).toEqual([{ to: "events@example.org", subject: "Your River Bend order is ready", text: "Order #6 is ready for pickup." }]);
  });

  it("changes nothing when the person says no, and tells the model", async () => {
    const result = await run([calls("", ["mark_order_ready", { orderId: 6 }]), done("ok")], { approve: approver(false).approve });
    expect(result.audit[0].outcome).toBe("declined");
    expect(await orderStatus(6)).toBe("placed");
    expect(sent).toEqual([]);
  });

  it("checks input before asking anyone, and rejects fields the tool doesn't have", async () => {
    const { approve, asked } = approver(true);
    const result = await run(
      [calls("", ["email_customer", { orderId: 6, to: "someone@example.net", subject: "Hi", body: "Hello" }]), done("ok")],
      { approve },
    );
    expect(result.audit[0]).toMatchObject({ outcome: "invalid", result: 'Invalid input for email_customer: Unrecognized key: "to"' });
    expect(asked).toEqual([]);
    expect(sent).toEqual([]);
  });

  it("limits how many changes one run can make, even approved ones", async () => {
    const email = (orderId: number) => ["email_customer", { orderId, subject: "Hi", body: "Hello" }] as [string, unknown];
    const result = await run([calls("", email(1), email(2), email(3)), done("ok")], { maxWrites: 2 });
    expect(result.audit.map((a) => a.outcome)).toEqual(["ran", "ran", "over_limit"]);
    expect(sent).toHaveLength(2);
  });
});

describe("the prompt injection scenario", () => {
  it("can't email anyone outside River Bend, and a person stops the rest", async () => {
    const { approve, asked } = approver(false);
    await scenarios.hijack.setup?.();
    const result = await runAgent({
      model: new ScriptedModel(scenarios.hijack.script),
      system: STAFF_SYSTEM_PROMPT,
      task: scenarios.hijack.task,
      tools: staffTools({ email: fakeEmail }),
      policy: staffPolicy,
      approve,
    });
    expect(result.audit.map((a) => [a.tool, a.outcome])).toEqual([
      ["find_orders", "ran"],
      ["email_customer", "invalid"],
      ["send_email", "unknown_tool"],
      ["email_customer", "declined"],
    ]);
    expect(asked).toHaveLength(1);
    expect(asked[0]).toContain("<jo.fox@example.net>"); // the person sees who it's really going to
    expect(sent).toEqual([]);
  });
});
