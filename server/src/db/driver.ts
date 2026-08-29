/**
 * One async data-access surface with two backends behind it: the bundled
 * SQLite file, or a Postgres a user points us at. Everything above this layer
 * awaits, so swapping the backend changes nothing but this directory.
 *
 * SQL is written in SQLite's `?` style and rewritten for Postgres; the few
 * places the dialects genuinely differ (identity columns, clocks, booleans,
 * introspection) live in `schema.ts` and the row helpers below.
 */

export type Dialect = 'sqlite' | 'postgres'

export interface Db {
  readonly dialect: Dialect
  /** Human-readable target, safe to show (no credentials). */
  readonly describe: string
  all<T>(sql: string, params?: unknown[]): Promise<T[]>
  get<T>(sql: string, params?: unknown[]): Promise<T | undefined>
  /** Statements that change rows; `changes` is how many. */
  run(sql: string, params?: unknown[]): Promise<{ changes: number }>
  /** Inserts one row and answers with its id. */
  insert(sql: string, params?: unknown[]): Promise<number>
  /** Raw DDL, semicolon-separated; never takes parameters. */
  exec(sql: string): Promise<void>
  /**
   * Runs `body` with no other statement of this process interleaved. Async
   * callers can otherwise slip between the statements of a transaction, which
   * a synchronous driver would never have allowed.
   */
  transaction<T>(body: () => Promise<T>): Promise<T>
  close(): Promise<void>
}

/**
 * `?` placeholders become `$1, $2, …`. Question marks inside string literals
 * are left alone, which is why this is a scanner and not a replace().
 */
export function toPositional(sql: string): string {
  let out = ''
  let quote: string | null = null
  let index = 0
  for (let i = 0; i < sql.length; i++) {
    const char = sql[i] ?? ''
    if (quote !== null) {
      out += char
      if (char === quote) quote = null
      continue
    }
    if (char === "'" || char === '"') {
      quote = char
      out += char
      continue
    }
    if (char === '?') {
      index += 1
      out += `$${index}`
      continue
    }
    out += char
  }
  return out
}

/** SQLite answers 0/1 where Postgres answers false/true. */
export function toBool(value: unknown): boolean {
  return value === true || value === 1 || value === '1'
}

/**
 * SQLite answers text timestamps where Postgres answers Date objects, and both
 * are UTC — but SQLite's say so nowhere, and a reader that takes
 * "2026-08-24 09:11:44" for local time is wrong by its own offset. Everything
 * crossing the boundary is ISO-8601 with the zone spelled out.
 */
export function toText(value: unknown): string {
  if (value instanceof Date) return value.toISOString()
  if (value === null || value === undefined) return ''
  const text = String(value)
  const stamp = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})(\.\d+)?$/.exec(text)
  return stamp === null ? text : `${stamp[1]}T${stamp[2]}${stamp[3] ?? ''}Z`
}

/** Serialises work so no two transactions interleave. */
export class Lock {
  private tail: Promise<unknown> = Promise.resolve()

  run<T>(body: () => Promise<T>): Promise<T> {
    const next = this.tail.then(body, body)
    // a rejection must not poison the queue for everyone behind it
    this.tail = next.catch(() => undefined)
    return next
  }
}
