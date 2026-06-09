import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SecretRedactor } from './secret-redactor.js';
import {
  OllamaService,
  OllamaContextLimitError,
  OllamaMaxIterationsError,
  OllamaConnectionError,
  MAX_TOOL_ITERATIONS,
} from './ollama-service.js';

// Mock the openai package — factory returns a class whose instance has
// chat.completions.create as a vi.fn()
vi.mock('openai', () => {
  const mockCreate = vi.fn();
  const MockOpenAI = vi.fn().mockImplementation(() => ({
    chat: { completions: { create: mockCreate } },
  }));
  return { default: MockOpenAI, OpenAI: MockOpenAI };
});

import { OpenAI } from 'openai';

/** Get the mock create fn from the service's internal client */
function getMockCreate(service: OllamaService): ReturnType<typeof vi.fn> {
  return (service as any).client.chat.completions.create;
}

/** Build a chat completion response that stops immediately */
function makeStopResponse(text: string, promptTokens = 10, completionTokens = 5) {
  return {
    choices: [{ message: { role: 'assistant', content: text, tool_calls: undefined }, finish_reason: 'stop' }],
    usage: { prompt_tokens: promptTokens, completion_tokens: completionTokens },
  };
}

/** Build a chat completion response that requests tool calls */
function makeToolCallResponse(
  toolCalls: Array<{ id: string; name: string; args: Record<string, unknown> }>,
  promptTokens = 10,
  completionTokens = 5,
) {
  return {
    choices: [
      {
        message: {
          role: 'assistant',
          content: null,
          tool_calls: toolCalls.map((tc) => ({
            id: tc.id,
            type: 'function',
            function: { name: tc.name, arguments: JSON.stringify(tc.args) },
          })),
        },
        finish_reason: 'tool_calls',
      },
    ],
    usage: { prompt_tokens: promptTokens, completion_tokens: completionTokens },
  };
}

/** Build a length-exceeded response */
function makeLengthResponse() {
  return {
    choices: [{ message: { role: 'assistant', content: null }, finish_reason: 'length' }],
    usage: { prompt_tokens: 100, completion_tokens: 0 },
  };
}

describe('OllamaService', () => {
  let service: OllamaService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new OllamaService('http://localhost:11434', 'qwen2.5-coder:7b', new SecretRedactor());
  });

  // -------------------------------------------------------------------------
  // S-01: Happy path — stop on first call
  // -------------------------------------------------------------------------

  it('S-01: returns messages when Ollama responds with stop on first call', async () => {
    getMockCreate(service).mockResolvedValueOnce(makeStopResponse('Here is my answer.'));

    const result = await service.sendWithTools(
      [{ role: 'user', content: 'Hello' }],
      [],
      async () => '',
    );

    // Should return original user message + assistant response
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ role: 'user', content: 'Hello' });
    expect(result[1]).toMatchObject({ role: 'assistant', content: 'Here is my answer.' });
  });

  it('S-01: calls onUsage once with promptTokens/completionTokens from stop response', async () => {
    const onUsage = vi.fn();
    getMockCreate(service).mockResolvedValueOnce(makeStopResponse('Done.', 42, 13));

    await service.sendWithTools(
      [{ role: 'user', content: 'Hello' }],
      [],
      async () => '',
      undefined,
      onUsage,
    );

    expect(onUsage).toHaveBeenCalledOnce();
    expect(onUsage).toHaveBeenCalledWith(42, 13);
  });

  // -------------------------------------------------------------------------
  // S-02: Tool call loop — multiple rounds before final answer
  // -------------------------------------------------------------------------

  it('S-02: executes tool, loops, and returns full conversation on 3-call sequence', async () => {
    const toolExecutor = vi.fn().mockResolvedValue('file contents');
    const mockCreate = getMockCreate(service);

    mockCreate
      .mockResolvedValueOnce(makeToolCallResponse([{ id: 'tc-1', name: 'read_file', args: { path: 'src/index.ts' } }]))
      .mockResolvedValueOnce(makeToolCallResponse([{ id: 'tc-2', name: 'list_files', args: {} }]))
      .mockResolvedValueOnce(makeStopResponse('Final answer.'));

    const result = await service.sendWithTools(
      [{ role: 'user', content: 'Analyze repo' }],
      [{ name: 'read_file', description: 'Read a file', parameters: { type: 'object' } }],
      toolExecutor,
    );

    // Ollama called 3 times total
    expect(mockCreate).toHaveBeenCalledTimes(3);

    // toolExecutor called once per round (1 tool call per response above)
    expect(toolExecutor).toHaveBeenCalledTimes(2);
    expect(toolExecutor).toHaveBeenNthCalledWith(1, 'read_file', { path: 'src/index.ts' });
    expect(toolExecutor).toHaveBeenNthCalledWith(2, 'list_files', {});

    // Result includes original + 2 assistant + 2 tool results + final assistant = 6 messages
    // user + [assistant w/ tool_calls, tool result, assistant w/ tool_calls, tool result] + final assistant
    expect(result.length).toBeGreaterThanOrEqual(4);
    expect(result[result.length - 1]).toMatchObject({ role: 'assistant', content: 'Final answer.' });
  });

  it('S-02: calls onUsage once per API response (3 calls = 3 onUsage invocations)', async () => {
    const onUsage = vi.fn();
    const mockCreate = getMockCreate(service);

    mockCreate
      .mockResolvedValueOnce(makeToolCallResponse([{ id: 'tc-1', name: 'list_files', args: {} }], 20, 10))
      .mockResolvedValueOnce(makeToolCallResponse([{ id: 'tc-2', name: 'list_files', args: {} }], 30, 15))
      .mockResolvedValueOnce(makeStopResponse('Done.', 40, 8));

    await service.sendWithTools(
      [{ role: 'user', content: 'Go' }],
      [],
      async () => 'result',
      undefined,
      onUsage,
    );

    expect(onUsage).toHaveBeenCalledTimes(3);
    expect(onUsage).toHaveBeenNthCalledWith(1, 20, 10);
    expect(onUsage).toHaveBeenNthCalledWith(2, 30, 15);
    expect(onUsage).toHaveBeenNthCalledWith(3, 40, 8);
  });

  it('S-02: tool results are redacted by SecretRedactor before being sent to Ollama', async () => {
    const secretOutput = 'DATABASE_URL=postgresql://user:s3cr3t@localhost/db';
    const toolExecutor = vi.fn().mockResolvedValue(secretOutput);
    const mockCreate = getMockCreate(service);

    mockCreate
      .mockResolvedValueOnce(makeToolCallResponse([{ id: 'tc-1', name: 'read_file', args: { path: '.env' } }]))
      .mockResolvedValueOnce(makeStopResponse('Done.'));

    const messages = await service.sendWithTools(
      [{ role: 'user', content: 'Read .env' }],
      [],
      toolExecutor,
    );

    // Find the tool message in the accumulated conversation
    const toolMsg = messages.find((m) => (m as any).role === 'tool') as any;
    expect(toolMsg).toBeDefined();
    expect(toolMsg.content).toContain('[REDACTED]');
    expect(toolMsg.content).not.toContain('s3cr3t');

    // Also verify the second API call's messages do not contain the raw secret
    const secondCallMessages = mockCreate.mock.calls[1][0].messages;
    const serialized = JSON.stringify(secondCallMessages);
    expect(serialized).not.toContain('s3cr3t');
  });

  // -------------------------------------------------------------------------
  // S-03: Max iterations exceeded
  // -------------------------------------------------------------------------

  it('S-03: throws OllamaMaxIterationsError after MAX_TOOL_ITERATIONS tool-call rounds', async () => {
    const mockCreate = getMockCreate(service);
    // Always returns tool_calls — loop runs until guard fires
    mockCreate.mockResolvedValue(
      makeToolCallResponse([{ id: 'tc-x', name: 'list_files', args: {} }]),
    );

    await expect(
      service.sendWithTools([{ role: 'user', content: 'Go' }], [], async () => 'result'),
    ).rejects.toThrow(OllamaMaxIterationsError);

    // 21 calls total: 20 tool-call rounds + 1 that triggers the error
    expect(mockCreate).toHaveBeenCalledTimes(MAX_TOOL_ITERATIONS + 1);
  });

  // -------------------------------------------------------------------------
  // S-04: Context limit
  // -------------------------------------------------------------------------

  it('S-04: throws OllamaContextLimitError on finish_reason length', async () => {
    const toolExecutor = vi.fn();
    getMockCreate(service).mockResolvedValueOnce(makeLengthResponse());

    await expect(
      service.sendWithTools([{ role: 'user', content: 'Hello' }], [], toolExecutor),
    ).rejects.toThrow(OllamaContextLimitError);

    // toolExecutor must never be called
    expect(toolExecutor).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // S-05: Ollama not running — connection refused
  // -------------------------------------------------------------------------

  it('S-05: throws OllamaConnectionError when network call fails with ECONNREFUSED', async () => {
    const toolExecutor = vi.fn();
    const connError = new Error('connect ECONNREFUSED 127.0.0.1:11434');
    (connError as any).cause = { code: 'ECONNREFUSED' };
    getMockCreate(service).mockRejectedValueOnce(connError);

    await expect(
      service.sendWithTools([{ role: 'user', content: 'Hello' }], [], toolExecutor),
    ).rejects.toThrow(OllamaConnectionError);

    // No retry — only one call attempt
    expect(getMockCreate(service)).toHaveBeenCalledTimes(1);
    // toolExecutor never invoked
    expect(toolExecutor).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // S-06: Secret in tool result — redacted before API send (covered in S-02 block above)
  // -------------------------------------------------------------------------

  // -------------------------------------------------------------------------
  // S-07: onUsage not provided — no throw
  // -------------------------------------------------------------------------

  it('S-07: completes without throwing when onUsage is not provided', async () => {
    getMockCreate(service).mockResolvedValueOnce(makeStopResponse('Done.'));

    await expect(
      service.sendWithTools([{ role: 'user', content: 'Hello' }], [], async () => ''),
    ).resolves.not.toThrow();
  });

  // -------------------------------------------------------------------------
  // Tool definition shape test (task 2.9)
  // -------------------------------------------------------------------------

  it('forwards LLMTool with parameters as OpenAI function definition', async () => {
    getMockCreate(service).mockResolvedValueOnce(makeStopResponse('Done.'));

    const tool = {
      name: 'list_files',
      description: 'List all files',
      parameters: { type: 'object', properties: { path: { type: 'string' } } },
    };

    await service.sendWithTools([{ role: 'user', content: 'Hello' }], [tool], async () => '');

    const callArgs = getMockCreate(service).mock.calls[0][0];
    expect(callArgs.tools).toEqual([
      {
        type: 'function',
        function: {
          name: 'list_files',
          description: 'List all files',
          parameters: { type: 'object', properties: { path: { type: 'string' } } },
        },
      },
    ]);
  });

  // -------------------------------------------------------------------------
  // System prompt forwarding
  // -------------------------------------------------------------------------

  it('prepends system message when systemPrompt is provided', async () => {
    getMockCreate(service).mockResolvedValueOnce(makeStopResponse('Done.'));

    await service.sendWithTools(
      [{ role: 'user', content: 'Hello' }],
      [],
      async () => '',
      'You are a helpful assistant.',
    );

    const callArgs = getMockCreate(service).mock.calls[0][0];
    expect(callArgs.messages[0]).toMatchObject({ role: 'system', content: 'You are a helpful assistant.' });
  });

  // -------------------------------------------------------------------------
  // Unknown finish_reason
  // -------------------------------------------------------------------------

  it('throws on unknown finish_reason', async () => {
    getMockCreate(service).mockResolvedValueOnce({
      choices: [{ message: { role: 'assistant', content: null }, finish_reason: 'content_filter' }],
      usage: { prompt_tokens: 10, completion_tokens: 0 },
    });

    await expect(
      service.sendWithTools([{ role: 'user', content: 'Hello' }], [], async () => ''),
    ).rejects.toThrow('Unexpected finish_reason: content_filter');
  });

  // -------------------------------------------------------------------------
  // Constructor wires correct baseURL
  // -------------------------------------------------------------------------

  it('constructs OpenAI client with baseURL including /v1 suffix and dummy apiKey', () => {
    new OllamaService('http://example.com:11434', 'llama3', new SecretRedactor());

    const lastCall = (OpenAI as any).mock.calls.at(-1)[0];
    expect(lastCall.baseURL).toBe('http://example.com:11434/v1');
    expect(lastCall.apiKey).toBe('ollama');
  });
});
