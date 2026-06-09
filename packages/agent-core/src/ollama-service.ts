import { OpenAI } from 'openai';
import type { SecretRedactor } from './secret-redactor.js';
import type { LLMMessage, LLMTool, LLMToolCall } from './types/llm.js';

export const MAX_TOOL_ITERATIONS = 20;

// -------------------------------------------------------------------------
// Error types (renamed from Claude* to Ollama*)
// -------------------------------------------------------------------------

export class OllamaContextLimitError extends Error {
  constructor() {
    super(
      'Ollama context limit reached (finish_reason: length) — reduce input or use a model with a larger context window',
    );
    this.name = 'OllamaContextLimitError';
  }
}

export class OllamaMaxIterationsError extends Error {
  constructor() {
    super(`Ollama tool loop exceeded ${MAX_TOOL_ITERATIONS} iterations without stop`);
    this.name = 'OllamaMaxIterationsError';
  }
}

export class OllamaConnectionError extends Error {
  constructor(baseUrl: string) {
    super(`Cannot connect to Ollama at ${baseUrl} — is Ollama running?`);
    this.name = 'OllamaConnectionError';
  }
}

// -------------------------------------------------------------------------
// OllamaService
// -------------------------------------------------------------------------

export class OllamaService {
  private readonly client: OpenAI;

  constructor(
    private readonly baseUrl: string,
    private readonly model: string,
    private readonly secretRedactor: SecretRedactor,
  ) {
    // Ollama exposes an OpenAI-compatible /v1 endpoint.
    // The apiKey value is required by the SDK but ignored by Ollama.
    this.client = new OpenAI({ baseURL: `${baseUrl}/v1`, apiKey: 'ollama' });
  }

  /**
   * Send messages to Ollama in a tool-use loop.
   *
   * @param messages   Accumulated conversation so far (LLMMessage[])
   * @param tools      Tool definitions forwarded to Ollama as OpenAI functions
   * @param toolExecutor  Called once per tool invocation with (name, parsedArgs)
   * @param systemPrompt  Optional system message prepended to the conversation
   * @param onUsage    Called once per API response with (promptTokens, completionTokens)
   * @returns Full accumulated conversation including all intermediate messages
   */
  async sendWithTools(
    messages: LLMMessage[],
    tools: LLMTool[],
    toolExecutor: (name: string, args: Record<string, unknown>) => Promise<string>,
    systemPrompt?: string,
    onUsage?: (inputTokens: number, outputTokens: number) => void,
  ): Promise<LLMMessage[]> {
    // Build the initial message list; prepend system prompt when provided
    const current: LLMMessage[] = [
      ...(systemPrompt ? [{ role: 'system' as const, content: systemPrompt }] : []),
      ...messages,
    ];

    // Convert neutral LLMTool definitions to the OpenAI function-calling shape
    const openAITools =
      tools.length > 0
        ? tools.map((t) => ({
            type: 'function' as const,
            function: { name: t.name, description: t.description, parameters: t.parameters },
          }))
        : undefined;

    let toolIterations = 0;

    while (true) {
      let response: Awaited<ReturnType<typeof this.client.chat.completions.create>>;

      try {
        response = await this.client.chat.completions.create({
          model: this.model,
          messages: current as Parameters<typeof this.client.chat.completions.create>[0]['messages'],
          ...(openAITools ? { tools: openAITools, tool_choice: 'auto' } : {}),
        });
      } catch (err) {
        // Surface connection failures as typed OllamaConnectionError (no retry — local service)
        throw new OllamaConnectionError(this.baseUrl);
      }

      const choice = response.choices[0];
      const finishReason = choice.finish_reason;
      const assistantMsg = choice.message;

      // Report token usage to caller immediately after a successful response
      const usage = response.usage;
      if (usage) {
        onUsage?.(usage.prompt_tokens, usage.completion_tokens);
      }

      console.log(
        `[OllamaService] tokens: input=${usage?.prompt_tokens ?? 0} output=${usage?.completion_tokens ?? 0} finish=${finishReason}`,
      );

      if (finishReason === 'stop') {
        // Push the final assistant message and return the full conversation
        current.push({ role: 'assistant', content: assistantMsg.content ?? '' });
        return current;
      }

      if (finishReason === 'length') {
        throw new OllamaContextLimitError();
      }

      if (finishReason === 'tool_calls') {
        toolIterations++;

        // Push the assistant message including its tool_calls array
        const toolCalls: LLMToolCall[] = (assistantMsg.tool_calls ?? []).map((tc) => ({
          id: tc.id,
          function: { name: tc.function.name, arguments: tc.function.arguments },
        }));
        current.push({ role: 'assistant', content: assistantMsg.content ?? null, tool_calls: toolCalls });

        // Execute each tool call and collect redacted results
        for (const tc of assistantMsg.tool_calls ?? []) {
          const parsedArgs = JSON.parse(tc.function.arguments) as Record<string, unknown>;
          const rawResult = await toolExecutor(tc.function.name, parsedArgs);
          const redacted = this.secretRedactor.redact(rawResult);
          current.push({ role: 'tool', tool_call_id: tc.id, content: redacted });
        }

        // Guard against infinite loops (counter increments after processing, check after adding)
        if (toolIterations > MAX_TOOL_ITERATIONS) {
          throw new OllamaMaxIterationsError();
        }

        continue;
      }

      throw new Error(`Unexpected finish_reason: ${finishReason}`);
    }
  }
}
