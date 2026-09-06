"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getSessionContext } from "@/lib/auth";

export type NoteResult = { ok: true } | { error: string };

/**
 * Private notes (§6, "Calendar and notes").
 *
 * "A notes area, private to the person who writes it. HR cannot read an
 * employee's notes and an employee cannot read HR's. This must be stated
 * plainly to everyone, because a private notepad that turns out not to be
 * private is worse than no notepad at all."
 *
 * There is deliberately NO audit line here. Everything else in this system
 * writes one — but recording that somebody wrote a private note, and when,
 * is itself a record of their private thinking. Notes are not a company
 * record and are not treated as one.
 */

const schema = z.object({
  body: z.string().trim().min(1, "Write something first.").max(5000, "That note is too long."),
});

export async function saveNote(_previous: unknown, formData: FormData): Promise<NoteResult> {
  const context = await getSessionContext();
  if (!context) return { error: "Please sign in again." };

  const parsed = schema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]!.message };

  const id = String(formData.get("id") ?? "").trim();

  if (id) {
    // Scoped in the query: a note id belonging to somebody else matches
    // nothing rather than being fetched and then compared.
    const updated = await prisma.note.updateMany({
      where: { id, userId: context.user.id },
      data: { body: parsed.data.body },
    });
    if (updated.count === 0) return { error: "Not found." };
  } else {
    await prisma.note.create({ data: { userId: context.user.id, body: parsed.data.body } });
  }

  revalidatePath("/me/calendar");
  return { ok: true };
}

export async function deleteNote(id: string): Promise<NoteResult> {
  const context = await getSessionContext();
  if (!context) return { error: "Please sign in again." };

  // The one thing in this system that genuinely is deleted. Rule 8 exists so
  // the company can produce a record when asked; a person's own notepad is not
  // that record, and a notepad you cannot tear a page out of is not a notepad.
  const deleted = await prisma.note.deleteMany({ where: { id, userId: context.user.id } });
  if (deleted.count === 0) return { error: "Not found." };

  revalidatePath("/me/calendar");
  return { ok: true };
}
