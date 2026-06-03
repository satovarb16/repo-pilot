import { z } from 'zod';

export const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  TOKEN_ENCRYPTION_KEY: z.string().min(1),
  PORT: z.coerce.number().default(3001),
  REPO_ROOT: z.string().default('/tmp/repo-pilot/clones'),
  MCP_SERVER_PATH: z.string().min(1),
  // Optional — when absent, SandboxRunner falls back to child_process
  DOCKER_SOCKET: z.string().optional(),
  // Concurrency cap: max simultaneous active agent runs. 0 = unlimited (default 2).
  MAX_CONCURRENT_RUNS: z.coerce.number().int().min(0).default(2),
  // Ollama provider settings — both optional with sensible defaults
  OLLAMA_BASE_URL: z.string().url().default('http://localhost:11434'),
  OLLAMA_MODEL: z.string().min(1).default('qwen2.5-coder:7b'),
});

export type Env = z.infer<typeof envSchema>;

// Accept an explicit env map so tests can call parseEnv({ ... }) without
// touching process.env, and the server calls parseEnv() with no args.
export function parseEnv(raw: NodeJS.ProcessEnv = process.env): Env {
  return envSchema.parse(raw);
}
