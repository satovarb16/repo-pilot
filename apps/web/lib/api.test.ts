import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { connectRepo, listRepos, startRun, ApiError } from './api'
import type { ConnectRepoInput } from './types'

describe('API client', () => {
  let mockFetch: ReturnType<typeof vi.fn>

  beforeEach(() => {
    mockFetch = vi.fn()
    global.fetch = mockFetch
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('listRepos', () => {
    it('returns repos array from repositories key on 200', async () => {
      const repos = [
        { id: '1', owner: 'a', name: 'b', cloneUrl: 'https://github.com/a/b.git', cloneStatus: 'pending', createdAt: '2026-01-01' },
      ]
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ repositories: repos }),
      })

      const result = await listRepos()
      expect(result).toEqual(repos)
      expect(mockFetch).toHaveBeenCalledWith('/api/v1/repositories', expect.any(Object))
    })

    it('throws ApiError on non-ok response', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => ({ error: 'Internal server error' }),
      })

      const promise = listRepos()
      await expect(promise).rejects.toThrow(ApiError)
      await expect(promise).rejects.toThrow('Internal server error')
    })
  })

  describe('connectRepo', () => {
    const input: ConnectRepoInput = {
      githubRepoId: 123,
      owner: 'owner',
      name: 'repo',
      cloneUrl: 'https://github.com/owner/repo.git',
      pat: 'ghp_test',
    }

    it('sends POST with correct body and returns Repository', async () => {
      const repo = { id: 'r1', owner: 'owner', name: 'repo', cloneUrl: input.cloneUrl, cloneStatus: 'pending', createdAt: '2026-01-01' }
      mockFetch.mockResolvedValueOnce({ ok: true, json: async () => repo })

      const result = await connectRepo(input)
      expect(result).toEqual(repo)
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/v1/repositories',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify(input),
        }),
      )
    })

    it('throws ApiError on 400', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => ({ error: 'Validation failed' }),
      })

      await expect(connectRepo(input)).rejects.toThrow(ApiError)
    })
  })

  describe('startRun', () => {
    it('returns runId on 201', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ runId: 'run-123' }) })

      const result = await startRun('repo-1', 'Fix the bug')
      expect(result.runId).toBe('run-123')
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/v1/agent/runs',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ repositoryId: 'repo-1', taskDescription: 'Fix the bug' }),
        }),
      )
    })

    it('throws ApiError on non-ok response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        json: async () => ({ error: 'Repository not found' }),
      })

      await expect(startRun('bad-id', 'task')).rejects.toThrow(ApiError)
    })
  })
})
