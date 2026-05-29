import { z } from 'zod';

export const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  ANTHROPIC_API_KEY: z.string().min(1),
  TOKEN_ENCRYPTION_KEY: z.string().min(1),
  PORT: z.coerce.number().default(3001),
  REPO_ROOT: z.string().default('/tmp/repo-pilot/clones'),
  MCP_SERVER_PATH: z.string().min(1),
});

export type Env = z.infer<typeof envSchema>;

// Accept an explicit env map so tests can call parseEnv({ ... }) without
// touching process.env, and the server calls parseEnv() with no args.
export function parseEnv(raw: NodeJS.ProcessEnv = process.env): Env {
  return envSchema.parse(raw);
}
