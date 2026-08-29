import dayjs from 'dayjs'
import relativeTime from 'dayjs/plugin/relativeTime'
import updateLocale from 'dayjs/plugin/updateLocale'
import utc from 'dayjs/plugin/utc'

/**
 * Every timestamp shown anywhere goes through here.
 *
 * The server sends ISO-8601 in UTC; dayjs renders it in whatever zone the
 * reader is in. Recent times read as an age, because "4m ago" is what you want
 * while a review is live; past a couple of days an age stops meaning anything
 * and the date itself is more use. The exact stamp is always a hover away.
 */

dayjs.extend(utc)
dayjs.extend(relativeTime)
dayjs.extend(updateLocale)

// dayjs spells these out ("2 minutes ago"); in a dense list the short forms
// carry the same information in a third of the width
dayjs.updateLocale('en', {
  relativeTime: {
    future: 'in %s',
    past: '%s ago',
    s: '<1m',
    m: '1m',
    mm: '%dm',
    h: '1h',
    hh: '%dh',
    d: '1d',
    dd: '%dd',
    M: '1mo',
    MM: '%dmo',
    y: '1y',
    yy: '%dy',
  },
})

/** Past this, an age stops being informative and the date is worth the space. */
const absolute_after_days = 2

/** Below this, "%s ago" reads worse than saying it plainly. */
const just_now_seconds = 45

export function timeLabel(iso: string | null | undefined): string {
  if (iso == null || iso === '') return ''
  const at = dayjs(iso)
  if (!at.isValid()) return ''
  const now = dayjs()
  if (now.diff(at, 'day') >= absolute_after_days) {
    return at.format('YYYY-MM-DD HH:mm')
  }
  return Math.abs(now.diff(at, 'second')) < just_now_seconds
    ? 'just now'
    : at.fromNow()
}

/** The whole truth, for a tooltip: hundredths of a second is enough. */
export function timeExact(iso: string | null | undefined): string {
  if (iso == null || iso === '') return ''
  const at = dayjs(iso)
  if (!at.isValid()) return ''
  // dayjs has no two-digit fraction token, and three digits is more than
  // anyone reads off a tooltip
  return at.format('YYYY-MM-DD HH:mm:ss.SSS').slice(0, -1)
}

/** Sortable, and stable regardless of how the string was written. */
export function timeValue(iso: string | null | undefined): number {
  if (iso == null || iso === '') return 0
  const at = dayjs(iso)
  return at.isValid() ? at.valueOf() : 0
}
