/**
 * Provider-neutral LLM types for agent-core.
 * These types map to the OpenAI-compatible API shape that Ollama exposes.
 * Do NOT import from @anthropic-ai/sdk or openai here — this file must stay
 * free of provider dependencies so callers (AgentStateMachine) stay portable.
 */

export interface LLMToolCall {
  id: string;
  function: {
    name: string;
    /** JSON-encoded args string — parse with JSON.parse() before use */
    arguments: string;
  };
}

export interface LLMToolResult {
  tool_call_id: string;
  content: string;
}

/**
 * Neutral tool definition that maps directly to the OpenAI function-calling
 * format. AgentStateMachine declares tools with `parameters` (not `input_schema`)
 * to match the OpenAI/Ollama convention.
 */
export interface LLMTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>; // JSON Schema object
}

/**
 * OpenAI-compatible message union.
 *
 * - system / user: plain string content
 * - assistant: string | null content, optional tool_calls array
 * - tool: tool result keyed by tool_call_id
 *
 * Stored verbatim as Prisma Json in AgentRun.planJson.
 */
export type LLMMessage =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string | null; tool_calls?: LLMToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string };
