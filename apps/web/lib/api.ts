import type { ConnectRepoInput, Repository } from './types'

const BASE = '/api/v1'

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  })
  const data = (await res.json()) as Record<string, unknown>
  if (!res.ok) {
    throw new ApiError(res.status, (data.error as string) ?? 'Request failed')
  }
  return data as T
}

export async function listRepos(): Promise<Repository[]> {
  const data = await request<{ repositories: Repository[] }>('/repositories')
  return data.repositories
}

export async function connectRepo(input: ConnectRepoInput): Promise<Repository> {
  return request<Repository>('/repositories', {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export async function startRun(
  repositoryId: string,
  taskDescription: string,
): Promise<{ runId: string }> {
  return request<{ runId: string }>('/agent/runs', {
    method: 'POST',
    body: JSON.stringify({ repositoryId, taskDescription }),
  })
}

export async function approvePlan(runId: string): Promise<void> {
  await request(`/agent/runs/${runId}/approve-plan`, {
    method: 'POST',
    body: JSON.stringify({ action: 'approve' }),
  })
}

export async function rejectPlan(runId: string): Promise<void> {
  await request(`/agent/runs/${runId}/approve-plan`, {
    method: 'POST',
    body: JSON.stringify({ action: 'reject' }),
  })
}

export async function resolveEdit(
  runId: string,
  changeId: string,
  action: 'approve' | 'reject',
): Promise<void> {
  await request(`/agent/runs/${runId}/file-changes/${changeId}`, {
    method: 'PATCH',
    body: JSON.stringify({ action }),
  })
}

export async function approveTestRun(runId: string): Promise<void> {
  await request(`/agent/runs/${runId}/approve-test-run`, {
    method: 'POST',
    body: JSON.stringify({ action: 'approve' }),
  })
}

export async function rejectTestRun(runId: string): Promise<void> {
  await request(`/agent/runs/${runId}/approve-test-run`, {
    method: 'POST',
    body: JSON.stringify({ action: 'reject' }),
  })
}

export async function approvePR(runId: string): Promise<void> {
  await request(`/agent/runs/${runId}/approve-pr`, { method: 'POST' })
}

export async function rejectPR(runId: string, reason?: string): Promise<void> {
  await request(`/agent/runs/${runId}/reject-pr`, {
    method: 'POST',
    body: reason !== undefined ? JSON.stringify({ reason }) : undefined,
  })
}

import type { TestRunView } from './types'

export async function fetchTestResults(runId: string): Promise<TestRunView[]> {
  const data = await request<{ testRuns: Array<{
    id: string
    command: string
    status: string
    exitCode: number | null
    stdout: string
    stderr: string
    durationMs: number | null
    sandboxed?: boolean
  }> }>(`/agent/runs/${runId}/test-results`)
  return data.testRuns.map((r) => ({
    id: r.id,
    command: r.command,
    status: (r.status === 'passed' ? 'passed' : r.status === 'failed' ? 'failed' : 'running') as TestRunView['status'],
    exitCode: r.exitCode,
    stdout: r.stdout,
    stderr: r.stderr,
    durationMs: r.durationMs,
    sandboxed: r.sandboxed ?? true,
  }))
}
