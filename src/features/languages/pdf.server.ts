// Reads the text of a PDF page by page. Used by the ingest script (Node), never by the browser.
import { readFile } from "node:fs/promises";

type Item = { str: string; transform: number[]; width: number };

type Row = { y: number; parts: { x: number; end: number; s: string }[] };

/** One block of items as lines: items at the same height form a line; a wide gap becomes " | " (a table column). */
function blockLines(items: readonly Item[]): string[] {
  const rows: Row[] = [];
  for (const it of items) {
    if (!it.str.trim()) continue;
    const x = it.transform[4] ?? 0;
    const y = it.transform[5] ?? 0;
    let row = rows.find((r) => Math.abs(r.y - y) < 3);
    if (!row) rows.push((row = { y, parts: [] }));
    row.parts.push({ x, end: x + (it.width || 0), s: it.str.trim() });
  }
  rows.sort((a, b) => b.y - a.y);
  const out: string[] = [];
  let prevY: number | null = null;
  for (const r of rows) {
    r.parts.sort((a, b) => a.x - b.x);
    let line = "";
    let prevEnd = -Infinity;
    for (const p of r.parts) {
      if (line) line += p.x - prevEnd > 10 ? " | " : " ";
      line += p.s;
      prevEnd = p.end;
    }
    // A bigger vertical gap than a normal line break starts a new entry: keep it as a blank line.
    if (prevY !== null && prevY - r.y > 18) out.push("");
    out.push(line);
    prevY = r.y;
  }
  return out;
}

/**
 * Where a page with two text columns (one per half, like the Goethe word lists) splits: an empty vertical strip in the
 * middle of the page that no text crosses. Null for single-column pages and for tables that merely have a gap there.
 */
export function columnSplit(items: readonly Item[], pageWidth: number, pageHeight = Infinity): number | null {
  const xs = items.filter((i) => i.str.trim());
  if (xs.length < 30 || pageWidth <= 0 || pageHeight < pageWidth) return null; // wide pages are tables, not two text columns
  const lo = pageWidth * 0.44;
  const hi = pageWidth * 0.56;
  const free: number[] = [];
  for (let s = lo; s <= hi; s += 2) {
    if (!xs.some((i) => (i.transform[4] ?? 0) < s && (i.transform[4] ?? 0) + (i.width || 0) > s)) free.push(s);
  }
  if (free.length < 4) return null; // strip narrower than ~8 points
  const mid = free[Math.floor(free.length / 2)]!;
  const left = xs.filter((i) => (i.transform[4] ?? 0) < mid).length;
  const share = left / xs.length;
  if (share < 0.25 || share > 0.75) return null;
  // Two independent columns have their lines at different heights; a table has almost every row on both sides.
  const side = (a: Item[], b: Item[]) => a.filter((i) => b.some((j) => Math.abs((j.transform[5] ?? 0) - (i.transform[5] ?? 0)) < 3)).length / Math.max(a.length, 1);
  const l = xs.filter((i) => (i.transform[4] ?? 0) < mid);
  const r = xs.filter((i) => (i.transform[4] ?? 0) >= mid);
  return (side(l, r) + side(r, l)) / 2 < 0.85 ? mid : null;
}

/** Puts text items back into lines; a page with two columns is read left column first, then the right one. */
export function itemsToLines(items: readonly Item[], pageWidth = 0, pageHeight = Infinity): string[] {
  const split = columnSplit(items, pageWidth, pageHeight);
  if (split === null) return blockLines(items);
  const left = items.filter((i) => (i.transform[4] ?? 0) < split);
  const right = items.filter((i) => (i.transform[4] ?? 0) >= split);
  return [...blockLines(left), "", ...blockLines(right)];
}

/** The text of every page, in order (page 1 is index 0). A page without text comes back empty. */
export async function pdfPages(path: string): Promise<string[]> {
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const data = new Uint8Array(await readFile(path));
  const task = getDocument({ data, useSystemFonts: true, verbosity: 0 });
  const doc = await task.promise;
  const pages: string[] = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const vp = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    pages.push(itemsToLines(content.items as Item[], vp.width, vp.height).join("\n"));
    page.cleanup();
  }
  await task.destroy();
  return pages;
}
