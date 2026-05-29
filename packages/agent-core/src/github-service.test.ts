import { rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GitHubService, GitHubCloneError, GitHubIssueNotFoundError } from './github-service.js';

const TOKEN = process.env.GITHUB_TEST_TOKEN;
const REPO_ROOT = process.env.REPO_ROOT ?? '/tmp/repo-pilot/clones';
const TEST_REPO_ID = 'test-clone-repo-pilot';
const TEST_CLONE_URL = 'https://github.com/satovarb16/repo-pilot';

// Skip all tests if GITHUB_TEST_TOKEN is not set
const describeIfToken = TOKEN ? describe : describe.skip;

describeIfToken('GitHubService', () => {
  let service: GitHubService;

  beforeAll(() => {
    service = new GitHubService(REPO_ROOT);
  });

  afterAll(async () => {
    const repoPath = join(REPO_ROOT, TEST_REPO_ID);
    if (existsSync(repoPath)) {
      await rm(repoPath, { recursive: true, force: true });
    }
  });

  describe('cloneRepo', () => {
    it('clones a real repo and returns the local path', async () => {
      const repoPath = await service.cloneRepo(TEST_CLONE_URL, TEST_REPO_ID, TOKEN!);
      expect(existsSync(join(repoPath, 'package.json'))).toBe(true);
      expect(existsSync(join(repoPath, 'CLAUDE.md'))).toBe(true);
    }, 60_000);

    it('deletes and re-clones when called twice on the same repoId', async () => {
      const path1 = await service.cloneRepo(TEST_CLONE_URL, TEST_REPO_ID, TOKEN!);
      const path2 = await service.cloneRepo(TEST_CLONE_URL, TEST_REPO_ID, TOKEN!);
      expect(path1).toBe(path2);
      expect(existsSync(join(path2, 'package.json'))).toBe(true);
    }, 120_000);

    it('throws GitHubCloneError with an invalid token', async () => {
      await expect(
        service.cloneRepo(TEST_CLONE_URL, 'bad-token-test', 'invalid-token-xyz'),
      ).rejects.toThrow(GitHubCloneError);
    }, 30_000);
  });

  describe('fetchIssue', () => {
    it('fetches a known open issue', async () => {
      // Issue #1 should always exist on satovarb16/repo-pilot
      const issue = await service.fetchIssue('satovarb16', 'repo-pilot', 1, TOKEN!);
      expect(issue.number).toBe(1);
      expect(typeof issue.title).toBe('string');
      expect(issue.title.length).toBeGreaterThan(0);
    }, 15_000);

    it('throws GitHubIssueNotFoundError for non-existent issue', async () => {
      await expect(
        service.fetchIssue('satovarb16', 'repo-pilot', 999999, TOKEN!),
      ).rejects.toThrow(GitHubIssueNotFoundError);
    }, 15_000);
  });

  describe('createBranch', () => {
    it('creates a local branch in an existing clone', async () => {
      const repoPath = await service.cloneRepo(TEST_CLONE_URL, TEST_REPO_ID, TOKEN!);
      await service.createBranch(repoPath, 'test-branch-creation');
    }, 60_000);
  });
});
