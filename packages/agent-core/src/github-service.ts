import { rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import simpleGit from 'simple-git';
import { Octokit } from '@octokit/rest';

export class GitHubCloneError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GitHubCloneError';
  }
}

export class GitHubIssueNotFoundError extends Error {
  constructor(owner: string, repo: string, number: number) {
    super(`Issue #${number} not found in ${owner}/${repo}`);
    this.name = 'GitHubIssueNotFoundError';
  }
}

export class GitHubBranchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GitHubBranchError';
  }
}

export interface GitHubIssue {
  number: number;
  title: string;
  body: string | null;
  state: string;
  labels: string[];
}

export class GitHubService {
  constructor(private readonly repoRoot: string) {}

  async cloneRepo(cloneUrl: string, repoId: string, token: string): Promise<string> {
    const repoPath = join(this.repoRoot, repoId);

    // Always start fresh — delete if exists
    if (existsSync(repoPath)) {
      await rm(repoPath, { recursive: true, force: true });
    }

    // Inject token into HTTPS URL
    const urlWithToken = cloneUrl.replace('https://', `https://x-access-token:${token}@`);

    try {
      await simpleGit().clone(urlWithToken, repoPath);
    } catch (err) {
      // Clean up partial clone
      if (existsSync(repoPath)) {
        await rm(repoPath, { recursive: true, force: true }).catch(() => {});
      }
      // Strip embedded token from simple-git error messages before surfacing
      const safeMessage = (err instanceof Error ? err.message : String(err)).replace(
        /x-access-token:[^@]+@/g,
        '',
      );
      throw new GitHubCloneError(`Failed to clone ${cloneUrl}: ${safeMessage}`);
    }

    return repoPath;
  }

  async fetchIssue(
    owner: string,
    repo: string,
    issueNumber: number,
    token: string,
  ): Promise<GitHubIssue> {
    const octokit = new Octokit({ auth: token });

    try {
      const { data } = await octokit.issues.get({
        owner,
        repo,
        issue_number: issueNumber,
      });

      return {
        number: data.number,
        title: data.title,
        body: data.body ?? null,
        state: data.state,
        labels: data.labels
          .map((l) => (typeof l === 'string' ? l : l.name ?? ''))
          .filter(Boolean),
      };
    } catch (err: unknown) {
      if (err !== null && typeof err === 'object' && 'status' in err && (err as { status: number }).status === 404) {
        throw new GitHubIssueNotFoundError(owner, repo, issueNumber);
      }
      throw err;
    }
  }

  async createBranch(repoPath: string, branchName: string): Promise<void> {
    try {
      await simpleGit(repoPath).checkoutLocalBranch(branchName);
    } catch (err) {
      throw new GitHubBranchError(
        `Failed to create branch ${branchName}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
