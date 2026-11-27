import { describe, expect, it } from "vitest";
import { encodeEvent, parseEvent, readEvents, type LangEvent } from "./stream";

const done: LangEvent = { type: "done", reply: "Hi [1]", citations: [{ n: 1, id: "a", kind: "material", source: "g.txt", page: null, section: "1. Cases", snippet: "x" }], grounded: true, proposal: { title: "t", text: "x" }, words: [{ german: "Teig", article: "der", plural: null, english: "dough", example: null }] };

const bodyOf = (chunks: string[]) =>
  new ReadableStream<Uint8Array>({
    start(c) {
      for (const s of chunks) c.enqueue(new TextEncoder().encode(s));
      c.close();
    },
  });

describe("events", () => {
  it("round-trips an event and ignores junk lines", () => {
    expect(parseEvent(encodeEvent(done).trim())).toEqual(done);
    expect(parseEvent("not json")).toBeNull();
    expect(parseEvent('{"type":"done","reply":5}')).toBeNull();
    expect(parseEvent('{"type":"text","delta":"x"}')).toEqual({ type: "text", delta: "x" });
  });
  it("reads events however the bytes are split", async () => {
    const wire = encodeEvent({ type: "text", delta: "Hal" }) + encodeEvent(done);
    const got: LangEvent[] = [];
    await readEvents(bodyOf([wire.slice(0, 7), wire.slice(7, 40), wire.slice(40)]), (e) => got.push(e));
    expect(got.map((e) => e.type)).toEqual(["text", "done"]);
  });
  it("reports a stream that ends without done or error", async () => {
    const got: LangEvent[] = [];
    await readEvents(bodyOf([encodeEvent({ type: "text", delta: "Hal" })]), (e) => got.push(e));
    expect(got.at(-1)).toMatchObject({ type: "error" });
  });
});
