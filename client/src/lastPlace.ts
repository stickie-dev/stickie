/**
 * The last address that was not settings.
 *
 * Settings is a page whose sections are addresses, so opening three of them
 * pushes three entries — and "back" then walks Identity, Storage, GitLab before
 * it ever leaves. What the button means is "the thing I was looking at", which
 * is the last review or overview address, remembered as it is visited.
 *
 * A module variable rather than store state: nothing renders from it, and a
 * value that only one button reads on click has no business causing renders.
 */

let last = '/'

export function rememberPlace(address: string): void {
  if (address === '') return
  last = address
}

export function lastPlace(): string {
  return last
}
