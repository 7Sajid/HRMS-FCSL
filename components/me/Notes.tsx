"use client";

import { useActionState, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteNote, saveNote } from "@/app/actions/notes";
import { Button } from "@/components/ui/Button";
import { Input, Textarea } from "@/components/ui/Field";
import { ErrorBox } from "@/components/ui/Feedback";

/** `date` is "2026-09-14"; `updatedAt` is already formatted for reading. */
export type NoteRow = { id: string; body: string; date: string; updatedAt: string };

/**
 * Write a note for a day (FCSL, 10 September 2026).
 *
 * The day arrives from the calendar beside it and can be changed here. The page
 * gives this a `key` of the day, so picking another day starts a fresh form
 * rather than carrying one day's date into the next.
 */
export function NoteForm({ date }: { date: string }) {
  const [state, formAction, pending] = useActionState(saveNote, null);
  const [draft, setDraft] = useState("");
  const [day, setDay] = useState(date);

  return (
    <form
      action={(data) => {
        formAction(data);
        setDraft("");
      }}
      className="space-y-3"
    >
      <label className="block text-xs font-medium text-ink-500" htmlFor="note-date">
        Write a note for
      </label>
      <Input
        id="note-date"
        name="date"
        type="date"
        value={day}
        onChange={(e) => setDay(e.target.value)}
        required
      />
      <Textarea
        name="body"
        rows={3}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder="Only you can read this."
        aria-label="Note"
        required
      />
      {state && "error" in state && <ErrorBox>{state.error}</ErrorBox>}
      <Button type="submit" variant="secondary" disabled={pending || !draft.trim() || !day}>
        {pending ? "Saving…" : "Add note"}
      </Button>
    </form>
  );
}

/** One day's notes, each editable — the day included, so a note moves when a meeting does. */
export function NoteList({ notes, emptyText }: { notes: NoteRow[]; emptyText: string }) {
  const router = useRouter();
  const [state, formAction] = useActionState(saveNote, null);
  const [editing, setEditing] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [editDate, setEditDate] = useState("");
  const [, startTransition] = useTransition();

  if (!notes.length) return <p className="text-xs text-ink-400">{emptyText}</p>;

  return (
    <ul className="space-y-2">
      {notes.map((note) => (
        <li key={note.id} className="rounded-lg border border-ink-300/40 bg-white p-4">
          {editing === note.id ? (
            <form
              action={(data) => {
                formAction(data);
                setEditing(null);
              }}
              className="space-y-2"
            >
              <input type="hidden" name="id" value={note.id} />
              <Input
                name="date"
                type="date"
                value={editDate}
                onChange={(e) => setEditDate(e.target.value)}
                aria-label="Day this note is for"
                required
              />
              <Textarea
                name="body"
                rows={3}
                value={editText}
                onChange={(e) => setEditText(e.target.value)}
                aria-label="Note"
              />
              <div className="flex gap-2">
                <Button type="submit" variant="primary" className="px-3 py-1.5 text-xs">
                  Save
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  className="px-3 py-1.5 text-xs"
                  onClick={() => setEditing(null)}
                >
                  Cancel
                </Button>
              </div>
            </form>
          ) : (
            <>
              <p className="whitespace-pre-wrap text-sm text-ink-900">{note.body}</p>
              <div className="mt-2 flex items-center gap-3">
                <span className="text-xs text-ink-400">{note.updatedAt}</span>
                <button
                  type="button"
                  className="text-xs text-ink-500 hover:text-ink-900"
                  onClick={() => {
                    setEditing(note.id);
                    setEditText(note.body);
                    setEditDate(note.date);
                  }}
                >
                  Edit
                </button>
                <button
                  type="button"
                  className="text-xs text-ink-500 hover:text-red-600"
                  onClick={() =>
                    startTransition(async () => {
                      await deleteNote(note.id);
                      router.refresh();
                    })
                  }
                >
                  Delete
                </button>
              </div>
            </>
          )}
        </li>
      ))}
      {state && "error" in state && (
        <li>
          <ErrorBox>{state.error}</ErrorBox>
        </li>
      )}
    </ul>
  );
}
