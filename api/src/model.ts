import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { z } from "zod";

// What River Bend needs from a language model, and nothing more. The rest of the app depends on
// this interface, so the provider can change and tests can pass a fake (S2, lesson 4).
export interface ModelClient {
  generateJson<T>(request: { system: string; prompt: string; schema: z.ZodType<T> }): Promise<T>;
  generateText(request: { system: string; prompt: string }): Promise<string>;
}

// The model couldn't give a usable answer: it declined, ran out of room, or broke the format.
export class ModelError extends Error {}

type Effort = "low" | "medium" | "high";

// The adapter for Claude, through Anthropic's SDK. Reads ANTHROPIC_API_KEY from the environment.
export class ClaudeModel implements ModelClient {
  client: Anthropic;
  model: string;
  effort: Effort;

  constructor(options: { client?: Anthropic; model?: string; effort?: Effort } = {}) {
    this.client = options.client ?? new Anthropic({ timeout: 60_000, maxRetries: 2 });
    this.model = options.model ?? "claude-opus-5-5";
    this.effort = options.effort ?? "medium";
  }

  async generateJson<T>({ system, prompt, schema }: { system: string; prompt: string; schema: z.ZodType<T> }) {
    const response = await call(() =>
      this.client.messages.parse({
        model: this.model,
        max_tokens: 16000,
        system,
        messages: [{ role: "user", content: prompt }],
        output_config: { effort: this.effort, format: zodOutputFormat(schema) },
      }),
    );
    logUsage(this.model, response.usage);
    checkStop(response.stop_reason);
    if (response.parsed_output == null) throw new ModelError("The model's answer didn't match the expected format");
    return response.parsed_output as T;
  }

  async generateText({ system, prompt }: { system: string; prompt: string }) {
    const response = await call(() =>
      this.client.messages.create({
        model: this.model,
        max_tokens: 16000,
        system,
        messages: [{ role: "user", content: prompt }],
        output_config: { effort: this.effort },
      }),
    );
    logUsage(this.model, response.usage);
    checkStop(response.stop_reason);
    return response.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("");
  }
}

// Turns the SDK's own errors (rate limits, timeouts, outages) into ModelError, so nothing outside
// this file needs to know which provider we use. The SDK has already retried what's worth retrying.
async function call<T>(request: () => Promise<T>): Promise<T> {
  try {
    return await request();
  } catch (err) {
    if (err instanceof Anthropic.APIError) throw new ModelError(`The model service failed: ${err.message}`, { cause: err });
    throw err;
  }
}

function checkStop(stopReason: string | null) {
  if (stopReason === "refusal") throw new ModelError("The model declined this request");
  if (stopReason === "max_tokens") throw new ModelError("The model ran out of room before finishing");
}

// One line per model call: tokens are what you pay for, so log them like any other cost.
function logUsage(model: string, usage: Anthropic.Usage) {
  console.log(JSON.stringify({ model, inputTokens: usage.input_tokens, outputTokens: usage.output_tokens }));
}
