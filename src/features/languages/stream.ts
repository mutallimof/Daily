import type { ChatOutcome } from "./chat-engine";
import { cleanWord, type WordDraft } from "./vocab";

/** What the server sends while the chat answers: pieces of text, then one "done" or one "error". One JSON object per line. */
export type LangEvent = { type: "text"; delta: string } | ({ type: "done" } & ChatOutcome) | { type: "error"; error: string };

export const encodeEvent = (event: LangEvent): string => `${JSON.stringify(event)}\n`;

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** One line of the stream as an event, or null when it is not one (the browser never trusts the stream's shape). */
export function parseEvent(line: string): LangEvent | null {
  let v: unknown;
  try {
    v = JSON.parse(line);
  } catch {
    return null;
  }
  if (!isObject(v)) return null;
  if (v["type"] === "text" && typeof v["delta"] === "string") return { type: "text", delta: v["delta"] };
  if (v["type"] === "error" && typeof v["error"] === "string") return { type: "error", error: v["error"] };
  if (v["type"] === "done" && typeof v["reply"] === "string" && Array.isArray(v["citations"])) {
    const p = v["proposal"];
    return {
      type: "done",
      reply: v["reply"],
      citations: v["citations"] as ChatOutcome["citations"],
      grounded: v["grounded"] === true,
      proposal: isObject(p) && typeof p["text"] === "string" && typeof p["title"] === "string" ? { title: p["title"], text: p["text"] } : null,
      words: Array.isArray(v["words"]) ? v["words"].map(cleanWord).filter((w): w is WordDraft => w !== null) : [],
    };
  }
  return null;
}

/** Reads a chat stream and calls `onEvent` for every complete line as it arrives. A stream that ends without "done" or "error" is reported as an error. */
export async function readEvents(body: ReadableStream<Uint8Array> | null, onEvent: (e: LangEvent) => void): Promise<void> {
  let finished = false;
  const handle = (line: string) => {
    if (!line.trim()) return;
    const event = parseEvent(line);
    if (!event) return;
    if (event.type !== "text") finished = true;
    onEvent(event);
  };
  if (body) {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buffer.indexOf("\n")) >= 0) {
        handle(buffer.slice(0, nl));
        buffer = buffer.slice(nl + 1);
      }
    }
    handle(buffer + decoder.decode());
  }
  if (!finished) onEvent({ type: "error", error: "The AI reply was cut off — please try again." });
}
