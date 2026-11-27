/** Looking things up in the library: one question in, the best passages out, with where each came from. */

export type Passage = {
  id: string;
  kind: "material" | "note";
  source: string;
  page: number | null;
  section: string | null;
  content: string;
  /** Cosine similarity of meaning, when the passage was found by meaning; null when found by keyword only. */
  similarity: number | null;
  score: number;
};

/** A failed library search. The message is safe to show: it says what the database answered, never a key. */
export class LibraryError extends Error {}

/** Passages sent to the model per lookup. */
export const DEFAULT_PASSAGES = 6;

/** Words worth searching for: lower-case letters only, at least 3 long, no repeats, at most 12. */
export function keywordQuery(question: string): string {
  const words = question.toLowerCase().match(/[\p{L}]{3,}/gu) ?? [];
  return [...new Set(words)].slice(0, 12).join(" ");
}

/** A vector as the text pgvector reads: "[0.1,0.2,...]". */
export const vectorText = (v: readonly number[]): string => `[${v.join(",")}]`;

/** The part of the Supabase client the search needs, so tests and scripts can pass their own. */
export type SearchClient = {
  rpc(
    fn: "search_language",
    args: { query_embedding: string | null; query_text: string; match_count: number },
  ): PromiseLike<{ data: unknown; error: { message: string } | null }>;
};

/** One database row as a Passage, or null when it is not shaped like one. */
export function toPassage(row: unknown): Passage | null {
  const r = row as Record<string, unknown> | null;
  if (!r || typeof r["id"] !== "string" || typeof r["source"] !== "string" || typeof r["content"] !== "string") return null;
  return {
    id: r["id"],
    kind: r["kind"] === "note" ? "note" : "material",
    source: r["source"],
    page: typeof r["page"] === "number" ? r["page"] : null,
    section: typeof r["section"] === "string" ? r["section"] : null,
    content: r["content"],
    similarity: typeof r["similarity"] === "number" ? r["similarity"] : null,
    score: typeof r["score"] === "number" ? r["score"] : 0,
  };
}

/**
 * Finds passages for a question by meaning and by keyword together. `embedQuery` makes the vector; when it fails the
 * search falls back to keywords only, so a missing key or an AI outage never leaves the library unusable.
 */
export async function searchLibrary(
  client: SearchClient,
  embedQuery: (text: string) => Promise<readonly number[]>,
  question: string,
  count = DEFAULT_PASSAGES,
  onEmbedError: (e: unknown) => void = () => {},
): Promise<Passage[]> {
  const text = question.trim().slice(0, 500);
  if (!text) return [];
  let embedding: string | null = null;
  try {
    embedding = vectorText(await embedQuery(text));
  } catch (e) {
    onEmbedError(e);
  }
  const { data, error } = await client.rpc("search_language", { query_embedding: embedding, query_text: keywordQuery(text), match_count: count });
  if (error) throw new LibraryError(`Could not search your library: ${error.message.slice(0, 200)} (has migration 0013 been run in this Supabase project?)`);
  return (Array.isArray(data) ? data : []).map(toPassage).filter((p): p is Passage => p !== null);
}
