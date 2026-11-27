/** A small reader for the few marks the AI uses in answers: **bold**, *italic* and "* " or "- " bullet lines. Nothing else is interpreted, and nothing is ever run as HTML. */

export type Span = { text: string; bold?: boolean; italic?: boolean };
export type Block = { type: "p"; spans: Span[] } | { type: "ul"; items: Span[][] };

/** Splits one line into plain, bold and italic pieces. Unmatched asterisks stay as text. */
export function parseInline(line: string): Span[] {
  const out: Span[] = [];
  let rest = line;
  const mark = /\*\*([^*\n]+?)\*\*|\*([^*\s][^*\n]*?)\*/;
  for (;;) {
    const m = mark.exec(rest);
    if (!m) break;
    if (m.index > 0) out.push({ text: rest.slice(0, m.index) });
    if (m[1] !== undefined) out.push({ text: m[1], bold: true });
    else out.push({ text: m[2] as string, italic: true });
    rest = rest.slice(m.index + m[0].length);
  }
  if (rest) out.push({ text: rest });
  return out.length ? out : [{ text: "" }];
}

/** Paragraphs and bullet lists. A blank line ends a paragraph; consecutive bullet lines form one list. */
export function parseRich(text: string): Block[] {
  const blocks: Block[] = [];
  let para: string[] = [];
  let list: Span[][] | null = null;
  const flushPara = () => {
    if (para.length) blocks.push({ type: "p", spans: parseInline(para.join(" ")) });
    para = [];
  };
  const flushList = () => {
    if (list) blocks.push({ type: "ul", items: list });
    list = null;
  };
  for (const raw of text.replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.trim();
    const bullet = /^[*-]\s+(.+)$/.exec(line);
    if (bullet) {
      flushPara();
      (list ??= []).push(parseInline(bullet[1] as string));
    } else if (!line) {
      flushPara();
      flushList();
    } else {
      flushList();
      para.push(line);
    }
  }
  flushPara();
  flushList();
  return blocks;
}
