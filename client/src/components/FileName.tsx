/**
 * A path with its name given the weight, used by both the single-file header
 * and every section header in the diff so the two rows stay the same shape.
 *
 * Bold rather than bigger: the name has to be findable down a long scroll, and
 * the quiet folders beside it already do most of that. A larger size also made
 * the row taller than the controls sharing it.
 */
export function FileName({ path }: { path: string }) {
  const cut = path.lastIndexOf('/')
  return (
    <span className="min-w-0 truncate font-mono text-xs" title={path}>
      {cut !== -1 && (
        <span className="text-faint">{path.slice(0, cut + 1)}</span>
      )}
      <span className="font-semibold text-ink">{path.slice(cut + 1)}</span>
    </span>
  )
}
