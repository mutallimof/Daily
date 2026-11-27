import { queryOptions, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { localDay, newWords, review, type Article, type Word, type WordDraft } from "./vocab";

export type LibraryInfo = { total: number; material: number; notes: number };
export type NoteRow = { id: string; source: string; content: string; created_at: string };

function check<T>(res: { data: T; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return res.data;
}

/** How much is in the library: pieces of material and saved notes. */
export const libraryQuery = queryOptions({
  queryKey: ["languages", "library"],
  queryFn: async (): Promise<LibraryInfo> => {
    const count = async (kind: "material" | "note") => {
      const res = await supabase.from("language_chunks").select("id", { count: "exact" }).eq("kind", kind).limit(1);
      if (res.error) throw new Error(res.error.message);
      return res.count ?? 0;
    };
    const [material, notes] = await Promise.all([count("material"), count("note")]);
    return { total: material + notes, material, notes };
  },
});

export const notesQuery = queryOptions({
  queryKey: ["languages", "notes"],
  queryFn: async (): Promise<NoteRow[]> => check(await supabase.from("language_chunks").select("id, source, content, created_at").eq("kind", "note").order("created_at", { ascending: false })) ?? [],
});

export async function deleteNote(id: string): Promise<void> {
  const res = await supabase.from("language_chunks").delete().eq("id", id).eq("kind", "note");
  if (res.error) throw new Error(res.error.message);
}

export function useInvalidateLanguages() {
  const qc = useQueryClient();
  return () => Promise.all([qc.invalidateQueries({ queryKey: ["languages"] })]);
}

/** The whole word list, newest first. */
export const wordsQuery = queryOptions({
  queryKey: ["languages", "words"],
  queryFn: async (): Promise<Word[]> => {
    const rows = check(await supabase.from("vocab_words").select("*").order("created_at", { ascending: false })) ?? [];
    return rows.map((r) => ({ ...r, article: (r.article as Article | null) ?? null }));
  },
});

/** Saves words that are not in the list yet (the same German word, in any letter case, is saved once). */
export async function addWords(drafts: readonly WordDraft[]): Promise<{ added: number; skipped: number }> {
  const existing = check(await supabase.from("vocab_words").select("german")) ?? [];
  const { fresh, skipped } = newWords(drafts, existing.map((r) => r.german));
  if (fresh.length) {
    const res = await supabase.from("vocab_words").insert(fresh.map((w) => ({ german: w.german, article: w.article, plural: w.plural, english: w.english, example: w.example })));
    if (res.error) throw new Error(res.error.message);
  }
  return { added: fresh.length, skipped };
}

/** Records one review: a known word moves up a box and waits longer, a missed one is due again today. */
export async function reviewWord(word: Pick<Word, "id" | "box">, knew: boolean): Promise<void> {
  const next = review(word.box, knew, localDay());
  const res = await supabase.from("vocab_words").update(next).eq("id", word.id);
  if (res.error) throw new Error(res.error.message);
}

export async function deleteWord(id: string): Promise<void> {
  const res = await supabase.from("vocab_words").delete().eq("id", id);
  if (res.error) throw new Error(res.error.message);
}
