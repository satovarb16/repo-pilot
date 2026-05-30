import { config } from 'dotenv';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
config({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../../../.env') });
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { listFiles } from './tools/list-files.js';
import { readFile } from './tools/read-file.js';
import { searchRepo } from './tools/search-repo.js';
import { getDiff } from './tools/get-diff.js';
import { getGithubIssue } from './tools/get-github-issue.js';

const repoRoot = process.env.REPO_ROOT;
if (!repoRoot) {
  console.error('Error: REPO_ROOT environment variable is required');
  process.exit(1);
}

const server = new Server(
  { name: 'repo-agent-mcp-server', version: '1.0.0' },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'list_files',
      description: 'List all files in the repository or a subdirectory. Excludes node_modules, .git, dist.',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Relative path to list (default: ".")' },
        },
      },
    },
    {
      name: 'read_file',
      description: 'Read the contents of a file. Sensitive files (.env, keys, certs) are blocked.',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Relative path to the file' },
        },
        required: ['path'],
      },
    },
    {
      name: 'search_repo',
      description: 'Search for a string or regex in all files. Returns up to 100 matches.',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'String or regex to search for' },
          path: { type: 'string', description: 'Subdirectory to search in (default: ".")' },
        },
        required: ['query'],
      },
    },
    {
      name: 'get_diff',
      description: 'Get the current git diff (unstaged by default, or staged).',
      inputSchema: {
        type: 'object',
        properties: {
          staged: { type: 'boolean', description: 'Show staged changes (default: false)' },
        },
      },
    },
    {
      name: 'get_github_issue',
      description: 'Fetch a GitHub issue by number. Requires GITHUB_TOKEN env var.',
      inputSchema: {
        type: 'object',
        properties: {
          owner: { type: 'string', description: 'Repository owner' },
          repo: { type: 'string', description: 'Repository name' },
          issue_number: { type: 'number', description: 'Issue number' },
        },
        required: ['owner', 'repo', 'issue_number'],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    let text: string;

    switch (name) {
      case 'list_files':
        text = listFiles(repoRoot, (args?.path as string) ?? '.');
        break;
      case 'read_file':
        text = readFile(repoRoot, args?.path as string);
        break;
      case 'search_repo':
        text = searchRepo(repoRoot, args?.query as string, (args?.path as string) ?? '.');
        break;
      case 'get_diff':
        text = getDiff(repoRoot, (args?.staged as boolean) ?? false);
        break;
      case 'get_github_issue':
        text = await getGithubIssue(
          args?.owner as string,
          args?.repo as string,
          args?.issue_number as number,
        );
        break;
      default:
        throw new Error(`Unknown tool: ${name}`);
    }

    return { content: [{ type: 'text', text }] };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { content: [{ type: 'text', text: `Error: ${message}` }], isError: true };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
