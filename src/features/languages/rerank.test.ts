import { describe, expect, it, vi } from "vitest";
import { parseRanking, rerankPassages, rerankPrompt, searchReranked } from "./rerank";
import type { Passage, SearchClient } from "./search";

const p = (n: number): Passage => ({ id: `id${n}`, kind: "material", source: "a.pdf", page: n, section: null, content: `passage ${n}`, similarity: null, score: 1 / n });
const pool = (n: number) => Array.from({ length: n }, (_, i) => p(i + 1));

describe("parseRanking", () => {
  it("reads a JSON array, even inside prose or a code fence", () => {
    expect(parseRanking("[3,1,2]", 5, 5)).toEqual([3, 1, 2]);
    expect(parseRanking("Best: ```json\n[2, 4]\n```", 5, 5)).toEqual([2, 4]);
  });
  it("drops out-of-range numbers, repeats and non-numbers, and caps at keep", () => {
    expect(parseRanking("[9,2,2,0,1.5,\"3\",1]", 5, 5)).toEqual([2, 1]);
    expect(parseRanking("[1,2,3,4]", 5, 2)).toEqual([1, 2]);
  });
  it("gives nothing for nonsense", () => {
    expect(parseRanking("no idea", 5, 5)).toEqual([]);
    expect(parseRanking("[oops", 5, 5)).toEqual([]);
  });
});

describe("rerankPrompt", () => {
  it("numbers the passages and shortens long ones", () => {
    const text = rerankPrompt("Was ist Teig?", [{ source: "a.pdf", section: "Küche", content: "x".repeat(2000) }], 3);
    expect(text).toContain("[1] (a.pdf, Küche)");
    expect(text.length).toBeLessThan(1000);
  });
});

describe("rerankPassages", () => {
  it("puts the model's picks first, then the rest in search order", async () => {
    const out = await rerankPassages(async () => "[4,2]", "q", pool(6), 4);
    expect(out.map((x) => x.page)).toEqual([4, 2, 1, 3]);
  });
  it("keeps the search order when the model fails or answers nonsense", async () => {
    const onError = vi.fn();
    expect((await rerankPassages(async () => { throw new Error("quota"); }, "q", pool(4), 3, onError)).map((x) => x.page)).toEqual([1, 2, 3]);
    expect(onError).toHaveBeenCalledOnce();
    expect((await rerankPassages(async () => "hmm", "q", pool(4), 3)).map((x) => x.page)).toEqual([1, 2, 3]);
  });
  it("does not call the model for one passage", async () => {
    const ask = vi.fn();
    expect(await rerankPassages(ask, "q", pool(1))).toHaveLength(1);
    expect(ask).not.toHaveBeenCalled();
  });
});

describe("searchReranked", () => {
  it("searches 15 candidates and keeps the re-ranked top", async () => {
    const rpc = vi.fn(async (_fn: string, args: { match_count: number }) => ({
      data: pool(args.match_count).map((x) => ({ id: x.id, kind: "material", source: x.source, page: x.page, section: null, content: x.content, similarity: null, score: x.score })),
      error: null,
    }));
    const out = await searchReranked({ rpc } as unknown as SearchClient, async () => { throw new Error("no vectors"); }, async () => "[9,8]", "frage", 3);
    expect(rpc.mock.calls[0]![1].match_count).toBe(15);
    expect(out.map((x) => x.page)).toEqual([9, 8, 1]);
  });
});
