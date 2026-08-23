import type { Db } from './db/driver.js'
import { databaseTarget } from './config.js'
import { applySchema } from './db/schema.js'
import { openSqlite, defaultDbPath } from './db/sqlite.js'

export type { Db } from './db/driver.js'
export { defaultDbPath } from './db/sqlite.js'

/**
 * Opens whatever the configuration points at and brings the schema up to date.
 * Postgres is loaded on demand so a plain local install never pays for it.
 */
export async function openDatabase(target = databaseTarget()): Promise<Db> {
  if (target.kind === 'postgres') {
    const { openPostgres } = await import('./db/postgres.js')
    const db = await openPostgres(target.url)
    await applySchema(db)
    return db
  }
  const db = openSqlite(target.file === '' ? defaultDbPath() : target.file)
  await applySchema(db)
  return db
}
