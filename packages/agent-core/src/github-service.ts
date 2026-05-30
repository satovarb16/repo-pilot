import { rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { simpleGit } from 'simple-git';
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

  // D1-2: Resolve the repo's default branch via Octokit — never hardcoded
  async getDefaultBranch(owner: string, repo: string, token: string): Promise<string> {
    const octokit = new Octokit({ auth: token });
    const { data } = await octokit.repos.get({ owner, repo });
    return data.default_branch;
  }

  // D1-3: Stage all changes and commit; guard fails closed if HEAD is not on repo-pilot/{runId}
  async commitChanges(repoPath: string, runId: string, message: string): Promise<{ commitSha: string }> {
    const git = simpleGit(repoPath);
    const branch = await git.revparse(['--abbrev-ref', 'HEAD']);

    if (!branch.startsWith(`repo-pilot/${runId}`)) {
      throw new GitHubBranchError(
        `HEAD is on '${branch.trim()}', expected repo-pilot/${runId}. Refusing to commit.`,
      );
    }

    await git.add('.');
    const result = await git.commit(message);
    // simple-git commit result has the sha in commit field
    const commitSha = (result as unknown as { commit: string }).commit ?? '';
    return { commitSha };
  }

  // D1-4: Push the branch using an embedded-credential URL; strip token from any rethrown error
  async pushBranch(
    repoPath: string,
    owner: string,
    repo: string,
    branchName: string,
    token: string,
  ): Promise<void> {
    const remote = `https://x-access-token:${token}@github.com/${owner}/${repo}.git`;
    try {
      await simpleGit(repoPath).push(remote, branchName, ['--set-upstream']);
    } catch (err) {
      // Sanitize token from error before surfacing — mirrors cloneRepo pattern
      const rawMsg = err instanceof Error ? err.message : String(err);
      const safeMsg = rawMsg.replace(/x-access-token:[^@]+@/g, '');
      throw new Error(`Failed to push branch ${branchName}: ${safeMsg}`);
    }
  }

  // D1-5: Open a GitHub PR via Octokit; assert head !== base before calling API
  async openPullRequest(
    owner: string,
    repo: string,
    head: string,
    base: string,
    title: string,
    body: string,
    token: string,
  ): Promise<{ url: string; number: number }> {
    if (head === base) {
      throw new GitHubBranchError(
        `head and base must differ; both are '${head}'. Refusing to open PR.`,
      );
    }
    const octokit = new Octokit({ auth: token });
    const { data } = await octokit.pulls.create({ owner, repo, title, body, head, base });
    return { url: data.html_url, number: data.number };
  }

  // D1-6: Delete a remote branch; guard requires repo-pilot/ prefix; swallow 404/422
  async deleteBranch(
    owner: string,
    repo: string,
    branchName: string,
    token: string,
  ): Promise<void> {
    if (!branchName.startsWith('repo-pilot/')) {
      throw new GitHubBranchError(
        `Branch '${branchName}' must start with 'repo-pilot/'. Refusing to delete.`,
      );
    }
    const octokit = new Octokit({ auth: token });
    try {
      await octokit.git.deleteRef({ owner, repo, ref: `heads/${branchName}` });
    } catch (err: unknown) {
      const status = (err as { status?: number }).status;
      // 404 = already deleted; 422 = unprocessable (e.g. protected); both non-fatal
      if (status === 404 || status === 422) {
        console.warn(`[deleteBranch] Non-fatal ${status} deleting heads/${branchName} — continuing.`);
        return;
      }
      // Strip any token pattern before rethrowing
      const rawMsg = err instanceof Error ? err.message : String(err);
      const safeMsg = rawMsg.replace(/x-access-token:[^@]+@/g, '');
      throw new Error(`Failed to delete branch ${branchName}: ${safeMsg}`);
    }
  }
}
