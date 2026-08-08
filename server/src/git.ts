import { execa } from 'execa'
import type { GitStatus } from '@stickie/shared'

export async function gitStatus(repo_path: string): Promise<GitStatus> {
  const { stdout } = await execa(
    'git',
    ['status', '--porcelain=v2', '--branch'],
    { cwd: repo_path },
  )
  let branch = ''
  let changed_files = 0
  for (const line of stdout.split('\n')) {
    if (line.startsWith('# branch.head ')) {
      branch = line.slice('# branch.head '.length)
    } else if (line !== '' && !line.startsWith('#')) {
      changed_files += 1
    }
  }
  return {
    repoPath: repo_path,
    branch,
    changedFiles: changed_files,
    clean: changed_files === 0,
  }
}
