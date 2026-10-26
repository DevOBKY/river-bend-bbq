import { z } from "zod";

// An agent is a model in a loop with tools. The model proposes; this file decides what actually runs.

// One request from the model to run a tool. The model chooses the name and the input, so both are
// untrusted, however sensible they look.
export type ToolCall = { id: string; name: string; input: unknown };
export type ToolResult = { id: string; content: string; isError: boolean };

// What the model says on each step: run these tools, or I'm finished. providerData is for the model
// adapter alone: anything its provider needs sent back exactly as it came (the loop never reads it).
export type AgentTurn =
  | { type: "tool_calls"; text: string; calls: ToolCall[]; providerData?: unknown }
  | { type: "done"; text: string; providerData?: unknown };

// The conversation so far, in our own format. Each model adapter translates it for its provider.
export type AgentMessage =
  | { role: "user"; text: string }
  | { role: "assistant"; turn: AgentTurn }
  | { role: "tool_results"; results: ToolResult[] };

// What the model is told about each tool: a name, when to use it, and the shape of its input.
export type ToolSpec = { name: string; description: string; inputSchema: Record<string, unknown> };

// What River Bend needs from a model to run an agent, and nothing more (like ModelClient in A2).
export interface AgentModel {
  // Shown with every run, so people always know what produced it.
  name: string;
  next(request: { system: string; messages: AgentMessage[]; tools: ToolSpec[] }): Promise<AgentTurn>;
}

export type Tool<Input = any> = {
  name: string;
  // The model decides when to use a tool from its name and description, so write them carefully.
  description: string;
  // Reads only look. Writes change something in the world, and count towards the run's limit.
  access: "read" | "write";
  input: z.ZodType<Input>;
  // A plain description of what this call would do, for the person asked to approve it.
  summarize(input: Input): string | Promise<string>;
  run(input: Input): Promise<string>;
};

// Lets TypeScript check each tool's summarize and run against its own input schema.
export function tool<Input>(definition: Tool<Input>): Tool<Input> {
  return definition;
}

// A tool couldn't do what it was asked, in a way the model should hear about and can work around
// (an order that doesn't exist, a status change the rules don't allow).
export class ToolError extends Error {}

// For each tool: run it, ask a person first, or don't offer it at all. Unlisted tools aren't offered.
export type Permission = "allow" | "ask" | "deny";
export type Policy = Record<string, Permission>;

// Asks a person to approve one action. Resolves true only if they said yes.
export type Approver = (request: { tool: string; summary: string }) => Promise<boolean>;

export type Limits = {
  // Model calls per run. Stops a confused agent from looping forever, at your expense.
  maxSteps: number;
  // Changes per run, even approved ones. Limits the damage any one run can do.
  maxWrites: number;
};

export const defaultLimits: Limits = { maxSteps: 10, maxWrites: 3 };

// Tool results become part of the next prompt: long ones cost money and crowd out the task.
export const MAX_RESULT_CHARS = 4000;

// One line per tool call, kept for review: what the model asked for, and what happened.
export type AuditEntry = {
  step: number;
  tool: string;
  input: unknown;
  outcome: "ran" | "failed" | "invalid" | "unknown_tool" | "declined" | "over_limit";
  result: string;
};

export type AgentRun = {
  status: "done" | "step_limit";
  text: string;
  steps: number;
  writes: number;
  audit: AuditEntry[];
};

export async function runAgent(options: {
  model: AgentModel;
  system: string;
  task: string;
  tools: Tool[];
  policy: Policy;
  approve: Approver;
  limits?: Partial<Limits>;
  // Hooks for showing a run as it happens: each model turn, then what happened to each tool call.
  onTurn?: (step: number, turn: AgentTurn) => void;
  onAudit?: (entry: AuditEntry) => void;
}): Promise<AgentRun> {
  const { model, system, task, policy, approve } = options;
  const maxSteps = options.limits?.maxSteps ?? defaultLimits.maxSteps;
  const maxWrites = options.limits?.maxWrites ?? defaultLimits.maxWrites;
  const permission = (name: string): Permission => policy[name] ?? "deny";

  // The model only learns about tools it may use. A denied tool simply doesn't exist for it.
  const tools = options.tools.filter((t) => permission(t.name) !== "deny");
  const specs = tools.map(toSpec);
  const messages: AgentMessage[] = [{ role: "user", text: task }];
  const audit: AuditEntry[] = [];
  let writes = 0;

  // Decides what happens to one tool call. Every way it can go wrong becomes a message the model
  // reads on its next step, so it can adjust instead of crashing the run.
  async function handle(call: ToolCall): Promise<Pick<AuditEntry, "outcome" | "result">> {
    const tool = tools.find((t) => t.name === call.name);
    if (!tool) return { outcome: "unknown_tool", result: `There is no tool named ${call.name}.` };

    const parsed = tool.input.safeParse(call.input);
    if (!parsed.success) {
      const issues = parsed.error.issues.map((i) => (i.path.length ? `${i.path.join(".")}: ${i.message}` : i.message));
      return { outcome: "invalid", result: `Invalid input for ${tool.name}: ${issues.join("; ")}` };
    }

    if (tool.access === "write") {
      if (writes >= maxWrites) {
        return { outcome: "over_limit", result: `This run has already made ${maxWrites} changes, the most allowed. Stop and report back.` };
      }
      writes++; // counted before asking, so a run can't keep asking once it's at the limit
    }

    if (permission(tool.name) === "ask") {
      const summary = await tool.summarize(parsed.data);
      if (!(await approve({ tool: tool.name, summary }))) {
        return { outcome: "declined", result: "A person declined this action. Don't try it another way; say what you wanted to do." };
      }
    }

    try {
      return { outcome: "ran", result: truncate(await tool.run(parsed.data)) };
    } catch (err) {
      // Expected problems go back to the model. Anything else is a bug: stop the run and show it.
      if (err instanceof ToolError) return { outcome: "failed", result: err.message };
      throw err;
    }
  }

  for (let step = 1; step <= maxSteps; step++) {
    const turn = await model.next({ system, messages, tools: specs });
    messages.push({ role: "assistant", turn });
    options.onTurn?.(step, turn);
    if (turn.type === "done") return { status: "done", text: turn.text, steps: step, writes, audit };

    const results: ToolResult[] = [];
    for (const call of turn.calls) {
      const { outcome, result } = await handle(call);
      const entry: AuditEntry = { step, tool: call.name, input: call.input, outcome, result };
      audit.push(entry);
      options.onAudit?.(entry);
      results.push({ id: call.id, content: result, isError: outcome !== "ran" });
    }
    messages.push({ role: "tool_results", results });
  }

  return { status: "step_limit", text: `Stopped after ${maxSteps} steps without finishing.`, steps: maxSteps, writes, audit };
}

function toSpec(tool: Tool): ToolSpec {
  const { $schema, ...inputSchema } = z.toJSONSchema(tool.input); // the "which JSON Schema version" line isn't needed
  return { name: tool.name, description: tool.description, inputSchema };
}

function truncate(text: string): string {
  return text.length <= MAX_RESULT_CHARS ? text : `${text.slice(0, MAX_RESULT_CHARS)}\n[cut: ${text.length - MAX_RESULT_CHARS} more characters]`;
}
