import { fileIconUrl } from '../fileIcons'
import { useReview } from '../store'

/**
 * Open views as tabs: one persistent diff (flow) tab per repo that resumes
 * where it was left, plus closable single-file tabs.
 */
export function TabBar() {
  const tabs = useReview((s) => s.tabs)
  const activeTabId = useReview((s) => s.activeTabId)
  const activateTab = useReview((s) => s.activateTab)
  const closeTab = useReview((s) => s.closeTab)
  const repos = useReview((s) => s.repos)

  if (tabs.length === 0) return null

  const repoName = (repoId: number) =>
    repos.find((r) => r.id === repoId)?.name ?? '?'

  return (
    <div className="flex shrink-0 items-stretch gap-0.5 overflow-x-auto border-b border-edge bg-surface px-1 pt-1 text-xs">
      {tabs.map((tab) => {
        const active = tab.id === activeTabId
        const label =
          tab.kind === 'flow'
            ? `${repoName(tab.repoId)} · diff`
            : (tab.path?.split('/').at(-1) ?? tab.path ?? '')
        const icon =
          tab.kind === 'file' && tab.path !== undefined
            ? fileIconUrl(tab.path.split('/').at(-1) ?? '')
            : null
        return (
          <div
            key={tab.id}
            className={`group flex max-w-56 items-center gap-1.5 rounded-t-md border-x border-t px-2.5 py-1.5 ${
              active
                ? 'border-edge bg-panel text-ink'
                : 'border-transparent text-soft hover:bg-overlay hover:text-ink'
            }`}
          >
            <button
              className="flex min-w-0 items-center gap-1.5"
              title={
                tab.kind === 'flow'
                  ? `${repoName(tab.repoId)} — continuous diff review`
                  : `${repoName(tab.repoId)}:${tab.path ?? ''}`
              }
              onClick={() => void activateTab(tab.id)}
            >
              {tab.kind === 'flow' ? (
                <span className="shrink-0 text-[10px] text-faint">⇄</span>
              ) : (
                icon !== null && (
                  <img src={icon} alt="" className="h-3.5 w-3.5 shrink-0" />
                )
              )}
              <span className="truncate">{label}</span>
            </button>
            {tab.kind === 'file' && (
              <button
                className="shrink-0 rounded px-0.5 text-faint opacity-0 group-hover:opacity-100 hover:bg-edge hover:text-ink"
                title="close tab"
                onClick={() => closeTab(tab.id)}
              >
                ×
              </button>
            )}
          </div>
        )
      })}
    </div>
  )
}
