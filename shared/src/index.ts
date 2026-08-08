export interface GitStatus {
  repoPath: string
  branch: string
  changedFiles: number
  clean: boolean
}
