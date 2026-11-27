import type { ChatMessage, ModelReply, ToolDef } from "@/features/gym/ai-provider.server";
import {
  CHAT_TOOLS,
  SYSTEM_PROMPT,
  citedNumbers,
  contextPrompt,
  formatPassages,
  parseArguments,
  validateToolCall,
  type ChatTurn,
  type NoteProposal,
  type ToolCallData,
} from "./chat";
import type { Passage } from "./search";
import { MAX_PROPOSED_WORDS, type WordDraft } from "./vocab";

export type ChatDeps = {
  /** Asks the model. `onText` gets the answer text piece by piece when the provider streams it. */
  complete: (messages: ChatMessage[], tools: ToolDef[], onText?: (delta: string) => void) => Promise<ModelReply>;
  /** Looks something up in the person's library. */
  search: (query: string) => Promise<Passage[]>;
};

export type Citation = {
  /** The number the answer uses, [n]. */
  n: number;
  id: string;
  kind: Passage["kind"];
  source: string;
  page: number | null;
  section: string | null;
  snippet: string;
};

export type ChatOutcome = {
  reply: string;
  /** Only the passages the answer actually cites. */
  citations: Citation[];
  /** True when passages were found for the question; false means the answer is general knowledge. */
  grounded: boolean;
  /** A note the person is asked to confirm; nothing is saved here. */
  proposal: NoteProposal | null;
  /** Words the person is asked to confirm for the vocabulary list; nothing is saved here. */
  words: WordDraft[];
};

export const MAX_STEPS = 5;
export const MAX_LOOKUPS = 3;
export const MAX_BAD_STEPS = 3;
const SNIPPET_CHARS = 240;

/**
 * One chat turn. The library is searched for the person's latest message first and the passages go to the model
 * numbered; the model may look up more (search_notes) or propose a note (add_note). The answer's [n] marks are checked
 * against the passages that were really given: a number that was never given is removed, so a citation can only ever
 * point at something real. Provider failures are thrown for the caller to turn into a short message.
 */
export async function runChat(deps: ChatDeps, history: readonly ChatTurn[], onText?: (delta: string) => void): Promise<ChatOutcome> {
  const question = [...history].reverse().find((t) => t.role === "user")?.content ?? "";
  const given: Passage[] = [];
  const add = (found: readonly Passage[]): { passages: Passage[]; start: number } => {
    const fresh = found.filter((p) => !given.some((g) => g.id === p.id));
    const start = given.length + 1;
    given.push(...fresh);
    return { passages: fresh, start };
  };

  const first = add(await deps.search(question));
  const messages: ChatMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: contextPrompt(first.passages) },
    ...history.map((t): ChatMessage => ({ role: t.role, content: t.content })),
  ];
  let reply = "";
  let proposal: NoteProposal | null = null;
  const words: WordDraft[] = [];
  let lookups = 0;
  let badSteps = 0;
  let gaveUp = false;

  for (let step = 0; step < MAX_STEPS; step++) {
    const res = await deps.complete(messages, CHAT_TOOLS, onText);
    if (!res.toolCalls.length) {
      reply = res.text;
      break;
    }
    messages.push(res.message);
    let bad = false;
    for (const c of res.toolCalls) {
      let result: unknown;
      const args = parseArguments(c.function.arguments);
      const checked = args === null ? null : validateToolCall(c.function.name, args);
      if (!checked || !checked.ok) {
        bad = true;
        result = { error: checked ? checked.error : "Arguments were not a valid JSON object. Call the tool again with valid JSON." };
      } else {
        try {
          result = await execute(checked.call);
        } catch (e) {
          console.error(e);
          result = { error: "That did not work." };
        }
      }
      messages.push({ role: "tool", tool_call_id: c.id, content: typeof result === "string" ? result : JSON.stringify(result) });
    }
    if (bad && ++badSteps >= MAX_BAD_STEPS) {
      gaveUp = true;
      break;
    }
  }

  async function execute(call: ToolCallData): Promise<unknown> {
    if (call.name === "search_notes") {
      if (lookups >= MAX_LOOKUPS) return { error: "No more lookups this turn. Answer from the passages you have." };
      lookups++;
      const more = add(await deps.search(call.query));
      return more.passages.length ? formatPassages(more.passages, more.start) : "(no new passages)";
    }
    if (call.name === "add_words") {
      for (const w of call.words) {
        if (words.length < MAX_PROPOSED_WORDS && !words.some((x) => x.german.toLowerCase() === w.german.toLowerCase())) words.push(w);
      }
      return { ok: true, note: "The person will confirm the words on screen before they are saved." };
    }
    proposal = call.note;
    return { ok: true, note: "The person will confirm on screen before it is saved." };
  }

  // A number that was never given is not a citation: take it out of the text.
  const valid = (n: number) => n >= 1 && n <= given.length;
  const cleaned = reply.replace(/\s?\[(\d{1,2}(?:\s*,\s*\d{1,2})*)\]/g, (whole, group: string) => {
    const nums = group.split(",").map((s) => Number(s.trim()));
    return nums.every(valid) ? whole : nums.filter(valid).length ? ` [${nums.filter(valid).join(", ")}]` : "";
  });
  const citations = citedNumbers(cleaned)
    .filter(valid)
    .map((n): Citation => {
      const p = given[n - 1]!;
      return { n, id: p.id, kind: p.kind, source: p.source, page: p.page, section: p.section, snippet: p.content.replace(/\s+/g, " ").slice(0, SNIPPET_CHARS) };
    });

  let text = cleaned.trim();
  if (!text) {
    if (gaveUp) text = "I couldn't understand the AI's answer — please try again.";
    else if (words.length) text = words.length === 1 ? "Here is a word to keep." : "Here are words to keep.";
    else if (proposal) text = "Here is a note to keep.";
    else text = "I couldn't come up with an answer — try asking another way.";
  }
  return { reply: text, citations, grounded: first.passages.length > 0, proposal, words };
}
