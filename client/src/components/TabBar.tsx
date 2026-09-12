import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { fileIconUrl } from '../fileIcons'
import type { Tab } from '../store'
import { useReview } from '../store'
import { tabLabels } from '../tabLabels'
import { ChevronDown, ChevronLeft, ChevronRight, Close } from '../icons'
import { btn, button_on, glass, icon_button, motion } from '../ui'
import { ViewMenu } from './ViewMenu'

/** Room kept for the overflow button when not every tab fits. */
const overflow_reserve = 52
const fallback_width = 140

/**
 * Open views as tabs: one persistent diff (flow) tab per repo that resumes
 * where it was left, one commit-timeline tab per repo, plus closable
 * single-file tabs. Tabs that do not fit move into a dropdown rather than
 * off the side, and file names only carry as much path as it takes to tell
 * two of them apart.
 */
export function TabBar() {
  const tabs = useReview((s) => s.tabs)
  const activeTabId = useReview((s) => s.activeTabId)
  const activateTab = useReview((s) => s.activateTab)
  const closeTab = useReview((s) => s.closeTab)
  const repos = useReview((s) => s.repos)
  const reviews = useReview((s) => s.sessionsById)
  const navBack = useReview((s) => s.navBack)
  const navForward = useReview((s) => s.navForward)
  const canBack = useReview((s) => s.navIndex > 0)
  const canForward = useReview((s) => s.navIndex < s.navHistory.length - 1)
  const stripRef = useRef<HTMLDivElement>(null)
  const widths = useRef(new Map<string, number>())
  const [room, setRoom] = useState(Number.POSITIVE_INFINITY)
  const [listing, setListing] = useState(false)

  const repoName = (repoId: number) =>
    repos.find((r) => r.id === repoId)?.name ?? '?'

  /**
   * Which review a tab is showing. A repo has a review per branch, and several
   * of a repo's tabs can be open at once, so "repo · diff" was not enough to
   * tell two of them apart — nor to say what the one you are looking at is of.
   */
  const reviewOf = (reviewId: number) => reviews[reviewId] ?? null

  const whichReview = (tab: Tab): string => {
    const review = reviewOf(tab.reviewId)
    if (review === null) return repoName(tab.repoId)
    const where = review.source.kind === 'worktree' ? 'working tree' : 'branch'
    return (
      `${repoName(tab.repoId)} — ${review.branch} (${where}), ` +
      `read against ${review.baseRef} @ ${review.baseSha.slice(0, 8)}`
    )
  }

  // grouped by review, not by repository: the same file open on two branches
  // of one repository is two tabs, and "the repository" names both of them
  const file_labels = tabLabels(
    tabs.flatMap((tab) =>
      tab.kind === 'file' && tab.path !== undefined
        ? [{ id: tab.id, groupId: tab.reviewId, path: tab.path }]
        : [],
    ),
    (reviewId) => {
      const review = reviewOf(reviewId)
      const repo = tabs.find((t) => t.reviewId === reviewId)?.repoId
      const name = repo === undefined ? '?' : repoName(repo)
      return review === null ? name : `${name} · ${review.branch}`
    },
  )

  // the branch, not the word "diff": what a diff tab shows is one branch's
  // work, and the repo alone does not say which
  const labelOf = (tab: Tab) =>
    tab.kind === 'flow'
      ? `${repoName(tab.repoId)} · ${reviewOf(tab.reviewId)?.branch ?? 'diff'}`
      : tab.kind === 'commits'
        ? `${repoName(tab.repoId)} · commits`
        : (file_labels.get(tab.id) ?? tab.path ?? '')

  const titleOf = (tab: Tab) =>
    tab.kind === 'flow'
      ? `continuous diff review of ${whichReview(tab)}`
      : tab.kind === 'commits'
        ? `selected commits as a timeline — ${whichReview(tab)}`
        : `${tab.path ?? ''}\nin ${whichReview(tab)}`

  // widths are remembered per label, so a tab hidden in the dropdown still
  // counts for the same room when it comes back
  useLayoutEffect(() => {
    const el = stripRef.current
    if (el === null) return
    for (const node of el.querySelectorAll<HTMLElement>('[data-tab-key]')) {
      const key = node.dataset.tabKey
      if (key !== undefined) widths.current.set(key, node.offsetWidth)
    }
  })

  useEffect(() => {
    const el = stripRef.current
    if (el === null) return
    const observer = new ResizeObserver(() => setRoom(el.clientWidth))
    observer.observe(el)
    setRoom(el.clientWidth)
    return () => observer.disconnect()
  }, [tabs.length > 0])

  const widthOf = (tab: Tab) =>
    widths.current.get(`${tab.id}:${labelOf(tab)}`) ?? fallback_width

  const split = (reserve: number) => {
    let used = 0
    const shown: Tab[] = []
    const hidden: Tab[] = []
    for (const tab of tabs) {
      const width = widthOf(tab)
      if (hidden.length === 0 && used + width <= room - reserve) {
        shown.push(tab)
        used += width
      } else {
        hidden.push(tab)
      }
    }
    return { shown, hidden }
  }

  let { shown, hidden } = split(0)
  if (hidden.length > 0) ({ shown, hidden } = split(overflow_reserve))
  // whatever is open must stay in sight
  const active = tabs.find((t) => t.id === activeTabId)
  if (active !== undefined && hidden.includes(active)) {
    const dropped = shown.pop()
    shown.push(active)
    hidden = [
      ...(dropped === undefined ? [] : [dropped]),
      ...hidden.filter((t) => t.id !== active.id),
    ].sort((a, b) => tabs.indexOf(a) - tabs.indexOf(b))
  }

  if (tabs.length === 0) return null

  const tabButton = (tab: Tab) => {
    const is_active = tab.id === activeTabId
    const icon =
      tab.kind === 'file' && tab.path !== undefined
        ? fileIconUrl(tab.path.split('/').at(-1) ?? '')
        : null
    return (
      <div
        key={tab.id}
        data-tab-key={`${tab.id}:${labelOf(tab)}`}
        className={`group flex max-w-64 shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1 ${motion} ${
          is_active
            ? 'bg-panel text-ink shadow-soft'
            : 'text-soft hover:bg-overlay/70 hover:text-ink'
        }`}
      >
        <button
          className="flex min-w-0 items-center gap-1.5"
          title={titleOf(tab)}
          onClick={() => void activateTab(tab.id)}
        >
          {tab.kind === 'flow' ? (
            <span className="shrink-0 text-meta text-faint">⇄</span>
          ) : tab.kind === 'commits' ? (
            <span className="shrink-0 text-meta text-faint">◷</span>
          ) : (
            icon !== null && (
              <img src={icon} alt="" className="h-3.5 w-3.5 shrink-0" />
            )
          )}
          <span className="truncate">{labelOf(tab)}</span>
        </button>
        {tab.kind !== 'flow' && (
          <button
            className={`shrink-0 rounded-sm px-0.5 text-faint opacity-0 group-hover:opacity-100 hover:bg-overlay hover:text-ink ${motion}`}
            title="close tab"
            aria-label="close tab"
            onClick={() => closeTab(tab.id)}
          >
            <Close className="h-3 w-3" />
          </button>
        )}
      </div>
    )
  }

  return (
    <div className="relative flex shrink-0 items-stretch border-b border-edge bg-surface px-1 py-1 text-xs">
      <div
        ref={stripRef}
        className="flex min-w-0 grow items-stretch gap-0.5 overflow-hidden px-1"
      >
        {shown.map(tabButton)}
      </div>
      {hidden.length > 0 && (
        <button
          className={`mr-1 inline-flex shrink-0 items-center gap-1 self-center ${listing ? button_on : btn()}`}
          title={`${hidden.length} more open`}
          onClick={() => setListing(!listing)}
        >
          <ChevronDown />
          {hidden.length}
        </button>
      )}
      {/*
        Where you have been is about what is open, so the arrows sit with the
        tabs rather than in the workspace bar above: the strip they walk is
        the strip they are on.
      */}
      <button
        className={`shrink-0 self-center ${icon_button}`}
        title="back ( [ )"
        aria-label="back"
        disabled={!canBack}
        onClick={() => void navBack()}
      >
        <ChevronLeft />
      </button>
      <button
        className={`mr-1 shrink-0 self-center ${icon_button}`}
        title="forward ( ] )"
        aria-label="forward"
        disabled={!canForward}
        onClick={() => void navForward()}
      >
        <ChevronRight />
      </button>
      <ViewMenu />
      {listing && hidden.length > 0 && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setListing(false)} />
          <div className={`absolute top-full right-1 z-50 max-h-80 w-80 overflow-y-auto rounded-lg py-1 ${glass}`}>
            {hidden.map((tab) => (
              <div
                key={tab.id}
                className="group flex items-center gap-2 px-2 py-1 hover:bg-overlay"
              >
                <button
                  className="flex min-w-0 grow items-baseline gap-2 text-left"
                  onClick={() => {
                    void activateTab(tab.id)
                    setListing(false)
                  }}
                >
                  <span className="truncate text-ink">{labelOf(tab)}</span>
                  <span className="truncate font-mono text-meta text-faint">
                    {tab.kind === 'file'
                      ? (tab.path ?? '')
                      : repoName(tab.repoId)}
                  </span>
                </button>
                {tab.kind !== 'flow' && (
                  <button
                    className={`shrink-0 ${icon_button}`}
                    title="close tab"
                    aria-label="close tab"
                    onClick={() => closeTab(tab.id)}
                  >
                    <Close />
                  </button>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
