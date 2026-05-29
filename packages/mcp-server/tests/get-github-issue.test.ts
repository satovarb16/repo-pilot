import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getGithubIssue } from '../src/tools/get-github-issue.js';

describe('getGithubIssue', () => {
  const originalToken = process.env.GITHUB_TOKEN;

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    process.env.GITHUB_TOKEN = originalToken;
    vi.restoreAllMocks();
  });

  it('throws when GITHUB_TOKEN is missing', async () => {
    delete process.env.GITHUB_TOKEN;
    await expect(getGithubIssue('owner', 'repo', 1)).rejects.toThrow('GITHUB_TOKEN is required');
  });

  it('formats issue with title, state, labels, and body', async () => {
    process.env.GITHUB_TOKEN = 'fake-token';

    const mockGet = vi.fn().mockResolvedValue({
      data: {
        number: 42,
        title: 'Fix alarm validation bug',
        state: 'open',
        labels: [{ name: 'bug' }, { name: 'high-priority' }],
        body: 'The alarm fires even when threshold is not exceeded.',
      },
    });

    vi.doMock('@octokit/rest', () => ({
      Octokit: vi.fn().mockImplementation(() => ({
        issues: {
          get: mockGet,
        },
      })),
    }));

    const { getGithubIssue: getGithubIssueMocked } = await import(
      '../src/tools/get-github-issue.js'
    );
    const result = await getGithubIssueMocked('owner', 'repo', 42);

    expect(result).toContain('Issue #42: Fix alarm validation bug [open]');
    expect(result).toContain('Labels: bug, high-priority');
    expect(result).toContain('The alarm fires even when threshold is not exceeded.');
  });

  it('handles issues with no labels', async () => {
    process.env.GITHUB_TOKEN = 'fake-token';

    const mockGet = vi.fn().mockResolvedValue({
      data: {
        number: 1,
        title: 'Simple issue',
        state: 'closed',
        labels: [],
        body: 'No labels here.',
      },
    });

    vi.doMock('@octokit/rest', () => ({
      Octokit: vi.fn().mockImplementation(() => ({
        issues: {
          get: mockGet,
        },
      })),
    }));

    const { getGithubIssue: getGithubIssueMocked } = await import(
      '../src/tools/get-github-issue.js'
    );
    const result = await getGithubIssueMocked('owner', 'repo', 1);

    expect(result).toContain('Issue #1: Simple issue [closed]');
    expect(result).not.toContain('Labels:');
    expect(result).toContain('No labels here.');
  });

  it('handles issues with no body', async () => {
    process.env.GITHUB_TOKEN = 'fake-token';

    const mockGet = vi.fn().mockResolvedValue({
      data: {
        number: 99,
        title: 'Issue with no description',
        state: 'open',
        labels: [{ name: 'task' }],
        body: null,
      },
    });

    vi.doMock('@octokit/rest', () => ({
      Octokit: vi.fn().mockImplementation(() => ({
        issues: {
          get: mockGet,
        },
      })),
    }));

    const { getGithubIssue: getGithubIssueMocked } = await import(
      '../src/tools/get-github-issue.js'
    );
    const result = await getGithubIssueMocked('owner', 'repo', 99);

    expect(result).toContain('Issue #99: Issue with no description [open]');
    expect(result).toContain('(no description)');
  });

  it('handles labels as strings (legacy API response)', async () => {
    process.env.GITHUB_TOKEN = 'fake-token';

    const mockGet = vi.fn().mockResolvedValue({
      data: {
        number: 5,
        title: 'Mixed labels',
        state: 'open',
        labels: ['string-label', { name: 'object-label' }],
        body: 'Test body.',
      },
    });

    vi.doMock('@octokit/rest', () => ({
      Octokit: vi.fn().mockImplementation(() => ({
        issues: {
          get: mockGet,
        },
      })),
    }));

    const { getGithubIssue: getGithubIssueMocked } = await import(
      '../src/tools/get-github-issue.js'
    );
    const result = await getGithubIssueMocked('owner', 'repo', 5);

    expect(result).toContain('Labels: string-label, object-label');
  });
});
