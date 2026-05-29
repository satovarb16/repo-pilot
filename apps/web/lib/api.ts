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
