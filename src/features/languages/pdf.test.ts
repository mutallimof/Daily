import { describe, expect, it } from "vitest";
import { columnSplit, itemsToLines } from "./pdf.server";

const item = (str: string, x: number, y: number, width = 60) => ({ str, transform: [1, 0, 0, 1, x, y], width });

/** A portrait page like the Goethe lists: a headword and its example in each half, the halves at different heights. */
function twoHalves() {
  const items = [];
  for (let i = 0; i < 12; i++) {
    items.push(item(`links${i}`, 35, 700 - i * 40), item(`Beispiel links ${i}`, 110, 700 - i * 40, 120));
    items.push(item(`rechts${i}`, 315, 690 - i * 37), item(`Beispiel rechts ${i}`, 390, 690 - i * 37, 120));
  }
  return items;
}

describe("columnSplit", () => {
  it("finds the gap between two halves of a portrait page", () => {
    const s = columnSplit(twoHalves(), 595, 842);
    expect(s).toBeGreaterThan(240);
    expect(s).toBeLessThan(310);
  });
  it("leaves wide pages (tables) alone", () => {
    expect(columnSplit(twoHalves(), 842, 595)).toBeNull();
  });
  it("leaves a table whose rows line up on both sides alone", () => {
    const rows = [];
    for (let i = 0; i < 14; i++) rows.push(item(`Wort${i}`, 35, 700 - i * 40), item(`word${i}`, 315, 700 - i * 40));
    expect(columnSplit(rows, 595, 842)).toBeNull();
  });
  it("leaves a page with text running across the middle alone", () => {
    const rows = twoHalves();
    rows.push(item("Ein langer Satz über beide Hälften der Seite", 100, 760, 400));
    expect(columnSplit(rows, 595, 842)).toBeNull();
  });
});

describe("itemsToLines", () => {
  it("reads the left half first, then the right half, each entry on its own line", () => {
    const lines = itemsToLines(twoHalves(), 595, 842).filter(Boolean);
    expect(lines[0]).toBe("links0 | Beispiel links 0");
    expect(lines[11]).toBe("links11 | Beispiel links 11");
    expect(lines[12]).toBe("rechts0 | Beispiel rechts 0");
  });
  it("without a page size behaves as before: one line per height", () => {
    const lines = itemsToLines([item("der", 10, 100, 20), item("Tisch", 34, 100, 30), item("table", 200, 100, 30)]);
    expect(lines).toEqual(["der Tisch | table"]);
  });
  it("marks a bigger vertical gap with a blank line", () => {
    expect(itemsToLines([item("a", 10, 100), item("b", 10, 89), item("c", 10, 40)])).toEqual(["a", "b", "", "c"]);
  });
});
