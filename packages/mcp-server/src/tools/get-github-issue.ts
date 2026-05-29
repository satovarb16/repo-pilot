import { Octokit } from '@octokit/rest';

export async function getGithubIssue(
  owner: string,
  repo: string,
  issueNumber: number,
): Promise<string> {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error('GITHUB_TOKEN is required for get_github_issue');

  const octokit = new Octokit({ auth: token });
  const { data } = await octokit.issues.get({ owner, repo, issue_number: issueNumber });

  const labels = data.labels
    .map((l) => (typeof l === 'string' ? l : l.name))
    .filter(Boolean)
    .join(', ');

  return [
    `Issue #${data.number}: ${data.title} [${data.state}]`,
    labels ? `Labels: ${labels}` : null,
    '---',
    data.body ?? '(no description)',
  ]
    .filter(Boolean)
    .join('\n');
}
