import { useEffect, useRef, useState } from 'react'
import { activeFiles, useReview, wrapFor } from '../store'
import { btn, button_on, eyebrow, motion } from '../ui'

/**
 * The diff's own menu, at the end of the tabs: how it is drawn, and what can be
 * done with it.
 *
 * How it is drawn used to be a row of words above the diff — "12 changed files
 * · all wrapped · wrap all · none" — which spent a line of the screen on counts
 * the status bar already carries, and still had no room for the view mode or
 * the unchanged regions, so those existed on a single file and nowhere on the
 * diff. Copy prompt used to be in the top bar beside Search and Settings,
 * which are about the workspace; taking this review's notes to an agent is an
 * act on this diff, and belongs where the diff's other choices are.
 *
 * What it offers depends on what is open, because wrapping is per file and
 * "every file in this diff" only means something in the diff.
 */

function Choice({
  on,
  onClick,
  children,
  title,
}: {
  on: boolean
  onClick: () => void
  children: React.ReactNode
  title?: string
}) {
  return (
    <button
      className={`w-full px-2 py-1 text-left text-xs ${on ? button_on : btn()}`}
      title={title}
      onClick={onClick}
    >
      {children}
    </button>
  )
}

function Group({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="px-1 py-1">
      <p className={`px-1 pb-1 ${eyebrow}`}>{label}</p>
      <div className="space-y-0.5">{children}</div>
    </div>
  )
}

export function ViewMenu() {
  const [open, setOpen] = useState(false)
  const sideBySide = useReview((s) => s.sideBySide)
  const setSideBySide = useReview((s) => s.setSideBySide)
  const collapseUnchanged = useReview((s) => s.collapseUnchanged)
  const setCollapseUnchanged = useReview((s) => s.setCollapseUnchanged)
  const viewMode = useReview((s) => s.viewMode)
  const files = useReview(activeFiles)
  const selectedPath = useReview((s) => s.selectedPath)
  const wrapExtensions = useReview((s) => s.wrapExtensions)
  const wrapOverrides = useReview((s) => s.wrapOverrides)
  const toggleWrap = useReview((s) => s.toggleWrap)
  const setWrapAll = useReview((s) => s.setWrapAll)
  const copyPrompt = useReview((s) => s.copyPrompt)
  const promptCopied = useReview((s) => s.promptCopied)
  const session = useReview((s) => s.session)
  const ref = useRef<HTMLDivElement>(null)

  // a menu in normal document flow, so pointerdown outside it closes it —
  // unlike the one inside a Monaco view zone, which cannot see those events
  useEffect(() => {
    if (!open) return
    const away = (event: PointerEvent) => {
      if (!(event.target instanceof Node)) return
      if (ref.current?.contains(event.target) === true) return
      setOpen(false)
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', away)
    document.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('pointerdown', away)
      document.removeEventListener('keydown', escape)
    }
  }, [open])

  const paths = files.map((file) => file.path)
  const wrapped = paths.filter((path) =>
    wrapFor(path, wrapExtensions, wrapOverrides),
  ).length
  const in_flow = viewMode === 'flow'
  const file_wrapped =
    selectedPath !== null && wrapFor(selectedPath, wrapExtensions, wrapOverrides)

  return (
    <div className="relative shrink-0 self-center" ref={ref}>
      <button
        className={`${open ? button_on : btn()} px-1.5`}
        title="how the diff is drawn"
        aria-expanded={open}
        aria-label="view options"
        onClick={() => setOpen(!open)}
      >
        ⋮
      </button>
      {open && (
        <div
          className={`absolute top-full right-0 z-50 mt-1 w-56 rounded-lg bg-panel py-1 shadow-lifted ${motion}`}
        >
          <Group label="Diff">
            <Choice
              on={sideBySide === true}
              title="base on the left, source on the right"
              onClick={() => setSideBySide(true)}
            >
              Side by side
            </Choice>
            <Choice
              on={sideBySide === false}
              title="one column, changes in place"
              onClick={() => setSideBySide(false)}
            >
              Inline
            </Choice>
            <Choice
              on={sideBySide === null}
              title="two columns when the window is wide enough, one when it is not"
              onClick={() => setSideBySide(null)}
            >
              Whatever fits
            </Choice>
          </Group>
          <Group label="Unchanged lines">
            <Choice
              on={collapseUnchanged}
              onClick={() => setCollapseUnchanged(true)}
            >
              Collapsed
            </Choice>
            <Choice
              on={!collapseUnchanged}
              onClick={() => setCollapseUnchanged(false)}
            >
              Shown
            </Choice>
          </Group>
          <Group label="This review">
            <button
              className={`w-full px-2 py-1 text-left text-xs ${btn()}`}
              disabled={session === null}
              title="every unresolved note as markdown, on the clipboard, for pasting into any agent"
              onClick={() => {
                setOpen(false)
                void copyPrompt()
              }}
            >
              {promptCopied ? 'Copied ✓' : 'Copy prompt'}
            </button>
          </Group>
          <Group label={in_flow ? 'Wrap long lines' : 'Wrap long lines here'}>
            {in_flow ? (
              <>
                <Choice
                  on={wrapped === paths.length && paths.length > 0}
                  title="soft-wrap every file in this diff"
                  onClick={() => void setWrapAll(paths, true)}
                >
                  Every file
                  <span className="ml-1.5 text-faint">
                    {wrapped} of {paths.length}
                  </span>
                </Choice>
                <Choice
                  on={wrapped === 0}
                  title="stop wrapping every file in this diff"
                  onClick={() => void setWrapAll(paths, false)}
                >
                  No file
                </Choice>
              </>
            ) : (
              <Choice
                on={file_wrapped}
                title="also on the right-click menu, per file"
                onClick={() => {
                  if (selectedPath !== null) void toggleWrap(selectedPath)
                }}
              >
                {file_wrapped ? 'Wrapped' : 'Not wrapped'}
              </Choice>
            )}
          </Group>
        </div>
      )}
    </div>
  )
}
