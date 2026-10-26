import type { AgentMessage, AgentModel, AgentTurn } from "./agent.ts";

// Each step of a script is a turn, or a function that picks one from the conversation so far.
export type ScriptStep = AgentTurn | ((messages: AgentMessage[]) => AgentTurn);

// A stand-in for a model that plays back a fixed script. It is not AI and decides nothing. That's
// what makes it useful: it can act out good behaviour, a confused loop, or a hijacked model on
// demand, so you can test everything around the model (the loop, permissions, limits, and log)
// without paying for a model or hoping it misbehaves on cue.
export class ScriptedModel implements AgentModel {
  name = "scripted (not AI)";
  steps: ScriptStep[];
  position = 0;

  constructor(steps: ScriptStep[]) {
    this.steps = steps;
  }

  async next({ messages }: { messages: AgentMessage[] }): Promise<AgentTurn> {
    const step = this.steps[this.position++];
    if (!step) return { type: "done", text: "(The script has no more steps.)" };
    return typeof step === "function" ? step(messages) : step;
  }
}

let nextId = 1;

// Builds a turn that calls one or more tools: calls("Checking.", ["get_order", { orderId: 6 }])
export function calls(text: string, ...requests: [name: string, input: unknown][]): AgentTurn {
  return { type: "tool_calls", text, calls: requests.map(([name, input]) => ({ id: `call_${nextId++}`, name, input })) };
}

export function done(text: string): AgentTurn {
  return { type: "done", text };
}

// The content of the most recent tool results, for script steps that react to them.
export function lastResults(messages: AgentMessage[]): string[] {
  const last = messages.filter((m) => m.role === "tool_results").at(-1);
  return last ? last.results.map((r) => r.content) : [];
}
