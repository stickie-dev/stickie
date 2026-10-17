import { useCallback, useEffect, useState } from 'react'
import type { Session, Tracking, UpstreamState } from '@stickie/shared'
import { api } from '../api'
import { ask } from '../confirm'
import { FetchDown } from '../icons'
import { useReview } from '../store'
import { timeLabel } from '../time'
import { badge, btn, icon_button } from '../ui'

const warning_button =
  'bg-amber-500/15 text-amber-700 ring-amber-500/40 hover:bg-amber-500/25 dark:text-amber-300'

/**
 * How the review's base and source stand against the branches they track.
 *
 * Read as of the last fetch: stickie does not go to the network to find out, so
 * "behind" means behind what `origin/main` was when anything last fetched,
 * and the hint says how long ago that was. Re-read whenever the review is —
 * which a moved ref now causes on its own — so a pull or a fetch from a
 * terminal shows here without asking.
 */
export function useUpstream(session: Session | null): {
  upstream: UpstreamState | null
  reread: () => void
} {
  const epoch = useReview((s) => s.contentEpoch)
  const [upstream, setUpstream] = useState<UpstreamState | null>(null)
  const [asked, setAsked] = useState(0)
  const id = session?.id ?? null
  const base = session?.baseRef ?? null

  useEffect(() => {
    if (id === null) {
      setUpstream(null)
      return
    }
    let stale = false
    void api
      .upstream(id)
      .then((state) => {
        if (!stale) setUpstream(state)
      })
      .catch(() => {
        // a repository with no remote, or git refusing: say nothing rather
        // than something wrong
        if (!stale) setUpstream(null)
      })
    return () => {
      stale = true
    }
  }, [id, base, epoch, asked])

  const reread = useCallback(() => setAsked((n) => n + 1), [])
  return { upstream, reread }
}

function since(fetchedAt: string | null): string {
  return fetchedAt === null
    ? 'never fetched here'
    : `last fetched ${timeLabel(fetchedAt)}`
}

/**
 * A branch beside its upstream, when they differ. Behind with nothing of its
 * own is an offer — a fast-forward, so nothing can conflict; with commits of
 * its own as well it is a merge, which is git's to do, so it only says so.
 */
export function TrackingMark({
  tracking,
  fetchedAt,
  onMoved,
}: {
  tracking: Tracking | null
  fetchedAt: string | null
  onMoved: () => void
}) {
  const session = useReview((s) => s.session)
  const pushToast = useReview((s) => s.pushToast)
  const [pulling, setPulling] = useState(false)
  if (tracking === null || session === null) return null
  const { branch, upstream, ahead, behind } = tracking
  if (ahead === 0 && behind === 0) return null

  const pull = async () => {
    const sure = await ask({
      title: `Pull ${String(behind)} ${behind === 1 ? 'commit' : 'commits'} into ${branch}?`,
      detail:
        `A fast-forward to ${upstream}: ${branch} has nothing of its own, so ` +
        'nothing is merged. If it is checked out with changes the pull would ' +
        'overwrite, git refuses and nothing moves.',
      confirmLabel: 'Pull',
    })
    if (!sure) return
    setPulling(true)
    try {
      await api.fastForward(session.repoId, branch)
      pushToast('info', `${branch} is at ${upstream}`)
      onMoved()
    } catch (error) {
      pushToast(
        'error',
        `pull ${branch}: ${error instanceof Error ? error.message : String(error)}`,
      )
    } finally {
      setPulling(false)
    }
  }

  if (behind > 0 && ahead === 0) {
    return (
      <button
        className={btn('outline', warning_button)}
        title={`${branch} is ${String(behind)} behind ${upstream} (${since(fetchedAt)})\nclick to pull — a fast-forward, so nothing merges`}
        disabled={pulling}
        onClick={() => void pull()}
      >
        ↓{behind}
      </button>
    )
  }
  return (
    <span
      className={`${badge} whitespace-nowrap bg-overlay text-faint`}
      title={
        behind > 0
          ? `${branch} and ${upstream} have both moved: ${String(ahead)} here, ${String(behind)} there (${since(fetchedAt)}). Pulling that is a merge — do it in git.`
          : `${branch} has ${String(ahead)} ${ahead === 1 ? 'commit' : 'commits'} not on ${upstream} yet`
      }
    >
      {behind > 0 ? `↓${String(behind)} ↑${String(ahead)}` : `↑${String(ahead)}`}
    </span>
  )
}

/**
 * Fetch from the remote. Asked for, never done in the background: it is the
 * network, and stickie reaches it only when someone presses something.
 */
export function FetchButton({
  fetchedAt,
  onFetched,
}: {
  fetchedAt: string | null
  onFetched: () => void
}) {
  const session = useReview((s) => s.session)
  const pushToast = useReview((s) => s.pushToast)
  const [fetching, setFetching] = useState(false)
  if (session === null) return null
  return (
    <button
      className={`${icon_button} ${fetching ? 'animate-pulse' : ''}`}
      title={`fetch from the remote, to see whether the base or the source has moved there\n${since(fetchedAt)}`}
      aria-label="fetch from the remote"
      disabled={fetching}
      onClick={() => {
        setFetching(true)
        void api
          .fetchRemotes(session.repoId)
          .then(onFetched)
          .catch((error: unknown) =>
            pushToast(
              'error',
              `fetch: ${error instanceof Error ? error.message : String(error)}`,
            ),
          )
          .finally(() => setFetching(false))
      }}
    >
      <FetchDown />
    </button>
  )
}
