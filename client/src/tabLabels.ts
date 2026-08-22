/**
 * Tab labels in the PyCharm manner: a bare file name until two open tabs
 * share one, and then only as much path as it takes to tell them apart —
 * the first segment where they diverge, the file's own folder when that is
 * still not enough, and a repository name when the paths are identical.
 */

export interface LabelledTab {
  id: number
  repoId: number
  path: string
}

const ellipsis = '…'

function baseName(path: string): string {
  return path.split('/').at(-1) ?? path
}

/** The first directory segment on which the group disagrees. */
function divergence(paths: string[]): number {
  const dirs = paths.map((path) => path.split('/').slice(0, -1))
  const shortest = Math.min(...dirs.map((d) => d.length))
  for (let i = 0; i < shortest; i++) {
    const here = dirs[0]?.[i]
    if (dirs.some((d) => d[i] !== here)) return i
  }
  // one path's directories are a prefix of the others'
  return shortest
}

function label(path: string, at: number, withParent: boolean): string {
  const segments = path.split('/')
  const base = segments.at(-1) ?? path
  const dirs = segments.slice(0, -1)
  const marker = dirs[at]
  const parent = dirs.at(-1)
  if (marker === undefined) {
    return withParent && parent !== undefined ? `${parent}/${base}` : base
  }
  // the divergence is the file's own folder: no gap to mark
  if (at === dirs.length - 1) return `${marker}/${base}`
  if (withParent && parent !== undefined) {
    return `${marker}/${ellipsis}/${parent}/${base}`
  }
  return `${marker}/${ellipsis}/${base}`
}

/** Ids whose label is shared with another tab. */
function collisions(labels: Map<number, string>): Set<number> {
  const counts = new Map<string, number>()
  for (const text of labels.values()) {
    counts.set(text, (counts.get(text) ?? 0) + 1)
  }
  const shared = new Set<number>()
  for (const [id, text] of labels) {
    if ((counts.get(text) ?? 0) > 1) shared.add(id)
  }
  return shared
}

export function tabLabels(
  tabs: LabelledTab[],
  repoName: (repoId: number) => string,
): Map<number, string> {
  const labels = new Map<number, string>()
  const groups = new Map<string, LabelledTab[]>()
  for (const tab of tabs) {
    const base = baseName(tab.path)
    groups.set(base, [...(groups.get(base) ?? []), tab])
  }
  for (const [base, group] of groups) {
    const first = group[0]
    if (group.length === 1 && first !== undefined) {
      labels.set(first.id, base)
      continue
    }
    const at = divergence(group.map((tab) => tab.path))
    const group_labels = new Map(
      group.map((tab) => [tab.id, label(tab.path, at, false)]),
    )
    // several files can sit under the same diverging folder; name their own
    // folder as well before giving up on the path
    const clusters = new Map<string, LabelledTab[]>()
    for (const tab of group) {
      const text = group_labels.get(tab.id) ?? base
      clusters.set(text, [...(clusters.get(text) ?? []), tab])
    }
    for (const members of clusters.values()) {
      if (members.length < 2) continue
      // the same path in two repositories has no folder left to add
      if (new Set(members.map((tab) => tab.path)).size === 1) continue
      for (const tab of members) {
        group_labels.set(tab.id, label(tab.path, at, true))
      }
    }
    // identical paths in different repositories: the repository is the answer
    for (const id of collisions(group_labels)) {
      const tab = group.find((entry) => entry.id === id)
      if (tab === undefined) continue
      group_labels.set(
        id,
        `${repoName(tab.repoId)}:${group_labels.get(id) ?? base}`,
      )
    }
    for (const [id, text] of group_labels) labels.set(id, text)
  }
  return labels
}
