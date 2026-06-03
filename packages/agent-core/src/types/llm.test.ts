/**
 * Compile-time import test — verifies the LLM neutral types exist and have
 * the correct shape. This test acts as the RED phase gate before llm.ts is created.
 */
import { describe, it, expectTypeOf } from 'vitest';
import type { LLMMessage, LLMTool, LLMToolCall, LLMToolResult } from './llm.js';

describe('LLM neutral types', () => {
  it('LLMMessage accepts a user text message', () => {
    const msg: LLMMessage = { role: 'user', content: 'Hello' };
    expectTypeOf(msg).toMatchTypeOf<LLMMessage>();
  });

  it('LLMMessage accepts an assistant message with null content', () => {
    const msg: LLMMessage = { role: 'assistant', content: null };
    expectTypeOf(msg).toMatchTypeOf<LLMMessage>();
  });

  it('LLMMessage accepts an assistant message with tool_calls', () => {
    const msg: LLMMessage = {
      role: 'assistant',
      content: null,
      tool_calls: [{ id: 'tc-1', function: { name: 'list_files', arguments: '{}' } }],
    };
    expectTypeOf(msg).toMatchTypeOf<LLMMessage>();
  });

  it('LLMMessage accepts a tool result message', () => {
    const msg: LLMMessage = { role: 'tool', tool_call_id: 'tc-1', content: 'output' };
    expectTypeOf(msg).toMatchTypeOf<LLMMessage>();
  });

  it('LLMTool accepts a function definition with parameters', () => {
    const tool: LLMTool = {
      name: 'list_files',
      description: 'List files',
      parameters: { type: 'object', properties: { path: { type: 'string' } } },
    };
    expectTypeOf(tool).toMatchTypeOf<LLMTool>();
  });

  it('LLMToolCall has id and function with name and arguments', () => {
    const tc: LLMToolCall = { id: 'tc-1', function: { name: 'read_file', arguments: '{"path":"x"}' } };
    expectTypeOf(tc).toMatchTypeOf<LLMToolCall>();
  });

  it('LLMToolResult has tool_call_id and content', () => {
    const r: LLMToolResult = { tool_call_id: 'tc-1', content: 'result' };
    expectTypeOf(r).toMatchTypeOf<LLMToolResult>();
  });
});
