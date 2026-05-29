'use client'

import { useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { connectRepo, ApiError } from '@/lib/api'
import { useAppStore } from '@/lib/store'

export function ConnectRepoDialog() {
  const addRepo = useAppStore((s) => s.addRepo)
  const [open, setOpen] = useState(false)
  const [owner, setOwner] = useState('')
  const [name, setName] = useState('')
  const [pat, setPat] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)

    try {
      const ghRes = await fetch(`https://api.github.com/repos/${owner}/${name}`, {
        headers: { Authorization: `Bearer ${pat}` },
      })
      if (!ghRes.ok) {
        setError(ghRes.status === 404 ? 'Repository not found on GitHub' : 'Could not verify repository — check owner, name, and PAT')
        return
      }
      const ghData = (await ghRes.json()) as { id: number }

      const cloneUrl = `https://github.com/${owner}/${name}.git`
      const repo = await connectRepo({ githubRepoId: ghData.id, owner, name, cloneUrl, pat })
      addRepo(repo)
      setOpen(false)
      setOwner('')
      setName('')
      setPat('')
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="outline" size="sm" className="w-full mt-2" />}>
        + Connect Repo
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Connect a GitHub repository</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 mt-2">
          <div className="space-y-1.5">
            <Label htmlFor="cr-owner">Owner</Label>
            <Input
              id="cr-owner"
              placeholder="owner"
              value={owner}
              onChange={(e) => setOwner(e.target.value)}
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cr-name">Repository name</Label>
            <Input
              id="cr-name"
              placeholder="my-repo"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cr-pat">Personal Access Token</Label>
            <Input
              id="cr-pat"
              type="password"
              placeholder="ghp_..."
              value={pat}
              onChange={(e) => setPat(e.target.value)}
              required
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? 'Connecting...' : 'Connect'}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  )
}
