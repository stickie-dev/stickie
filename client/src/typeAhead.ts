/** A run of typing stops being one run after this long a pause. */
export const type_ahead_pause = 800

/**
 * Which option a run of typed characters means.
 *
 * Prefix matching, wrapping past the end of the list, because that is what
 * every list a reader has ever typed at does — it is the behaviour a `<select>`
 * gave us and the one thing about writing our own that nobody would think to
 * ask for until it was missing.
 *
 * Two rules that are not obvious and are both worth keeping:
 *
 * - One character repeated cycles through the options starting with it, rather
 *   than searching for "mmm". Pressing `m` four times in a list of four `m`
 *   branches is how you reach the fourth.
 * - A run of *different* characters searches from where the cursor already is,
 *   not past it. Typing `m` then `a` has to be able to land on the same `main`
 *   the `m` did, or refining a search walks away from the answer.
 */
export function typeAheadIndex(
  labels: string[],
  typed: string,
  from: number,
): number {
  if (labels.length === 0 || typed === '') return -1
  const run = typed.toLowerCase()
  const first = run[0] ?? ''
  const repeated = run.length > 1 && [...run].every((c) => c === first)
  const needle = repeated ? first : run
  // a fresh single character moves on; a growing run stays where it is
  const start = repeated || run.length === 1 ? from + 1 : from
  for (let step = 0; step < labels.length; step += 1) {
    const at = (((start + step) % labels.length) + labels.length) % labels.length
    if ((labels[at] ?? '').toLowerCase().startsWith(needle)) return at
  }
  return -1
}
