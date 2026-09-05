import type { Db } from './db/driver.js'
import { databaseTarget } from './config.js'
import { gitStatus } from './git.js'
import type { BranchResolver } from './db/reviewBranch.js'
import { applySchema } from './db/schema.js'
import { openSqlite, defaultDbPath } from './db/sqlite.js'

export type { Db } from './db/driver.js'
export { defaultDbPath } from './db/sqlite.js'

/**
 * Which branch an old review's source is on, for the one-off re-key onto the
 * branch key. Only the migration asks; a worktree that has been deleted, or is
 * detached, answers nothing and its review keeps a null branch rather than
 * being placed on work it may not belong to.
 */
const branchOfSource: BranchResolver = async (source) => {
  if (source.kind !== 'worktree') return source.value
  try {
    const branch = (await gitStatus(source.value)).branch
    return branch === '' || branch === '(detached)' ? null : branch
  } catch {
    return null
  }
}

/**
 * Opens whatever the configuration points at and brings the schema up to date.
 * Postgres is loaded on demand so a plain local install never pays for it.
 */
export async function openDatabase(target = databaseTarget()): Promise<Db> {
  if (target.kind === 'postgres') {
    const { openPostgres } = await import('./db/postgres.js')
    const db = await openPostgres(target.url)
    await applySchema(db, branchOfSource)
    return db
  }
  const db = openSqlite(target.file === '' ? defaultDbPath() : target.file)
  await applySchema(db, branchOfSource)
  return db
}
