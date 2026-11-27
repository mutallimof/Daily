/** The word list: cleaning what is typed or proposed, and when a word comes back for review. */

export const ARTICLES = ["der", "die", "das"] as const;
export type Article = (typeof ARTICLES)[number];

export type WordDraft = { german: string; article: Article | null; plural: string | null; english: string; example: string | null };
export type Word = WordDraft & { id: string; box: number; due: string; created_at: string };

export const MAX_GERMAN = 80;
export const MAX_ENGLISH = 120;
export const MAX_EXAMPLE = 300;
/** Most words one chat answer may propose. */
export const MAX_PROPOSED_WORDS = 10;

const text = (v: unknown, max: number): string | null => {
  if (typeof v !== "string") return null;
  const t = v.replace(/\s+/g, " ").trim().slice(0, max);
  return t || null;
};

/**
 * A word as typed or proposed, made tidy, or null when it has no German or no English. A leading article in the German
 * ("der Teig") moves into `article`; an article given separately must be der, die or das.
 */
export function cleanWord(value: unknown): WordDraft | null {
  const o = value as Record<string, unknown> | null;
  if (!o || typeof o !== "object") return null;
  let german = text(o["german"], MAX_GERMAN);
  const english = text(o["english"], MAX_ENGLISH);
  if (!german || !english) return null;
  let article: Article | null = null;
  const given = typeof o["article"] === "string" ? o["article"].trim().toLowerCase() : "";
  if ((ARTICLES as readonly string[]).includes(given)) article = given as Article;
  const lead = /^(der|die|das)\s+(\S.*)$/i.exec(german);
  if (lead) {
    article = (lead[1] as string).toLowerCase() as Article;
    german = lead[2] as string;
  }
  return { german, article, plural: text(o["plural"], MAX_GERMAN), english, example: text(o["example"], MAX_EXAMPLE) };
}

/** "der Teig", or just "backen" for a word without an article. */
export const displayWord = (w: Pick<WordDraft, "german" | "article">): string => (w.article ? `${w.article} ${w.german}` : w.german);

/** Drops drafts that repeat a word already in the list (or earlier in the same batch), ignoring letter case. */
export function newWords(drafts: readonly WordDraft[], existing: readonly string[]): { fresh: WordDraft[]; skipped: number } {
  const seen = new Set(existing.map((w) => w.toLowerCase()));
  const fresh: WordDraft[] = [];
  for (const d of drafts) {
    const key = d.german.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    fresh.push(d);
  }
  return { fresh, skipped: drafts.length - fresh.length };
}

// ---- Review: five boxes -----------------------------------------------------------------------------------------

/** Days until a word comes back, by the box it is in. A word that was missed is due again today. */
export const BOX_DAYS: Record<number, number> = { 1: 1, 2: 2, 3: 4, 4: 8, 5: 16 };
export const MAX_BOX = 5;

/** `YYYY-MM-DD` plus some days, in UTC (the database column is a plain date). */
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** What happens after a review: knew it, the word moves up a box and waits longer; missed it, back to box 1 and due today. */
export function review(box: number, knew: boolean, today: string): { box: number; due: string } {
  if (!knew) return { box: 1, due: today };
  const next = Math.min(MAX_BOX, Math.max(1, Math.round(box)) + 1);
  return { box: next, due: addDays(today, BOX_DAYS[next] ?? 16) };
}

export const isDue = (w: Pick<Word, "due">, today: string): boolean => w.due <= today;

/** Today as `YYYY-MM-DD` in the person's own time zone (the review day changes at their midnight, not at UTC midnight). */
export function localDay(now: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

/** A shuffled copy (Fisher-Yates). `rand` is injectable for tests. */
export function shuffle<T>(items: readonly T[], rand: () => number = Math.random): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j] as T, a[i] as T];
  }
  return a;
}
