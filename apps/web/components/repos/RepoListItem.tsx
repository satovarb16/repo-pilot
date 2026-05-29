'use client'

import { useAppStore } from '@/lib/store'
import type { Repository } from '@/lib/types'
import { cn } from '@/lib/utils'

interface RepoListItemProps {
  repo: Repository
}

export function RepoListItem({ repo }: RepoListItemProps) {
  const selectedRepoId = useAppStore((s) => s.selectedRepoId)
  const selectRepo = useAppStore((s) => s.selectRepo)

  return (
    <button
      onClick={() => selectRepo(repo.id)}
      className={cn(
        'w-full text-left px-3 py-2 rounded-md text-sm transition-colors',
        selectedRepoId === repo.id
          ? 'bg-accent text-accent-foreground'
          : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
      )}
    >
      <span className="font-medium">{repo.owner}/</span>
      {repo.name}
    </button>
  )
}
