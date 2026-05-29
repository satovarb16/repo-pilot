import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SecretRedactor } from './secret-redactor.js';
import {
  ClaudeService,
  ClaudeRateLimitError,
  ClaudeContextLimitError,
  ClaudeMaxIterationsError,
  MAX_TOOL_ITERATIONS,
} from './claude-service.js';

vi.mock('@anthropic-ai/sdk', () => {
  const mockCreate = vi.fn();
  class APIError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
      this.name = 'APIError';
    }
  }
  class APIConnectionError extends Error {
    constructor(message: string) {
      super(message);
      this.name = 'APIConnectionError';
    }
  }
  const MockAnthropic = vi.fn().mockImplementation(() => ({
    messages: { create: mockCreate },
  }));
  // Attach APIError as a static property so `Anthropic.APIError` works in the implementation
  (MockAnthropic as any).APIError = APIError;
  (MockAnthropic as any).APIConnectionError = APIConnectionError;
  return { default: MockAnthropic, APIError, APIConnectionError };
});

import Anthropic from '@anthropic-ai/sdk';

function getMockCreate(service: ClaudeService): ReturnType<typeof vi.fn> {
  return (service as any).anthropic.messages.create;
}

function makeEndTurnResponse(text: string) {
  return {
    stop_reason: 'end_turn',
    content: [{ type: 'text', text }],
    usage: { input_tokens: 10, output_tokens: 5 },
  };
}

function makeToolUseResponse(id: string, name: string, input: Record<string, unknown>) {
  return {
    stop_reason: 'tool_use',
    content: [{ type: 'tool_use', id, name, input }],
    usage: { input_tokens: 10, output_tokens: 5 },
  };
}

describe('ClaudeService', () => {
  let service: ClaudeService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new ClaudeService('test-key', new SecretRedactor());
  });

  it('returns messages when Claude responds with end_turn', async () => {
    getMockCreate(service).mockResolvedValueOnce(makeEndTurnResponse('Here is my answer.'));

    const result = await service.sendWithTools(
      [{ role: 'user', content: 'Hello' }],
      [],
      async () => '',
    );

    expect(result).toHaveLength(2);
    expect(result[1].role).toBe('assistant');
  });

  it('executes tool and loops when Claude responds with tool_use', async () => {
    const toolExecutor = vi.fn().mockResolvedValue('file contents here');
    const mockCreate = getMockCreate(service);

    mockCreate
      .mockResolvedValueOnce({
        stop_reason: 'tool_use',
        content: [
          { type: 'text', text: 'Let me check the file.' },
          { type: 'tool_use', id: 'tu-1', name: 'read_file', input: { path: 'src/index.ts' } },
        ],
        usage: { input_tokens: 20, output_tokens: 10 },
      })
      .mockResolvedValueOnce(makeEndTurnResponse('Done.'));

    await service.sendWithTools(
      [{ role: 'user', content: 'Read index.ts' }],
      [],
      toolExecutor,
    );

    expect(toolExecutor).toHaveBeenCalledWith('read_file', { path: 'src/index.ts' });
    expect(mockCreate).toHaveBeenCalledTimes(2);
  });

  it('applies SecretRedactor to tool results — secret never reaches Claude', async () => {
    const secretOutput = 'DATABASE_URL=postgresql://user:s3cr3t@localhost/db';
    const toolExecutor = vi.fn().mockResolvedValue(secretOutput);
    const mockCreate = getMockCreate(service);

    mockCreate
      .mockResolvedValueOnce({
        stop_reason: 'tool_use',
        content: [
          { type: 'tool_use', id: 'tu-1', name: 'read_file', input: { path: '.env' } },
        ],
        usage: { input_tokens: 10, output_tokens: 5 },
      })
      .mockResolvedValueOnce(makeEndTurnResponse('Done.'));

    const messages = await service.sendWithTools(
      [{ role: 'user', content: 'Read .env' }],
      [],
      toolExecutor,
    );

    // The tool_result message is the 3rd message (user → assistant w/ tool_use → user w/ tool_result)
    const toolResultMsg = messages[2];
    const toolResultBlock = (toolResultMsg.content as any[])[0];
    expect(toolResultBlock.content).toContain('[REDACTED]');
    expect(toolResultBlock.content).not.toContain('s3cr3t');
  });

  it('retries once on 429 then throws ClaudeRateLimitError', async () => {
    vi.useFakeTimers();

    const RateLimitError = (Anthropic as any).APIError;
    getMockCreate(service).mockRejectedValue(new RateLimitError(429, 'Rate limited'));

    const promise = service.sendWithTools(
      [{ role: 'user', content: 'Hello' }],
      [],
      async () => '',
    );

    const assertion = expect(promise).rejects.toThrow(ClaudeRateLimitError);
    await vi.advanceTimersByTimeAsync(60_001);
    await assertion;
    expect(getMockCreate(service)).toHaveBeenCalledTimes(2);

    vi.useRealTimers();
  });

  it('throws ClaudeContextLimitError on max_tokens stop_reason', async () => {
    getMockCreate(service).mockResolvedValueOnce({
      stop_reason: 'max_tokens',
      content: [{ type: 'text', text: 'Truncated.' }],
      usage: { input_tokens: 10, output_tokens: 5 },
    });

    await expect(
      service.sendWithTools([{ role: 'user', content: 'Hello' }], [], async () => ''),
    ).rejects.toThrow(ClaudeContextLimitError);
  });

  it('throws on unknown stop_reason (e.g. stop_sequence)', async () => {
    getMockCreate(service).mockResolvedValueOnce({
      stop_reason: 'stop_sequence',
      content: [{ type: 'text', text: 'Stopped.' }],
      usage: { input_tokens: 10, output_tokens: 5 },
    });

    await expect(
      service.sendWithTools([{ role: 'user', content: 'Hello' }], [], async () => ''),
    ).rejects.toThrow('Unexpected stop_reason: stop_sequence');
  });

  it('throws ClaudeMaxIterationsError after 20 tool calls without end_turn', async () => {
    const mockCreate = getMockCreate(service);
    mockCreate.mockResolvedValue(makeToolUseResponse('tu-x', 'list_files', {}));

    await expect(
      service.sendWithTools([{ role: 'user', content: 'Go' }], [], async () => 'result'),
    ).rejects.toThrow(ClaudeMaxIterationsError);

    expect(mockCreate).toHaveBeenCalledTimes(MAX_TOOL_ITERATIONS + 1);
  });

  it('propagates network error without retry (fail fast)', async () => {
    const NetworkError = (Anthropic as any).APIConnectionError;
    getMockCreate(service).mockRejectedValue(new NetworkError('Connection refused'));

    await expect(
      service.sendWithTools([{ role: 'user', content: 'Hello' }], [], async () => ''),
    ).rejects.toThrow('Connection refused');

    expect(getMockCreate(service)).toHaveBeenCalledTimes(1);
  });

  it('propagates 500 server error without retry (fail fast)', async () => {
    const ServerError = (Anthropic as any).APIError;
    getMockCreate(service).mockRejectedValue(new ServerError(500, 'Internal Server Error'));

    await expect(
      service.sendWithTools([{ role: 'user', content: 'Hello' }], [], async () => ''),
    ).rejects.toThrow('Internal Server Error');

    expect(getMockCreate(service)).toHaveBeenCalledTimes(1);
  });

  it('propagates tool executor error', async () => {
    getMockCreate(service).mockResolvedValueOnce(
      makeToolUseResponse('tu-1', 'read_file', { path: 'src/index.ts' }),
    );

    await expect(
      service.sendWithTools(
        [{ role: 'user', content: 'Read it' }],
        [],
        async () => { throw new Error('MCP spawn failed'); },
      ),
    ).rejects.toThrow('MCP spawn failed');
  });

  it('logs token usage after each API call', async () => {
    const consoleSpy = vi.spyOn(console, 'log');
    getMockCreate(service).mockResolvedValueOnce(makeEndTurnResponse('Done.'));

    await service.sendWithTools([{ role: 'user', content: 'Hello' }], [], async () => '');

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('tokens:'),
    );
  });
});
