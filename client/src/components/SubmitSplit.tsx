import type { NoteDefault } from '../api'
import { useReview } from '../store'
import { ChevronDown, Send } from '../icons'
import { btn, motion } from '../ui'

const note_actions: { value: NoteDefault; label: string; why: string }[] = [
  {
    value: 'draft',
    label: 'Draft',
    why: 'joins the review; no agent sees it until you send',
  },
  { value: 'comment', label: 'Comment', why: 'goes to the agent at once' },
]

/**
 * Submit, and the choice of what submitting means: the button does the thing it
 * says, and the arrow beside it offers the other way.
 *
 * The button used to say "comment" and produce a draft, because a reviewer's
 * note joins the batch by default — which is the point of the batch, but not
 * something a label should misreport.
 *
 * Two things a menu in a Monaco view zone has to work around, both measured
 * rather than assumed. A zone clips whatever leaves its box, so the menu opens
 * *in the card*, above the row: the card grows, the zone re-measures, and
 * everything fits. And this form keeps no state of its own — `useState` here
 * came back false on the very next read — so which menu is open lives in the
 * store, beside the draft body and the reply text, which are in there for the
 * same reason.
 *
 * Choosing from the menu changes what the button is, and does not send. Two
 * steps for two decisions: a menu that sent as well meant the only way to look
 * at the other option was to take it.
 *
 * It closes when a choice is made, on Escape, or on the arrow again. No
 * document-level click handler: that is what used to close it inside the same
 * click that opened it.
 */
export function SubmitSplit({
  menuKey,
  disabled,
  onPick,
  onSubmit,
}: {
  /** which composer this belongs to, since only one menu is open at a time */
  menuKey: string
  disabled: boolean
  /** switch what the button does, without doing it */
  onPick: (as: NoteDefault) => void
  onSubmit: (as: NoteDefault) => void
}) {
  const noteDefault = useReview((s) => s.noteDefault)
  const listing = useReview((s) => s.splitMenuFor === menuKey)
  const setSplitMenu = useReview((s) => s.setSplitMenu)
  const setListing = (open: boolean) => setSplitMenu(open ? menuKey : null)
  const current =
    note_actions.find((action) => action.value === noteDefault) ??
    note_actions[0]
  const others = note_actions.filter((action) => action.value !== current?.value)
  if (current === undefined) return null

  return (
    <span className="flex flex-col items-end">
      {listing && (
        <span className="mb-1 flex flex-col overflow-hidden rounded-sm bg-panel text-xs shadow-lifted">
          {others.map((action) => (
            <button
              key={action.value}
              className={`px-2.5 py-1.5 text-left text-ink hover:bg-overlay ${motion}`}
              title={`${action.why} — this makes it the button, and remembers it`}
              onClick={() => {
                setListing(false)
                onPick(action.value)
              }}
            >
              {action.label}
              <span className="ml-1.5 text-faint">{action.why}</span>
            </button>
          ))}
        </span>
      )}
      <span className="inline-flex overflow-hidden rounded-xs">
        {/*
          The plane is on Comment and not on Draft, because it means one thing:
          this leaves the building now. A draft joins the batch and waits, and
          marking both the same way would make the icon decoration.
        */}
        <button
          className={`inline-flex items-center gap-1.5 rounded-none text-xs ${btn('primary', 'shadow-none')}`}
          disabled={disabled}
          title={current.why}
          onClick={() => onSubmit(current.value)}
        >
          {current.value === 'comment' && <Send />}
          {current.label}
        </button>
        {/* the seam, so the two halves read as one control with two parts */}
        <span className="w-px bg-white/25" />
        <button
          className={`rounded-none px-1.5 text-xs ${btn('primary', 'shadow-none')}`}
          disabled={disabled}
          title="send it the other way instead"
          aria-expanded={listing}
          aria-label="other ways to send this note"
          onClick={() => setListing(!listing)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setListing(false)
          }}
        >
          <ChevronDown />
        </button>
      </span>
    </span>
  )
}
