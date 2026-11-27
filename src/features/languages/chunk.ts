/** Cutting study material into pieces small enough to search, each remembering where it came from. */

export type Chunk = { source: string; page: number | null; section: string | null; content: string };

/** Longest piece, in characters. Word lists are cut by line, grammar notes by paragraph. */
export const MAX_CHUNK_CHARS = 900;

/** Tidies extracted text: one line ending, no trailing spaces, no runs of blank lines. */
export function cleanText(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Joins lines into pieces of at most `limit` characters; a line longer than that is cut at a space. */
export function packLines(lines: readonly string[], limit = MAX_CHUNK_CHARS): string[] {
  const out: string[] = [];
  let cur = "";
  const flush = () => {
    if (cur.trim()) out.push(cur.trim());
    cur = "";
  };
  for (const raw of lines) {
    let line = raw.trim();
    if (!line) continue;
    while (line.length > limit) {
      const cut = line.lastIndexOf(" ", limit);
      const at = cut > limit / 2 ? cut : limit;
      flush();
      out.push(line.slice(0, at).trim());
      line = line.slice(at).trim();
    }
    if (cur && cur.length + line.length + 1 > limit) flush();
    cur = cur ? `${cur}\n${line}` : line;
  }
  flush();
  return out;
}

/** One page of a PDF (a word list, say) as pieces that never cross the page, so a citation always names the right page. */
export function chunkPage(text: string, source: string, page: number, limit = MAX_CHUNK_CHARS): Chunk[] {
  return packLines(cleanText(text).split("\n"), limit).map((content) => ({ source, page, section: null, content }));
}

/** A heading is a numbered title ("3. Verb position") or a markdown title ("## Passiv"). */
export function headingOf(line: string): string | null {
  const t = line.trim();
  const m = /^(?:#{1,4}\s+(.+)|(\d{1,2}\.\s+\S.{0,100}))$/.exec(t);
  const h = m?.[1] ?? m?.[2];
  return h ? h.trim().slice(0, 200) : null;
}

/**
 * Plain notes (a .txt or .md file) as pieces: paragraphs are kept together and merged up to the limit, and each piece
 * remembers the nearest heading above it. A heading starts a new piece.
 */
export function chunkText(text: string, source: string, limit = MAX_CHUNK_CHARS): Chunk[] {
  const out: Chunk[] = [];
  let section: string | null = null;
  let block: string[] = [];
  const flush = () => {
    for (const content of packLines(block, limit)) out.push({ source, page: null, section, content });
    block = [];
  };
  for (const paragraph of cleanText(text).split(/\n{2,}/)) {
    const lines = paragraph.split("\n");
    const heading = headingOf(lines[0] ?? "");
    if (heading) {
      flush();
      section = heading;
      block.push(...lines.slice(1));
      // the paragraph stays together with its heading line in the piece text
      block.unshift(lines[0] ?? "");
      continue;
    }
    const size = block.join("\n").length + paragraph.length;
    if (block.length && size > limit) flush();
    block.push(...lines);
  }
  flush();
  return out;
}

/** The text that is turned into a vector: the document name and section help a short piece to be found. */
export function embedText(c: Chunk): string {
  const label = c.source.replace(/\.[a-z0-9]+$/i, "").replace(/[_-]+/g, " ").trim();
  return `${label}${c.section ? ` - ${c.section}` : ""}\n${c.content}`.slice(0, 2000);
}
