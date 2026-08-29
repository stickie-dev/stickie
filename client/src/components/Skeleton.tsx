/**
 * Loading silhouettes: the shape of what is coming, in place, rather than the
 * word "loading" where the thing will be. Every surface that waits on a fetch
 * or on git should use these, so waiting looks the same everywhere and nobody
 * has to invent a placeholder again.
 *
 * Two rules they follow. A silhouette stands where its content will stand and
 * is roughly its size — a shape that jumps when the content lands is worse than
 * a blank space. And it is `aria-hidden` behind one live region: a screen
 * reader wants "loading", not eleven grey rectangles.
 */

/** One bar. `w` and `h` are classes, so a caller can size it in any unit. */
export function Skeleton({
  w = 'w-full',
  h = 'h-3',
  rounded = 'rounded-sm',
  className = '',
}: {
  w?: string
  h?: string
  rounded?: string
  className?: string
}) {
  return (
    <span
      aria-hidden
      className={`stickie-skeleton block ${w} ${h} ${rounded} ${className}`}
    />
  )
}

/**
 * What everything else wraps: says "loading" once, for anyone who cannot see
 * the shapes, and hides the shapes from them.
 */
export function Loading({
  what,
  className = '',
  children,
}: {
  /** named in the announcement: "loading reviews" */
  what: string
  /** on the wrapper, so callers can lay their silhouettes out here */
  className?: string
  children: React.ReactNode
}) {
  return (
    <div role="status" aria-live="polite" aria-busy="true" className={className}>
      <span className="sr-only">loading {what}</span>
      {children}
    </div>
  )
}

/**
 * Lines of prose or of code. Widths vary and the last line is short, because
 * every line the same length reads as a table, not as text. Deterministic:
 * a random width per render would reflow the silhouette on every frame.
 */
const line_widths = ['w-11/12', 'w-full', 'w-10/12', 'w-full', 'w-9/12']

export function SkeletonLines({
  lines = 3,
  h = 'h-3',
  gap = 'space-y-2',
}: {
  lines?: number
  h?: string
  gap?: string
}) {
  return (
    <div className={gap}>
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} h={h} w={line_widths[i % line_widths.length]} />
      ))}
    </div>
  )
}

/**
 * Rows for a table that is still loading, one silhouette per column, sized by
 * the widths given so the columns do not shift when the real rows arrive.
 */
export function SkeletonRows({
  rows = 3,
  columns,
}: {
  rows?: number
  /** a width class per column, in order */
  columns: string[]
}) {
  return (
    <>
      {Array.from({ length: rows }, (_, row) => (
        <tr key={row} className="border-b border-edge/60 last:border-b-0">
          {columns.map((width, column) => (
            <td key={column} className="px-2 py-2.5">
              <Skeleton w={width} />
            </td>
          ))}
        </tr>
      ))}
    </>
  )
}

/**
 * A file's contents on the way: line numbers down the side and code beside
 * them, at the editor's own line height, so a diff opening reads as a diff
 * opening rather than as an empty panel.
 */
export function SkeletonCode({
  lines = 14,
  className = '',
}: {
  lines?: number
  className?: string
}) {
  // indentation makes it read as code rather than as paragraphs
  const shape = ['w-5/12', 'w-8/12', 'w-6/12', 'w-9/12', 'w-4/12', 'w-7/12']
  const indent = ['ml-0', 'ml-4', 'ml-8', 'ml-4', 'ml-8', 'ml-12']
  return (
    <div className={`space-y-1.5 px-3 py-2 ${className}`}>
      {Array.from({ length: lines }, (_, i) => (
        <div key={i} className="flex items-center gap-3">
          <Skeleton w="w-6" h="h-2.5" />
          <Skeleton
            w={shape[i % shape.length]}
            h="h-2.5"
            className={indent[i % indent.length]}
          />
        </div>
      ))}
    </div>
  )
}

/** A note that has not arrived: its header line, then a couple of lines of body. */
export function SkeletonCard() {
  return (
    <div className="rounded-lg bg-panel p-3 shadow-soft">
      <div className="mb-2.5 flex items-center gap-2">
        <Skeleton w="w-16" h="h-4" rounded="rounded-full" />
        <Skeleton w="w-24" h="h-3" />
      </div>
      <SkeletonLines lines={2} />
    </div>
  )
}
