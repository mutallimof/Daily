import { describe, expect, it } from "vitest";
import { MAX_NOTE_CHARS, MAX_TURNS, citedNumbers, cleanNote, cleanTurns, formatPassages, parseArguments, validateToolCall, whereFrom } from "./chat";
import type { Passage } from "./search";

const p = (over: Partial<Passage> = {}): Passage => ({ id: "1", kind: "material", source: "Guide.txt", page: null, section: "1. Cases", content: "Rule", similarity: null, score: 0, ...over });

describe("cleanTurns", () => {
  it("keeps well-formed turns, the latest few, starting with the user", () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ role: i % 2 ? "assistant" : "user", content: `m${i}` }));
    const out = cleanTurns([{ role: "system", content: "x" }, { role: "user" }, null, ...many]);
    expect(out.length).toBeLessThanOrEqual(MAX_TURNS);
    expect(out[0]?.role).toBe("user");
    expect(out.at(-1)?.content).toBe("m19");
  });
  it("trims and cuts long turns, and returns nothing for junk", () => {
    expect(cleanTurns([{ role: "user", content: `  ${"a".repeat(5000)} ` }])[0]?.content).toHaveLength(1000);
    expect(cleanTurns("nope")).toEqual([]);
  });
});

describe("validateToolCall", () => {
  it("accepts a search and a note", () => {
    expect(validateToolCall("search_notes", { query: " dativ " })).toEqual({ ok: true, call: { name: "search_notes", query: "dativ" } });
    expect(validateToolCall("add_note", { text: "x" })).toEqual({ ok: true, call: { name: "add_note", note: { title: "My note", text: "x" } } });
  });
  it("accepts words, cleans them and drops the ones without both languages", () => {
    const ok = validateToolCall("add_words", { words: [{ german: "das Blech", english: "tray" }, { german: "Ofen" }] });
    expect(ok).toEqual({ ok: true, call: { name: "add_words", words: [{ german: "Blech", article: "das", plural: null, english: "tray", example: null }] } });
    expect(validateToolCall("add_words", { words: [{ german: "Ofen" }] }).ok).toBe(false);
    expect(validateToolCall("add_words", { words: [] }).ok).toBe(false);
    expect(validateToolCall("add_words", { words: Array.from({ length: 11 }, () => ({ german: "a", english: "b" })) }).ok).toBe(false);
  });
  it("rejects bad arguments and unknown tools", () => {
    expect(validateToolCall("search_notes", {}).ok).toBe(false);
    expect(validateToolCall("add_note", { text: "x".repeat(MAX_NOTE_CHARS + 1) }).ok).toBe(false);
    expect(validateToolCall("delete_everything", {})).toMatchObject({ ok: false });
  });
});

describe("parseArguments", () => {
  it("reads a JSON object, treats empty as no arguments, rejects the rest", () => {
    expect(parseArguments('{"a":1}')).toEqual({ a: 1 });
    expect(parseArguments("")).toEqual({});
    expect(parseArguments("[1]")).toBeNull();
    expect(parseArguments("{oops")).toBeNull();
  });
});

describe("cleanNote", () => {
  it("trims, cuts to size and names an untitled note", () => {
    expect(cleanNote({ text: "  hello " })).toEqual({ title: "My note", text: "hello" });
    expect(cleanNote({ title: "T".repeat(200), text: "x".repeat(2000) })).toMatchObject({ text: "x".repeat(MAX_NOTE_CHARS) });
    expect(cleanNote({ text: "   " })).toBeNull();
    expect(cleanNote(null)).toBeNull();
  });
});

describe("whereFrom and formatPassages", () => {
  it("names the page for a PDF and the section for a text file", () => {
    expect(whereFrom(p({ source: "list.pdf", page: 12, section: null }))).toBe("list.pdf, p. 12");
    expect(whereFrom(p())).toBe("Guide.txt, 1. Cases");
  });
  it("numbers passages from the given start and marks notes", () => {
    const text = formatPassages([p({ id: "a" }), p({ id: "b", kind: "note", source: "wurde", section: null })], 3);
    expect(text).toContain("[3] (Guide.txt, 1. Cases)");
    expect(text).toContain("[4] (wurde, your note)");
    expect(formatPassages([])).toBe("(nothing found)");
  });
});

describe("citedNumbers", () => {
  it("finds single, adjacent and comma-separated marks once each, in order", () => {
    expect(citedNumbers("A [2]. B [1][3] and [2, 4].")).toEqual([2, 1, 3, 4]);
    expect(citedNumbers("no marks, [0] and [a]")).toEqual([]);
  });
});
