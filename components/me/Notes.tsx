"use client";

import { useActionState, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteNote, saveNote } from "@/app/actions/notes";
import { Button } from "@/components/ui/Button";
import { Textarea } from "@/components/ui/Field";
import { ErrorBox } from "@/components/ui/Feedback";

export type NoteRow = { id: string; body: string; updatedAt: string };

export function Notes({ notes }: { notes: NoteRow[] }) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(saveNote, null);
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [, startTransition] = useTransition();

  return (
    <div className="space-y-4">
      <form
        action={(data) => {
          formAction(data);
          setDraft("");
        }}
        className="space-y-3"
      >
        <Textarea
          name="body"
          rows={3}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Only you can read this."
          required
        />
        {state && "error" in state && <ErrorBox>{state.error}</ErrorBox>}
        <Button type="submit" variant="secondary" disabled={pending || !draft.trim()}>
          {pending ? "Saving…" : "Add note"}
        </Button>
      </form>

      {notes.length > 0 && (
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
                  <Textarea
                    name="body"
                    rows={3}
                    value={editText}
                    onChange={(e) => setEditText(e.target.value)}
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
        </ul>
      )}
    </div>
  );
}
