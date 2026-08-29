import type { Db } from './driver.js'

/**
 * Numbers every note inside its own review — note 0, note 1 — because that is
 * the handle a review hands an agent. A row id says nothing about which review
 * it belongs to or how many notes are in it, and a review of thirteen notes
 * numbered 32 to 44 reads as neither.
 *
 * The number is assigned at insert as max+1 and never reused, so it keeps
 * meaning the same note after an earlier one is deleted: a review can hold
 * 0, 1, 3, which is honest, where renumbering would silently move a number an
 * agent had already been told to act on.
 *
 * This fills in rows written before the column existed, in id order — the order
 * they were raised. It runs on every start and does nothing once no row is
 * null, so a row that somehow arrives unnumbered is numbered on the next start
 * instead of staying a hole.
 */
export async function numberNotes(db: Db): Promise<number> {
  const rows = await db.all<{ id: number; session_id: number }>(
    'select id, session_id from threads where number is null order by session_id, id',
  )
  if (rows.length > 0) {
    await db.transaction(async () => {
      const next = new Map<number, number>()
      for (const row of rows) {
        let number = next.get(row.session_id)
        if (number === undefined) {
          // a review may already hold numbered notes: carry on above them
          // rather than colliding with note 0
          const top = await db.get<{ top: number | null }>(
            'select max(number) as top from threads where session_id = ?',
            [row.session_id],
          )
          number = top?.top == null ? 0 : Number(top.top) + 1
        }
        await db.run('update threads set number = ? where id = ?', [
          number,
          row.id,
        ])
        next.set(row.session_id, number + 1)
      }
    })
  }
  // after the backfill, never before: the index cannot be built while several
  // rows in one review still share a null
  await db.exec(
    'create unique index if not exists threads_session_number on threads (session_id, number)',
  )
  return rows.length
}
