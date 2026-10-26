import Anthropic from "@anthropic-ai/sdk";
import { ModelError } from "../model.ts";
import type { AgentMessage, AgentModel, AgentTurn } from "./agent.ts";

// OPTIONAL, and not run by the course authors: an AgentModel backed by Claude, through Anthropic's
// SDK. It's typechecked against the SDK, but has never been run against a live model. Reads
// ANTHROPIC_API_KEY from the environment; every call is billed. The rest of the agent (the loop,
// tools, permissions, limits, and log) works the same with this or with ScriptedModel.
export class ClaudeAgentModel implements AgentModel {
  client: Anthropic;
  model: string;

  constructor(options: { client?: Anthropic; model?: string } = {}) {
    this.client = options.client ?? new Anthropic({ timeout: 60_000, maxRetries: 2 });
    this.model = options.model ?? "claude-opus-5-5";
  }

  get name() {
    return `${this.model} (AI)`;
  }

  async next({ system, messages, tools }: Parameters<AgentModel["next"]>[0]): Promise<AgentTurn> {
    let response: Anthropic.Message;
    try {
      response = await this.client.messages.create({
        model: this.model,
        max_tokens: 16000,
        system,
        output_config: { effort: "medium" },
        // Our own code validates every input again before running a tool, whatever the model sends.
        tools: tools.map((t) => ({
          name: t.name,
          description: t.description,
          input_schema: t.inputSchema as Anthropic.Tool.InputSchema,
        })),
        messages: messages.map(toClaudeMessage),
      });
    } catch (err) {
      if (err instanceof Anthropic.APIError) throw new ModelError(`The model service failed: ${err.message}`, { cause: err });
      throw err;
    }

    console.log(JSON.stringify({ model: this.model, inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens }));
    if (response.stop_reason === "refusal") throw new ModelError("The model declined this request");
    if (response.stop_reason === "max_tokens") throw new ModelError("The model ran out of room before finishing");

    const text = response.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("");
    const calls = response.content
      .filter((block) => block.type === "tool_use")
      .map((block) => ({ id: block.id, name: block.name, input: block.input }));

    // The whole response goes back to the API on the next step, unchanged, as the provider requires.
    if (response.stop_reason === "tool_use" && calls.length > 0) {
      return { type: "tool_calls", text, calls, providerData: response.content };
    }
    return { type: "done", text, providerData: response.content };
  }
}

// Translates our conversation format into the Messages API's.
function toClaudeMessage(message: AgentMessage): Anthropic.MessageParam {
  switch (message.role) {
    case "user":
      return { role: "user", content: message.text };
    case "assistant":
      return { role: "assistant", content: (message.turn.providerData as Anthropic.ContentBlock[] | undefined) ?? fromTurn(message.turn) };
    case "tool_results":
      // All results for one step go back together, in one message.
      return {
        role: "user",
        content: message.results.map((r) => ({ type: "tool_result", tool_use_id: r.id, content: r.content, is_error: r.isError })),
      };
  }
}

// For turns that didn't come from Claude (a scripted turn in a test, say): rebuild them as blocks.
function fromTurn(turn: AgentTurn): Anthropic.ContentBlockParam[] {
  const blocks: Anthropic.ContentBlockParam[] = turn.text ? [{ type: "text", text: turn.text }] : [];
  if (turn.type === "tool_calls") {
    for (const call of turn.calls) blocks.push({ type: "tool_use", id: call.id, name: call.name, input: call.input });
  }
  return blocks;
}
