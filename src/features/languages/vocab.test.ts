import { describe, expect, it } from "vitest";
import { addDays, cleanWord, displayWord, isDue, localDay, newWords, review, shuffle } from "./vocab";

describe("cleanWord", () => {
  it("tidies a word and keeps the optional parts", () => {
    expect(cleanWord({ german: "  Teig ", article: "DER", english: " dough ", plural: "Teige", example: "Der Teig ruht." })).toEqual({
      german: "Teig",
      article: "der",
      plural: "Teige",
      english: "dough",
      example: "Der Teig ruht.",
    });
  });
  it("moves a leading article out of the German", () => {
    expect(cleanWord({ german: "die Hefe", english: "yeast" })).toMatchObject({ german: "Hefe", article: "die" });
    expect(cleanWord({ german: "das  Blech", article: "der", english: "tray" })).toMatchObject({ german: "Blech", article: "das" });
  });
  it("ignores a bad article and empty optional parts", () => {
    expect(cleanWord({ german: "backen", article: "ein", english: "to bake", plural: " ", example: "" })).toEqual({ german: "backen", article: null, plural: null, english: "to bake", example: null });
  });
  it("cuts long values and rejects words without German or English", () => {
    expect(cleanWord({ german: "x".repeat(200), english: "y" })?.german).toHaveLength(80);
    expect(cleanWord({ german: "Teig" })).toBeNull();
    expect(cleanWord({ german: "  ", english: "dough" })).toBeNull();
    expect(cleanWord(null)).toBeNull();
    expect(cleanWord("Teig")).toBeNull();
  });
});

describe("displayWord and newWords", () => {
  it("shows the article when there is one", () => {
    expect(displayWord({ german: "Teig", article: "der" })).toBe("der Teig");
    expect(displayWord({ german: "backen", article: null })).toBe("backen");
  });
  it("skips words already saved or repeated in the batch, ignoring letter case", () => {
    const d = (german: string) => ({ german, article: null, plural: null, english: "x", example: null });
    const out = newWords([d("Teig"), d("teig"), d("Hefe"), d("Mehl")], ["hefe"]);
    expect(out.fresh.map((w) => w.german)).toEqual(["Teig", "Mehl"]);
    expect(out.skipped).toBe(2);
  });
});

describe("review", () => {
  it("moves a known word up a box and sets the next day", () => {
    expect(review(1, true, "2026-11-27")).toEqual({ box: 2, due: "2026-11-29" });
    expect(review(3, true, "2026-11-27")).toEqual({ box: 4, due: "2026-12-05" });
  });
  it("stops at the top box", () => {
    expect(review(5, true, "2026-11-27")).toEqual({ box: 5, due: "2026-12-13" });
  });
  it("sends a missed word back to box 1, due today", () => {
    expect(review(4, false, "2026-11-27")).toEqual({ box: 1, due: "2026-11-27" });
  });
  it("copes with a box outside 1 to 5", () => {
    expect(review(0, true, "2026-11-27").box).toBe(2);
    expect(review(99, true, "2026-11-27").box).toBe(5);
  });
});

describe("dates", () => {
  it("adds days across month and year ends", () => {
    expect(addDays("2026-12-30", 3)).toBe("2027-01-02");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
  });
  it("a word is due on or before today", () => {
    expect(isDue({ due: "2026-11-27" }, "2026-11-27")).toBe(true);
    expect(isDue({ due: "2026-11-28" }, "2026-11-27")).toBe(false);
  });
  it("writes the local day with leading zeros", () => {
    expect(localDay(new Date(2026, 0, 5, 23, 59))).toBe("2026-01-05");
  });
});

describe("shuffle", () => {
  it("keeps every item and does not change the original", () => {
    const src = [1, 2, 3, 4, 5];
    const out = shuffle(src, () => 0.3);
    expect(out.sort()).toEqual(src);
    expect(src).toEqual([1, 2, 3, 4, 5]);
  });
});
