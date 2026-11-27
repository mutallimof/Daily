import { z } from "zod";
import type { ToolDef } from "@/features/gym/ai-provider.server";
import type { Passage } from "./search";
import { MAX_PROPOSED_WORDS, cleanWord, type WordDraft } from "./vocab";

export const MAX_TURNS = 8;
export const MAX_TURN_CHARS = 1000;
/** Longest note the chat may propose, and the longest a person may type. */
export const MAX_NOTE_CHARS = 2000;
/** Characters of one passage shown to the model. */
export const MAX_PASSAGE_CHARS = 700;

export type ChatTurn = { role: "user" | "assistant"; content: string };

/** Keeps only well-formed user and assistant turns, the latest few, each cut short. The first turn is always the user's. */
export function cleanTurns(value: unknown): ChatTurn[] {
  if (!Array.isArray(value)) return [];
  const turns: ChatTurn[] = [];
  for (const v of value) {
    const o = v as Record<string, unknown> | null;
    if (!o || (o["role"] !== "user" && o["role"] !== "assistant") || typeof o["content"] !== "string") continue;
    const content = o["content"].trim().slice(0, MAX_TURN_CHARS);
    if (content) turns.push({ role: o["role"], content });
  }
  const last = turns.slice(-MAX_TURNS);
  while (last.length && last[0]?.role !== "user") last.shift();
  return last;
}

export const SYSTEM_PROMPT = [
  "You help a person learn German (about level A1 to B1). Their own library of word lists, grammar notes and personal notes is searched for you.",
  "Passages from it arrive numbered like [1], [2]. Answer from those passages and put the number in square brackets right after each claim it supports, for example: Dative plural gets an -n [2].",
  "Never cite a number that was not given. If the passages do not answer the question, say so in one short sentence (\"That is not in your material\") and then give a brief answer from general knowledge, clearly marked as general knowledge, without numbers.",
  "Give German examples with an English translation. Keep answers short: a rule in two or three lines and a few examples. If the person wrote German with mistakes, correct them and say why.",
  "Use search_notes for another lookup when the passages are not enough (at most three times). Use add_note only when the person asks to keep something; use add_words only when the person asks to put words into their vocabulary list (give the article for nouns, a short English meaning and, if useful, a short example). They confirm on screen before anything is saved.",
].join(" ");

export const CHAT_TOOLS: ToolDef[] = [
  {
    type: "function",
    name: "search_notes",
    description: "Search the person's library (word lists, grammar notes, their notes) for passages about a topic or a word. Returns numbered passages.",
    parameters: { type: "object", properties: { query: { type: "string", description: "A word, a grammar topic or a short question." } }, required: ["query"] },
  },
  {
    type: "function",
    name: "add_note",
    description: "Propose a short note to save in the person's library. Only when they ask to keep something. They confirm before it is saved.",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", description: "A short title, for example 'wurde vs würde'." },
        text: { type: "string", description: "The note itself, a few lines." },
      },
      required: ["text"],
    },
  },
  {
    type: "function",
    name: "add_words",
    description: "Propose German words for the person's vocabulary list. Only when they ask for words to be added. They confirm before anything is saved.",
    parameters: {
      type: "object",
      properties: {
        words: {
          type: "array",
          description: `Up to ${MAX_PROPOSED_WORDS} words.`,
          items: {
            type: "object",
            properties: {
              german: { type: "string", description: "The word without its article, for example 'Teig'." },
              article: { type: "string", description: "der, die or das, for nouns." },
              plural: { type: "string", description: "The plural form, for nouns." },
              english: { type: "string", description: "A short English meaning." },
              example: { type: "string", description: "A short German example sentence." },
            },
            required: ["german", "english"],
          },
        },
      },
      required: ["words"],
    },
  },
];

const searchArgs = z.object({ query: z.string().trim().min(1).max(200) });
const noteArgs = z.object({ title: z.string().trim().max(80).optional(), text: z.string().trim().min(1).max(MAX_NOTE_CHARS) });

export type NoteProposal = { title: string; text: string };
const wordsArgs = z.object({ words: z.array(z.unknown()).min(1).max(MAX_PROPOSED_WORDS) });
export type ToolCallData = { name: "search_notes"; query: string } | { name: "add_note"; note: NoteProposal } | { name: "add_words"; words: WordDraft[] };
export type Validated = { ok: true; call: ToolCallData } | { ok: false; error: string };

const why = (e: z.ZodError) => e.issues.slice(0, 3).map((i) => `${i.path.join(".") || "arguments"}: ${i.message}`).join("; ");

/** Parses the argument text of a tool call: a JSON object, or null for anything else. Empty text means no arguments. */
export function parseArguments(raw: string | undefined): Record<string, unknown> | null {
  if (!raw || !raw.trim()) return {};
  try {
    const v: unknown = JSON.parse(raw);
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Checks one tool call from the model. Nothing reaches the database or the screen without passing this. */
export function validateToolCall(name: string, args: Record<string, unknown>): Validated {
  if (name === "search_notes") {
    const r = searchArgs.safeParse(args);
    return r.success ? { ok: true, call: { name, query: r.data.query } } : { ok: false, error: why(r.error) };
  }
  if (name === "add_note") {
    const r = noteArgs.safeParse(args);
    if (!r.success) return { ok: false, error: why(r.error) };
    return { ok: true, call: { name, note: { title: r.data.title || "My note", text: r.data.text } } };
  }
  if (name === "add_words") {
    const r = wordsArgs.safeParse(args);
    if (!r.success) return { ok: false, error: why(r.error) };
    const words = r.data.words.map(cleanWord).filter((w): w is WordDraft => w !== null);
    return words.length ? { ok: true, call: { name, words } } : { ok: false, error: "None of the words had both a German word and an English meaning." };
  }
  return { ok: false, error: `Unknown tool "${name.slice(0, 40)}".` };
}

/** A note typed by the person or confirmed from a proposal: a title and some text, trimmed and cut to size, or null when there is no text. */
export function cleanNote(value: unknown): NoteProposal | null {
  const o = value as Record<string, unknown> | null;
  if (!o || typeof o["text"] !== "string") return null;
  const text = o["text"].trim().slice(0, MAX_NOTE_CHARS);
  if (!text) return null;
  const title = typeof o["title"] === "string" ? o["title"].trim().slice(0, 80) : "";
  return { title: title || "My note", text };
}

/** Where a passage comes from, as text: "Goethe-Zertifikat_B1_Wortliste.pdf, p. 12" or "German Grammar Guide.txt, 3. Verb position". */
export function whereFrom(p: Pick<Passage, "source" | "page" | "section">): string {
  return `${p.source}${p.page ? `, p. ${p.page}` : ""}${!p.page && p.section ? `, ${p.section}` : ""}`;
}

/** Numbered passages as the model sees them. `start` is the number of the first one. */
export function formatPassages(passages: readonly Passage[], start = 1): string {
  if (!passages.length) return "(nothing found)";
  return passages.map((p, i) => `[${start + i}] (${whereFrom(p)}${p.kind === "note" ? ", your note" : ""})\n${p.content.slice(0, MAX_PASSAGE_CHARS)}`).join("\n\n");
}

/** The context message: passages for the person's latest question. */
export function contextPrompt(passages: readonly Passage[]): string {
  return `Passages from my library for my latest question:\n${formatPassages(passages)}`;
}

/** The numbers cited in an answer, like [2] or [1][3] or [1, 3], in the order they first appear. */
export function citedNumbers(reply: string): number[] {
  const seen: number[] = [];
  for (const group of reply.matchAll(/\[(\d{1,2}(?:\s*,\s*\d{1,2})*)\]/g)) {
    for (const n of (group[1] ?? "").split(",")) {
      const v = Number(n.trim());
      if (v > 0 && !seen.includes(v)) seen.push(v);
    }
  }
  return seen;
}
