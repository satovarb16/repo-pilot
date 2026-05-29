import Anthropic from '@anthropic-ai/sdk';
import type { SecretRedactor } from './secret-redactor.js';

export class ClaudeRateLimitError extends Error {
  constructor() {
    super('Claude API rate limit exceeded — retried once, still failing');
    this.name = 'ClaudeRateLimitError';
  }
}

export class ClaudeService {
  private readonly anthropic: Anthropic;

  constructor(
    apiKey: string,
    private readonly secretRedactor: SecretRedactor,
  ) {
    this.anthropic = new Anthropic({ apiKey });
  }

  async sendWithTools(
    messages: Anthropic.MessageParam[],
    tools: Anthropic.Tool[],
    toolExecutor: (name: string, args: unknown) => Promise<string>,
    systemPrompt?: string,
  ): Promise<Anthropic.MessageParam[]> {
    const current = [...messages];

    while (true) {
      const response = await this.callWithRetry(current, tools, systemPrompt);

      console.log(
        `[ClaudeService] tokens: input=${response.usage.input_tokens} output=${response.usage.output_tokens}`,
      );

      current.push({ role: 'assistant', content: response.content });

      if (response.stop_reason === 'end_turn') {
        return current;
      }

      if (response.stop_reason === 'tool_use') {
        const toolResults: Anthropic.ToolResultBlockParam[] = [];

        for (const block of response.content) {
          if (block.type === 'tool_use') {
            const raw = await toolExecutor(block.name, block.input);
            const redacted = this.secretRedactor.redact(raw);
            toolResults.push({
              type: 'tool_result',
              tool_use_id: block.id,
              content: redacted,
            });
          }
        }

        current.push({ role: 'user', content: toolResults });
      }
    }
  }

  private async callWithRetry(
    messages: Anthropic.MessageParam[],
    tools: Anthropic.Tool[],
    systemPrompt?: string,
  ): Promise<Anthropic.Message> {
    const params: Anthropic.MessageCreateParamsNonStreaming = {
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      messages,
      ...(tools.length > 0 ? { tools } : {}),
      ...(systemPrompt ? { system: systemPrompt } : {}),
    };

    try {
      return await this.anthropic.messages.create(params);
    } catch (err) {
      if (err instanceof Anthropic.APIError && err.status === 429) {
        await new Promise((r) => setTimeout(r, 60_000));
        try {
          return await this.anthropic.messages.create(params);
        } catch (retryErr) {
          if (retryErr instanceof Anthropic.APIError && retryErr.status === 429) {
            throw new ClaudeRateLimitError();
          }
          throw retryErr;
        }
      }
      throw err;
    }
  }
}
