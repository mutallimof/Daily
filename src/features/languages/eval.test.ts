import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { answers, firstHit, summarize, type EvalCase } from "./eval";

const c: EvalCase = { q: "What does Teig mean?", any: ["Teig", "dough"], source: "Work" };

describe("answers and firstHit", () => {
  it("needs a matching word and, when given, a matching file", () => {
    expect(answers({ content: "der Teig | dough", source: "Work vocabulary.txt" }, c)).toBe(true);
    expect(answers({ content: "DER TEIG", source: "work.txt" }, c)).toBe(true);
    expect(answers({ content: "der Teig", source: "Goethe.pdf" }, c)).toBe(false);
    expect(answers({ content: "der Ofen", source: "Work.txt" }, c)).toBe(false);
  });
  it("gives the rank of the first answering passage", () => {
    const list = [{ content: "x", source: "Work" }, { content: "dough", source: "Work" }];
    expect(firstHit(list, c)).toBe(2);
    expect(firstHit([], c)).toBeNull();
  });
});

describe("summarize", () => {
  it("counts hit@k and lists the questions not found in the top ranks", () => {
    const cases: EvalCase[] = [{ q: "a", any: ["a"] }, { q: "b", any: ["b"] }, { q: "c", any: ["c"] }, { q: "d", any: ["d"] }];
    const s = summarize(cases, [1, 3, 9, null]);
    expect(s.hitAt).toEqual({ 1: 1, 3: 2, 5: 2 });
    expect(s.rate[5]).toBe(0.5);
    expect(s.misses).toEqual(["c", "d"]);
  });
});

describe("the evaluation questions", () => {
  const cases = JSON.parse(readFileSync(join(process.cwd(), "src/features/languages/eval/cases.json"), "utf8")) as EvalCase[];
  it("are 25 well-formed, distinct questions", () => {
    expect(cases).toHaveLength(25);
    expect(new Set(cases.map((x) => x.q)).size).toBe(25);
    expect(cases.every((x) => x.q.endsWith("?") && x.any.length > 0 && x.any.every((w) => w.trim()))).toBe(true);
  });
});
