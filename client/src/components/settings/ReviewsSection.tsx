import { useEffect, useState } from 'react'
import type { NoteDefault, RemoveMode, RepinMode, SubmitKey } from '../../api'
import { Field, Mono, Section } from './parts'
import { field } from '../../ui'
import type { SettingsAccess } from './useSettings'

const choices: { value: RepinMode; label: string; why: string }[] = [
  {
    value: 'always',
    label: 'Move it automatically',
    why: 'An agent committing mid-review is the normal case, and stopping to press a button for it is friction.',
  },
  {
    value: 'when-clear',
    label: 'Only while no notes are open',
    why: 'Moving the base can leave a note without the code it was written against, so hold off while any note is unresolved or still a draft.',
  },
  {
    value: 'never',
    label: 'Leave it to me',
    why: 'The review keeps its base until you press re-pin.',
  },
]

const submit_choices: { value: SubmitKey; label: string; why: string }[] = [
  {
    value: 'enter',
    label: 'Enter posts, Shift+Enter makes a new line',
    why: 'A note is usually one sentence.',
  },
  {
    value: 'mod-enter',
    label: '⌘/Ctrl+Enter posts, Enter makes a new line',
    why: 'For notes that are usually several lines.',
  },
]

const note_choices: { value: NoteDefault; label: string; why: string }[] = [
  {
    value: 'draft',
    label: 'A draft, held back until you send the review',
    why: 'An agent gets a finished review rather than a note at a time. Submit review sends the batch, and a single note can still be posted on its own.',
  },
  {
    value: 'comment',
    label: 'A comment, sent to the agent at once',
    why: 'For working alongside an agent a note at a time.',
  },
]

const remove_choices: { value: RemoveMode; label: string; why: string }[] = [
  {
    value: 'delete',
    label: 'Delete its reviews and notes with it',
    why: 'A repository is removed because it is finished with, and a workspace holding every review of every repository ever added is its own kind of mess. What was removed, and how many notes went, stays in the record.',
  },
  {
    value: 'unregister',
    label: 'Keep them, out of the workspace',
    why: 'The notes matter more than the tidiness: the repository leaves the workspace and adding the same path back brings its reviews and notes again. A repository with no notes is deleted either way.',
  },
]

/** What a days field holds: digits, or nothing for never. */
function daysFrom(text: string): number | null | 'bad' {
  const trimmed = text.trim()
  if (trimmed === '') return null
  const value = Number(trimmed)
  return Number.isInteger(value) && value >= 1 && value <= 3650 ? value : 'bad'
}

/**
 * The two numbers of the expiry policy. Saved together when either field is
 * left, and only as a pair that makes sense: deleting before archiving would
 * take away the warning archiving is for, and the server refuses it anyway.
 */
function Expiry({ state, save }: SettingsAccess) {
  const [archive, setArchive] = useState('')
  const [remove, setRemove] = useState('')
  useEffect(() => {
    if (state !== null) {
      setArchive(
        state.archiveAfterDays === null ? '' : String(state.archiveAfterDays),
      )
      setRemove(
        state.deleteAfterDays === null ? '' : String(state.deleteAfterDays),
      )
    }
  }, [state])

  const a = daysFrom(archive)
  const d = daysFrom(remove)
  const problem =
    a === 'bad' || d === 'bad'
      ? 'A whole number of days from 1 to 3650, or empty for never.'
      : a !== null && d !== null && d <= a
        ? 'Deleting has to come later than archiving — archiving is the warning.'
        : null

  const commit = () => {
    if (state === null || problem !== null || a === 'bad' || d === 'bad') return
    if (a === state.archiveAfterDays && d === state.deleteAfterDays) return
    void save({ archiveAfterDays: a, deleteAfterDays: d }, { quiet: true })
  }

  const days = (
    value: string,
    set: (text: string) => void,
    label: string,
  ) => (
    <span className="flex items-center gap-2">
      <input
        // not `field_classes`: that is full width, and a number of days is
        // four digits at most
        className={`w-16 py-1.5 font-mono text-xs ${field}`}
        inputMode="numeric"
        placeholder="never"
        aria-label={label}
        value={value}
        onChange={(e) => set(e.target.value)}
        onBlur={commit}
      />
      <span className="text-faint">days</span>
    </span>
  )

  return (
    <Field
      label="Reviews left alone"
      hint={
        <>
          Left alone means nothing in the record — no note, reply, resolution
          or file marked read — no opening it, and no commit on its branch.
          Archived reviews wait in the overview's Archived list, so nothing is
          deleted without having sat there for at least the difference between
          the two. Deleting takes the notes and keeps the record of them. A
          review marked <Mono>keep</Mono> on the overview is never touched.
          Empty is never.
        </>
      }
    >
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-xs">
        <span className="flex items-center gap-2">
          <span className="text-ink">archive after</span>
          {days(archive, setArchive, 'archive after this many days')}
        </span>
        <span className="flex items-center gap-2">
          <span className="text-ink">delete after</span>
          {days(remove, setRemove, 'delete after this many days')}
        </span>
      </div>
      {problem !== null && (
        <p className="mt-1 text-xs text-rose-500">{problem}</p>
      )}
    </Field>
  )
}

export function ReviewsSection(access: SettingsAccess) {
  const { state, save } = access
  const [mode, setMode] = useState<RepinMode>('always')
  const [submit, setSubmit] = useState<SubmitKey>('enter')
  const [note, setNote] = useState<NoteDefault>('draft')
  const [removal, setRemoval] = useState<RemoveMode>('delete')
  useEffect(() => {
    if (state !== null) {
      setMode(state.repinMode)
      setSubmit(state.submitKey)
      setNote(state.noteDefault)
      setRemoval(state.removeMode)
    }
  }, [state])

  return (
    <Section
      title="Reviews"
      blurb="A review is a working tree or a branch against a base, and the commit that base is pinned to is what the diff is measured from. When the branch moves on, that pin has to move with it — or not."
    >
      <Field
        label="When the base moves on"
        hint={
          <>
            Whichever it is, both shas are kept in the record, and a re-pin that
            leaves a note without its code says so rather than passing quietly.
            A note that cannot be found again turns <Mono>detached</Mono>.
          </>
        }
      >
        <div className="space-y-2">
          {choices.map((choice) => (
            <label
              key={choice.value}
              className="flex cursor-pointer gap-2 text-xs"
            >
              <input
                type="radio"
                name="repin-mode"
                className="mt-0.5 shrink-0"
                checked={mode === choice.value}
                onChange={() => {
                  setMode(choice.value)
                  void save({ repinMode: choice.value }, { quiet: true })
                }}
              />
              <span>
                <span className="text-ink">{choice.label}</span>
                <span className="block text-faint">{choice.why}</span>
              </span>
            </label>
          ))}
        </div>
      </Field>
      <Field
        label="Posting a comment"
        hint={
          <>
            Applies to notes, replies and edits alike. <Mono>⌘/Ctrl+Enter</Mono>{' '}
            posts either way — it has never meant a new line.
          </>
        }
      >
        <div className="space-y-2">
          {submit_choices.map((choice) => (
            <label
              key={choice.value}
              className="flex cursor-pointer gap-2 text-xs"
            >
              <input
                type="radio"
                name="submit-key"
                className="mt-0.5 shrink-0"
                checked={submit === choice.value}
                onChange={() => {
                  setSubmit(choice.value)
                  void save({ submitKey: choice.value }, { quiet: true })
                }}
              />
              <span>
                <span className="text-ink">{choice.label}</span>
                <span className="block text-faint">{choice.why}</span>
              </span>
            </label>
          ))}
        </div>
      </Field>

      <Field
        label="A new note starts as"
        hint="The submit button says which, and the arrow beside it changes this without coming here."
      >
        <div className="space-y-2">
          {note_choices.map((choice) => (
            <label
              key={choice.value}
              className="flex cursor-pointer gap-2 text-xs"
            >
              <input
                type="radio"
                name="note-default"
                className="mt-0.5 shrink-0"
                checked={note === choice.value}
                onChange={() => {
                  setNote(choice.value)
                  void save({ noteDefault: choice.value }, { quiet: true })
                }}
              />
              <span>
                <span className="text-ink">{choice.label}</span>
                <span className="block text-faint">{choice.why}</span>
              </span>
            </label>
          ))}
        </div>
      </Field>

      <Field
        label="Removing a repository"
        hint="The overview asks before it does either, and says how many notes are at stake."
      >
        <div className="space-y-2">
          {remove_choices.map((choice) => (
            <label
              key={choice.value}
              className="flex cursor-pointer gap-2 text-xs"
            >
              <input
                type="radio"
                name="remove-mode"
                className="mt-0.5 shrink-0"
                checked={removal === choice.value}
                onChange={() => {
                  setRemoval(choice.value)
                  void save({ removeMode: choice.value }, { quiet: true })
                }}
              />
              <span>
                <span className="text-ink">{choice.label}</span>
                <span className="block text-faint">{choice.why}</span>
              </span>
            </label>
          ))}
        </div>
      </Field>

      <Expiry {...access} />
    </Section>
  )
}
