import { useEffect, useState } from 'react'
import { DiffEditor } from '@monaco-editor/react'
import type { editor } from 'monaco-editor'
import { api } from '../api'
import type { CommitBetween } from '../api'
import { languageFor } from '../languages'
import { useReview, wrapFor } from '../store'

interface Step {
  /** the commit this column arrives at; null for the starting point */
  commit: CommitBetween | null
  before: string
  after: string
}

/**
 * One file across the selected commits: the column at each commit shows what
 * that commit did to the file, so a row of them reads as the file's timeline.
 * Nothing here changes the review target.
 */
export function CommitTimeline({
  commits,
  options,
  theme,
}: {
  commits: CommitBetween[]
  options: editor.IStandaloneEditorConstructionOptions
  theme: string
}) {
  const view = useReview((s) => s.commitView)
  const setCommitPath = useReview((s) => s.setCommitPath)
  const selectCommits = useReview((s) => s.selectCommits)
  const wrapExtensions = useReview((s) => s.wrapExtensions)
  const wrapOverrides = useReview((s) => s.wrapOverrides)
  const [steps, setSteps] = useState<Step[] | null>(null)

  const repoId = view?.repoId
  const path = view?.path ?? null
  const shas = view?.shas.join(',') ?? ''

  useEffect(() => {
    if (repoId === undefined || path === null || shas === '') {
      setSteps(null)
      return
    }
    let live = true
    const list = shas.split(',')
    const oldest = list[0]
    if (oldest === undefined) return
    void (async () => {
      // the starting point is the oldest selected commit's parent
      const revisions = [`${oldest}^`, ...list]
      const contents = await Promise.all(
        revisions.map((rev) =>
          api
            .repoFile(repoId, path, rev)
            .then((file) => file.content ?? '')
            .catch(() => ''),
        ),
      )
      if (!live) return
      const built: Step[] = []
      // revisions[0] is the starting point, so revisions[i] is list[i - 1]
      for (let i = 1; i < revisions.length; i++) {
        built.push({
          commit: commits.find((c) => c.sha === list[i - 1]) ?? null,
          before: contents[i - 1] ?? '',
          after: contents[i] ?? '',
        })
      }
      setSteps(built)
    })()
    return () => {
      live = false
    }
  }, [repoId, path, shas, commits])

  if (view === null) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-faint">
        Pick commits in the sidebar — click one, ⌘/shift+click to add more.
      </div>
    )
  }

  const wrap = path === null ? false : wrapFor(path, wrapExtensions, wrapOverrides)
  const column_options: editor.IStandaloneDiffEditorConstructionOptions = {
    ...options,
    wordWrap: wrap ? 'on' : 'off',
    rulers: [],
    renderSideBySide: false,
    hideUnchangedRegions: {
      enabled: true,
      contextLineCount: 2,
      minimumLineCount: 4,
      revealLineCount: 20,
    },
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 border-b border-edge px-3 py-1.5 text-xs">
        <span className="text-soft">
          {view.shas.length} commit{view.shas.length === 1 ? '' : 's'}
        </span>
        <select
          className="min-w-0 max-w-[28rem] truncate rounded border border-edge bg-surface px-1.5 py-0.5 font-mono text-ink"
          value={path ?? ''}
          onChange={(e) => setCommitPath(e.target.value)}
        >
          {view.files.length === 0 && <option value="">loading…</option>}
          {view.files.map((file) => (
            <option key={file.path} value={file.path}>
              {file.path}
              {view.shas.length > 1 ? ` · ${file.shas.length}×` : ''}
            </option>
          ))}
        </select>
        <span className="grow" />
        <button
          className="text-soft hover:text-ink"
          title="clear the commit selection"
          onClick={() => void selectCommits([])}
        >
          clear
        </button>
      </div>
      {steps === null || steps.length === 0 ? (
        <div className="flex grow items-center justify-center text-sm text-faint">
          {view.files.length === 0 ? 'loading…' : 'nothing to show'}
        </div>
      ) : (
        <div className="flex min-h-0 grow divide-x divide-edge overflow-x-auto">
          {steps.map((step, index) => (
            <div
              key={step.commit?.sha ?? index}
              className="flex min-h-0 min-w-[22rem] flex-1 flex-col"
            >
              <div className="flex items-baseline gap-2 border-b border-edge bg-panel px-2 py-1 text-xs">
                <span className="shrink-0 font-mono text-faint">
                  {step.commit?.shortSha ?? '—'}
                </span>
                <span className="truncate text-soft">
                  {step.commit?.subject ?? 'starting point'}
                </span>
              </div>
              <div className="min-h-0 grow">
                {step.before === step.after ? (
                  <div className="flex h-full items-center justify-center px-3 text-center text-xs text-faint">
                    this commit left the file alone
                  </div>
                ) : (
                  <DiffEditor
                    original={step.before}
                    modified={step.after}
                    language={languageFor(path ?? '')}
                    theme={theme}
                    options={column_options}
                  />
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
