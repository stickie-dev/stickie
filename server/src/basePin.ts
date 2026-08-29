/**
 * What a review's base pin should do when the ref it was resolved from has
 * moved — the rule, on its own, because two routes need the same answer and
 * one of them acts on it without being asked.
 *
 * A base only ever moves *forward*. The whole justification for re-pinning is
 * that the code the notes were written against is still there and they will
 * re-anchor onto it, which is true exactly when the pinned commit is in the
 * history of where the pin would go. When it is not, the source is on another
 * line of history — a branch cut from an older point, a rebase, a reset — and
 * moving the pin there does not carry the review forward, it points it at a
 * different piece of work.
 */
export interface BasePinState {
  /** the base moved on, and moving the pin follows it */
  stale: boolean
  /** the source is on a line of history that does not contain this base */
  diverged: boolean
  /** where the pin would go; null when there is nowhere to go */
  next: string | null
}

const settled: BasePinState = { stale: false, diverged: false, next: null }

/**
 * @param pinned the commit this review is pinned to
 * @param resolved what its base ref resolves to against the source now, or
 *   null when git could not say
 * @param forward whether `pinned` is an ancestor of `resolved`
 */
export function classifyBasePin(
  pinned: string,
  resolved: string | null,
  forward: boolean,
): BasePinState {
  if (resolved === null || resolved === pinned) return settled
  if (forward) return { stale: true, diverged: false, next: resolved }
  return { stale: false, diverged: true, next: resolved }
}
