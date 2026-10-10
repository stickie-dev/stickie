/**
 * Moves one id to just before or just after another, and returns the new
 * order.
 *
 * Placed against a neighbour rather than at an index, because the list a
 * note is dragged in is not always the whole order: with only the unresolved
 * notes shown, "third" in the panel is not third in the prompt, but "after
 * this one" means the same thing in both.
 *
 * Anything it cannot place — an id that is not there, a note dropped on
 * itself — leaves the order as it was.
 */
export function placeId(
  ids: readonly number[],
  moving: number,
  target: number,
  after: boolean,
): number[] {
  if (moving === target || !ids.includes(moving) || !ids.includes(target)) {
    return [...ids]
  }
  const rest = ids.filter((id) => id !== moving)
  const at = rest.indexOf(target) + (after ? 1 : 0)
  return [...rest.slice(0, at), moving, ...rest.slice(at)]
}

/**
 * Where a pointer at `y` would drop among cards laid out top to bottom: the
 * card it is over, and whether it is past that card's middle. Above the first
 * card is before it; below the last is after it.
 */
export function dropAt(
  cards: readonly { id: number; top: number; bottom: number }[],
  y: number,
): { id: number; after: boolean } | null {
  for (const card of cards) {
    if (y < card.bottom) {
      return { id: card.id, after: y > (card.top + card.bottom) / 2 }
    }
  }
  const last = cards.at(-1)
  return last === undefined ? null : { id: last.id, after: true }
}
