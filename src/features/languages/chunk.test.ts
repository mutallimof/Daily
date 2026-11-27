import { describe, expect, it } from "vitest";
import { MAX_CHUNK_CHARS, chunkPage, chunkText, cleanText, embedText, headingOf, packLines } from "./chunk";

describe("cleanText", () => {
  it("normalizes line endings, trailing spaces and blank runs", () => {
    expect(cleanText("a  \r\nb\r\n\r\n\r\n\r\nc \n")).toBe("a\nb\n\nc");
  });
});

describe("packLines", () => {
  it("joins lines up to the limit and starts a new piece after that", () => {
    expect(packLines(["aaaa", "bbbb", "cccc"], 9)).toEqual(["aaaa\nbbbb", "cccc"]);
  });
  it("skips empty lines and cuts a line that is too long at a space", () => {
    const out = packLines(["", "one two three four", "  "], 10);
    expect(out.every((p) => p.length <= 10)).toBe(true);
    expect(out.join(" ")).toBe("one two three four".replace(/\s+/g, " "));
  });
  it("never returns a piece longer than the limit", () => {
    const out = packLines(["x".repeat(2500), "word ".repeat(300)], MAX_CHUNK_CHARS);
    expect(Math.max(...out.map((p) => p.length))).toBeLessThanOrEqual(MAX_CHUNK_CHARS);
  });
});

describe("chunkPage", () => {
  it("keeps the page number on every piece and never crosses a page", () => {
    const text = Array.from({ length: 80 }, (_, i) => `Wort${i} | word ${i}`).join("\n");
    const chunks = chunkPage(text, "list.pdf", 7);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((c) => c.page === 7 && c.source === "list.pdf" && c.section === null)).toBe(true);
    expect(chunks.map((c) => c.content).join("\n")).toContain("Wort79 | word 79");
  });
  it("returns nothing for a page without text", () => {
    expect(chunkPage("  \n \n", "x.pdf", 1)).toEqual([]);
  });
});

describe("headingOf", () => {
  it("accepts numbered and markdown headings only", () => {
    expect(headingOf("3. Verb position (main clause)")).toBe("3. Verb position (main clause)");
    expect(headingOf("## Passiv")).toBe("Passiv");
    expect(headingOf("Ich habe 3. Versuche gemacht")).toBeNull();
    expect(headingOf("Rule: the case shows the job")).toBeNull();
  });
});

describe("chunkText", () => {
  const text = ["Guide", "1. Cases", "Rule: Nominativ is the subject.", "Examples:\nDer Koch schneidet den Salat.", "2. Prepositions", "Akk: durch, für"].join("\n\n");
  it("gives each piece the heading above it and starts a new piece at a heading", () => {
    const chunks = chunkText(text, "guide.txt");
    const cases = chunks.find((c) => c.content.includes("Nominativ"));
    const prep = chunks.find((c) => c.content.includes("durch"));
    expect(cases?.section).toBe("1. Cases");
    expect(prep?.section).toBe("2. Prepositions");
    expect(cases?.content).not.toContain("durch");
    expect(chunks[0]?.section).toBeNull();
  });
  it("splits a long section into several pieces that keep the heading", () => {
    const long = ["1. Long", ...Array.from({ length: 30 }, (_, i) => `Satz ${i}: ${"wort ".repeat(30)}`)].join("\n\n");
    const chunks = chunkText(long, "g.txt", 500);
    expect(chunks.length).toBeGreaterThan(2);
    expect(chunks.every((c) => c.section === "1. Long" && c.content.length <= 500)).toBe(true);
  });
  it("loses no text", () => {
    const words = (s: string) => s.split(/\s+/).filter(Boolean).join(" ");
    expect(words(chunkText(text, "g.txt").map((c) => c.content).join(" "))).toBe(words(text));
  });
});

describe("embedText", () => {
  it("adds the document name and section to the piece", () => {
    expect(embedText({ source: "Goethe-Zertifikat_B1_Wortliste.pdf", page: 3, section: null, content: "Teig" })).toBe("Goethe Zertifikat B1 Wortliste\nTeig");
    expect(embedText({ source: "g.txt", page: null, section: "1. Cases", content: "Rule" })).toBe("g - 1. Cases\nRule");
  });
});
