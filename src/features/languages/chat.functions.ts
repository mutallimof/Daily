import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { AiError, complete, completeStream, embed } from "@/features/gym/ai-provider.server";
import { cleanNote, cleanTurns } from "./chat";
import { runChat } from "./chat-engine";
import { searchReranked } from "./rerank";
import { LibraryError, searchLibrary, vectorText, type SearchClient } from "./search";
import { encodeEvent, type LangEvent } from "./stream";

/**
 * One turn of the Languages chat, streamed: one JSON event per line (see `stream.ts`). The person's own library is
 * searched first (row-level security keeps it to their rows), and the answer cites the passages it used. What leaves
 * the server for the AI provider: the question, the matching passages and the last few turns. Problems arrive as an
 * "error" event, so the page keeps working.
 */
export const askLanguages = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { turns: unknown }) => ({ turns: cleanTurns(d?.turns) }))
  .handler(async ({ data, context }): Promise<Response> => {
    const { supabase } = context;
    const encoder = new TextEncoder();
    const client = supabase as unknown as SearchClient;

    async function run(emit: (e: LangEvent) => void): Promise<void> {
      if (!data.turns.length) return emit({ type: "error", error: "Type a message first." });
      try {
        const outcome = await runChat(
          {
            complete: (messages, tools, onText) => completeStream(messages, tools, onText ?? (() => {})),
            search: (query) =>
              searchReranked(
                client,
                async (t) => (await embed([t]))[0] ?? [],
                async (prompt) => (await complete([{ role: "user", content: prompt }])).text,
                query,
                undefined,
                (e) => console.error("Languages: a search step fell back,", e instanceof Error ? e.message : e),
              ),
          },
          data.turns,
          (delta) => emit({ type: "text", delta }),
        );
        emit({ type: "done", ...outcome });
      } catch (e) {
        const known = e instanceof AiError || e instanceof LibraryError;
        if (!known) console.error(e);
        emit({ type: "error", error: known ? e.message : "The AI request failed — please try again." });
      }
    }

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          await run((e) => controller.enqueue(encoder.encode(encodeEvent(e))));
        } catch (e) {
          console.error(e);
          controller.enqueue(encoder.encode(encodeEvent({ type: "error", error: "The AI request failed — please try again." })));
        } finally {
          controller.close();
        }
      },
    });
    return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" } });
  });

/**
 * Saves a note to the library (the person confirmed it, or typed it). The note is turned into a vector so it can be
 * found by meaning; if that fails it is still saved and found by keyword, and the answer says so.
 */
export const saveNote = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { title?: unknown; text: unknown }) => ({ note: cleanNote(d) }))
  .handler(async ({ data, context }): Promise<{ ok: true; id: string; searchable: "meaning" | "keyword" } | { ok: false; error: string }> => {
    if (!data.note) return { ok: false, error: "Write the note first." };
    const { supabase, userId } = context;
    const { title, text } = data.note;
    let embedding: string | null = null;
    try {
      embedding = vectorText((await embed([`${title}\n${text}`]))[0] ?? []);
    } catch (e) {
      console.error("Languages: note saved without an embedding,", e instanceof Error ? e.message : e);
    }
    const row = await supabase
      .from("language_chunks")
      .insert({ user_id: userId, kind: "note", source: title, content: text, ...(embedding ? { embedding } : {}) })
      .select("id")
      .single();
    if (row.error || !row.data) {
      console.error(row.error);
      return { ok: false, error: "Could not save the note — has migration 0013 been run?" };
    }
    return { ok: true, id: row.data.id, searchable: embedding ? "meaning" : "keyword" };
  });
