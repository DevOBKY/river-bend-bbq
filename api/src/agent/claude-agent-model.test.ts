import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { ModelError } from "../model.ts";
import type { AgentMessage } from "./agent.ts";
import { ClaudeAgentModel } from "./claude-agent-model.ts";

// These tests check the translation to and from the Messages API with a fake client. They make no
// network calls and prove nothing about how a real model behaves.
function fakeClient(responses: Partial<Anthropic.Message>[]) {
  const requests: Anthropic.MessageCreateParamsNonStreaming[] = [];
  const client = {
    messages: {
      async create(request: Anthropic.MessageCreateParamsNonStreaming) {
        requests.push(structuredClone(request));
        return { usage: { input_tokens: 1, output_tokens: 1 }, ...responses.shift() };
      },
    },
  } as unknown as Anthropic;
  return { client, requests };
}

const tools = [{ name: "get_order", description: "Get an order", inputSchema: { type: "object", properties: { orderId: { type: "integer" } } } }];

describe("ClaudeAgentModel", () => {
  it("turns tool_use blocks into tool calls, and sends results back as tool_result blocks", async () => {
    const content = [
      { type: "text", text: "Checking." },
      { type: "tool_use", id: "toolu_1", name: "get_order", input: { orderId: 6 } },
    ] as Anthropic.ContentBlock[];
    const { client, requests } = fakeClient([
      { stop_reason: "tool_use", content },
      { stop_reason: "end_turn", content: [{ type: "text", text: "Done." }] as Anthropic.ContentBlock[] },
    ]);
    const model = new ClaudeAgentModel({ client });

    const messages: AgentMessage[] = [{ role: "user", text: "Look up order 6" }];
    const first = await model.next({ system: "sys", messages, tools });
    expect(first).toMatchObject({ type: "tool_calls", text: "Checking.", calls: [{ id: "toolu_1", name: "get_order", input: { orderId: 6 } }] });

    messages.push({ role: "assistant", turn: first });
    messages.push({ role: "tool_results", results: [{ id: "toolu_1", content: "No order 6", isError: true }] });
    const second = await model.next({ system: "sys", messages, tools });

    expect(second).toMatchObject({ type: "done", text: "Done." });
    expect(requests[0].tools).toEqual([{ name: "get_order", description: "Get an order", input_schema: tools[0].inputSchema }]);
    expect(requests[1].messages).toEqual([
      { role: "user", content: "Look up order 6" },
      { role: "assistant", content }, // sent back exactly as it came
      { role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_1", content: "No order 6", is_error: true }] },
    ]);
  });

  it("treats a refusal as a model error", async () => {
    const { client } = fakeClient([{ stop_reason: "refusal", content: [] }]);
    await expect(new ClaudeAgentModel({ client }).next({ system: "", messages: [{ role: "user", text: "x" }], tools })).rejects.toThrow(ModelError);
  });
});
