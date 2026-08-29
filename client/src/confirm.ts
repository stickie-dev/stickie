/**
 * Asking before doing something that cannot be taken back, in stickie's own
 * window rather than the browser's.
 *
 * `window.confirm` was doing this: it looks like the browser and not like the
 * app, it cannot say what is at stake in more than one flat line, it blocks the
 * whole page while it is up, and on some browsers a second one can be
 * suppressed entirely — which would silently turn "are you sure" into "yes".
 *
 * The shape is deliberately the same as the thing it replaces, so a caller
 * reads the same way: `if (await ask({…})) …`. One request at a time; a second
 * while one is open answers it no, since two questions stacked over each other
 * is how the wrong one gets answered.
 */

export interface ConfirmRequest {
  /** what is being decided, in a few words */
  title: string
  /** what will happen, including anything that cannot be undone */
  detail?: string
  /** the verb, on the button that does it */
  confirmLabel: string
  cancelLabel?: string
  /** destructive things are the colour of destructive things */
  danger?: boolean
}

type Pending = { request: ConfirmRequest; settle: (ok: boolean) => void }

let pending: Pending | null = null
const listeners = new Set<() => void>()

function announce(): void {
  for (const listener of listeners) listener()
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function current(): ConfirmRequest | null {
  return pending?.request ?? null
}

export function ask(request: ConfirmRequest): Promise<boolean> {
  if (pending !== null) {
    pending.settle(false)
    pending = null
  }
  return new Promise<boolean>((resolve) => {
    pending = { request, settle: resolve }
    announce()
  })
}

export function answer(ok: boolean): void {
  const open = pending
  pending = null
  announce()
  open?.settle(ok)
}
