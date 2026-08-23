import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { Db } from './driver.js'
import { Lock } from './driver.js'

/**
 * node:sqlite is synchronous, so this is an honest wrapper rather than a
 * pretence: the work still runs to completion inline, the API just awaits.
 * Two pitfalls are handled here — statements are cached instead of re-prepared
 * on every call, and transactions take a lock, because an `await` between two
 * statements is an opening a synchronous driver never gave anyone.
 */

export function defaultDbPath(): string {
  const dir = path.join(os.homedir(), '.stickie')
  fs.mkdirSync(dir, { recursive: true })
  return path.join(dir, 'stickie.sqlite')
}

export function openSqlite(file: string = defaultDbPath()): Db {
  const db = new DatabaseSync(file)
  db.exec('pragma journal_mode = wal')
  db.exec('pragma foreign_keys = on')
  const statements = new Map<string, ReturnType<DatabaseSync['prepare']>>()
  const lock = new Lock()
  // one connection means `begin` is process-wide: any statement issued while a
  // transaction is open joins it, and would be rolled back with it. So every
  // statement queues behind the lock, and a transaction's own statements skip
  // it — the queue is already holding everyone else back.
  let inside = false

  const guard = <T>(work: () => T): Promise<T> => {
    if (inside) return Promise.resolve(work())
    return lock.run(() => Promise.resolve(work()))
  }

  const prepared = (sql: string) => {
    const hit = statements.get(sql)
    if (hit !== undefined) return hit
    const statement = db.prepare(sql)
    statements.set(sql, statement)
    return statement
  }

  return {
    dialect: 'sqlite',
    describe: `sqlite ${file}`,

    all: <T>(sql: string, params: unknown[] = []) =>
      guard(() => prepared(sql).all(...(params as never[])) as unknown as T[]),

    get: <T>(sql: string, params: unknown[] = []) =>
      guard(
        () =>
          prepared(sql).get(...(params as never[])) as unknown as T | undefined,
      ),

    run: (sql: string, params: unknown[] = []) =>
      guard(() => ({
        changes: Number(prepared(sql).run(...(params as never[])).changes),
      })),

    insert: (sql: string, params: unknown[] = []) =>
      guard(() =>
        Number(prepared(sql).run(...(params as never[])).lastInsertRowid),
      ),

    exec: (sql: string) => guard(() => db.exec(sql)),

    transaction: <T>(body: () => Promise<T>) =>
      lock.run(async () => {
        inside = true
        db.exec('begin')
        try {
          const value = await body()
          db.exec('commit')
          return value
        } catch (error) {
          db.exec('rollback')
          throw error
        } finally {
          inside = false
        }
      }),

    close: () => {
      statements.clear()
      db.close()
      return Promise.resolve()
    },
  }
}
