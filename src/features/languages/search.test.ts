import { describe, expect, it, vi } from "vitest";
import { keywordQuery, searchLibrary, toPassage, vectorText, type SearchClient } from "./search";

const row = { id: "a", kind: "material", source: "g.txt", page: null, section: "1. Cases", content: "Dativ", similarity: 0.8, score: 0.03 };

describe("keywordQuery", () => {
  it("keeps words of three letters or more, lower-cased, without repeats", () => {
    expect(keywordQuery("When do I use Dativ, and when Akkusativ? Dativ!")).toBe("when use dativ and akkusativ");
  });
  it("keeps umlauts and ß and drops numbers and symbols", () => {
    expect(keywordQuery("Was ist würde? Straße 123 !!")).toBe("was ist würde straße");
  });
  it("uses at most 12 words", () => {
    expect(keywordQuery("aaa bbb ccc ddd eee fff ggg hhh iii jjj kkk lll mmm nnn").split(" ")).toHaveLength(12);
  });
});

describe("vectorText", () => {
  it("writes the vector the way pgvector reads it", () => {
    expect(vectorText([0.5, -1, 2])).toBe("[0.5,-1,2]");
  });
});

describe("toPassage", () => {
  it("reads a row and defaults the optional parts", () => {
    expect(toPassage(row)).toMatchObject({ id: "a", kind: "material", page: null, section: "1. Cases", similarity: 0.8 });
    expect(toPassage({ id: "b", source: "s", content: "c", kind: "note" })).toMatchObject({ kind: "note", page: null, similarity: null, score: 0 });
  });
  it("rejects anything not shaped like a row", () => {
    expect(toPassage(null)).toBeNull();
    expect(toPassage({ id: 1, source: "s", content: "c" })).toBeNull();
    expect(toPassage({ id: "x", content: "c" })).toBeNull();
  });
});

function client(data: unknown, error: { message: string } | null = null) {
  const rpc = vi.fn(async (_fn: "search_language", _args: { query_embedding: string | null; query_text: string; match_count: number }) => ({ data, error }));
  return { rpc, client: { rpc } as SearchClient };
}

describe("searchLibrary", () => {
  it("sends the vector and the keywords, and returns the passages", async () => {
    const c = client([row, { nonsense: true }]);
    const out = await searchLibrary(c.client, async () => [1, 2], "When do I use Dativ?", 4);
    expect(c.rpc).toHaveBeenCalledWith("search_language", { query_embedding: "[1,2]", query_text: "when use dativ", match_count: 4 });
    expect(out.map((p) => p.id)).toEqual(["a"]);
  });
  it("falls back to keywords only when the embedding fails, and reports why", async () => {
    const c = client([row]);
    const seen = vi.fn();
    const out = await searchLibrary(c.client, async () => Promise.reject(new Error("no key")), "Dativ", 6, seen);
    expect(c.rpc.mock.calls[0]?.[1].query_embedding).toBeNull();
    expect(seen).toHaveBeenCalledOnce();
    expect(out).toHaveLength(1);
  });
  it("does nothing for an empty question", async () => {
    const c = client([row]);
    expect(await searchLibrary(c.client, async () => [1], "   ")).toEqual([]);
    expect(c.rpc).not.toHaveBeenCalled();
  });
  it("throws the database's message when the search fails", async () => {
    await expect(searchLibrary(client(null, { message: "function search_language does not exist" }).client, async () => [1], "Dativ")).rejects.toThrow(/search_language/);
  });
});
