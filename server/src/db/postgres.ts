import { Pool } from 'pg'
import type { PoolClient } from 'pg'
import type { Db } from './driver.js'
import { Lock } from './driver.js'
import { toPositional } from './driver.js'

/**
 * Postgres for anyone who wants the review record somewhere other than a file
 * on one laptop. Statements arrive in SQLite's `?` style and are rewritten;
 * inserts gain a `returning id` so the caller still receives the new row's id.
 */

/** Everything but the credentials, for showing in settings. */
export function describeUrl(url: string): string {
  try {
    const parsed = new URL(url)
    const database = parsed.pathname.replace(/^\//, '')
    return `postgres ${parsed.host}${database === '' ? '' : `/${database}`}`
  } catch {
    return 'postgres'
  }
}

export async function openPostgres(url: string): Promise<Db> {
  const pool = new Pool({ connectionString: url, max: 8 })
  // fail here rather than on the first request, and say which database it was:
  // a review server that silently fell back to a local file would put notes
  // somewhere nobody looks
  try {
    const probe = await pool.connect()
    probe.release()
  } catch (error) {
    await pool.end().catch(() => undefined)
    const reason = error instanceof Error ? error.message : String(error)
    throw new Error(
      `cannot reach ${describeUrl(url)}: ${reason}\n` +
        'stickie will not fall back to the local file on its own — fix the url ' +
        '(settings, ~/.stickie/config.json, or STICKIE_DATABASE_URL) or clear it.',
    )
  }
  const lock = new Lock()
  // begin/commit only mean anything on one connection, so a transaction takes
  // a client out of the pool and everything inside it borrows that client
  let held: PoolClient | null = null

  const query = async (sql: string, params: unknown[]) =>
    (held ?? pool).query(toPositional(sql), params)

  return {
    dialect: 'postgres',
    describe: describeUrl(url),

    all: async <T>(sql: string, params: unknown[] = []) =>
      (await query(sql, params)).rows as T[],

    get: async <T>(sql: string, params: unknown[] = []) =>
      ((await query(sql, params)).rows as T[])[0],

    run: async (sql: string, params: unknown[] = []) => ({
      changes: (await query(sql, params)).rowCount ?? 0,
    }),

    insert: async (sql: string, params: unknown[] = []) => {
      const returning = /returning\s/i.test(sql) ? sql : `${sql} returning id`
      const rows = (await query(returning, params)).rows as { id: number }[]
      const id = rows[0]?.id
      if (id === undefined) throw new Error('insert returned no id')
      return Number(id)
    },

    exec: async (sql: string) => {
      await pool.query(sql)
    },

    transaction: <T>(body: () => Promise<T>) =>
      lock.run(async () => {
        const client = await pool.connect()
        held = client
        try {
          await client.query('begin')
          const value = await body()
          await client.query('commit')
          return value
        } catch (error) {
          await client.query('rollback').catch(() => undefined)
          throw error
        } finally {
          held = null
          client.release()
        }
      }),

    close: async () => {
      await pool.end()
    },
  }
}
