import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { randomUUID } from 'node:crypto';

export class MCPTimeoutError extends Error {
  constructor(toolName: string) {
    super(`MCP tool '${toolName}' timed out after 30s`);
    this.name = 'MCPTimeoutError';
  }
}

export class MCPClientManager {
  private client: Client | null = null;
  private started = false;

  constructor(
    private readonly repoRoot: string,
    private readonly serverPath: string,
  ) {}

  async start(): Promise<void> {
    const transport = new StdioClientTransport({
      command: 'node',
      args: [this.serverPath],
      env: { ...process.env, REPO_ROOT: this.repoRoot } as Record<string, string>,
    });

    this.client = new Client(
      { name: 'repo-pilot-orchestrator', version: '1.0.0' },
      { capabilities: {} },
    );

    await this.client.connect(transport);
    this.started = true;
  }

  async callTool(name: string, args: Record<string, unknown> = {}): Promise<string> {
    if (!this.started || !this.client) {
      throw new Error('MCPClientManager not started — call start() first');
    }

    const correlationId = randomUUID().slice(0, 8);
    console.log(`[${correlationId}] → ${name}`);

    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new MCPTimeoutError(name)), 30_000),
    );

    const result = await Promise.race([
      this.client.callTool({ name, arguments: args }),
      timeout,
    ]);

    const text = (result.content as Array<{ type: string; text: string }>)
      .filter((c) => c.type === 'text')
      .map((c) => c.text)
      .join('\n');

    console.log(`[${correlationId}] ← ${text.slice(0, 80)}${text.length > 80 ? '...' : ''}`);
    return text;
  }

  async stop(): Promise<void> {
    if (this.client) {
      try { await this.client.close(); } catch { /* ignore */ }
      this.client = null;
    }
    this.started = false;
  }
}
