/** Scoring the library search: for each question, does a passage that should answer it come back near the top? */
import type { Passage } from "./search";

export type EvalCase = {
  q: string;
  /** A good passage contains at least one of these words (any letter case). */
  any: string[];
  /** And, when given, comes from a file whose name contains this text. */
  source?: string;
};

/** Whether one passage answers the case. */
export function answers(p: Pick<Passage, "content" | "source">, c: EvalCase): boolean {
  const text = p.content.toLowerCase();
  return c.any.some((w) => text.includes(w.toLowerCase())) && (!c.source || p.source.toLowerCase().includes(c.source.toLowerCase()));
}

/** Rank (1 = best) of the first passage that answers the case, or null when none of them does. */
export function firstHit(passages: readonly Pick<Passage, "content" | "source">[], c: EvalCase): number | null {
  const i = passages.findIndex((p) => answers(p, c));
  return i < 0 ? null : i + 1;
}

export type EvalSummary = { total: number; hitAt: Record<number, number>; rate: Record<number, number>; misses: string[] };

/** hit@k for each k: the share of questions with an answering passage among the first k. `ranks` has one rank (or null) per case. */
export function summarize(cases: readonly EvalCase[], ranks: readonly (number | null)[], ks: readonly number[] = [1, 3, 5]): EvalSummary {
  const hitAt: Record<number, number> = {};
  const rate: Record<number, number> = {};
  for (const k of ks) {
    hitAt[k] = ranks.filter((r) => r !== null && r <= k).length;
    rate[k] = cases.length ? hitAt[k] / cases.length : 0;
  }
  const last = Math.max(...ks);
  const misses = cases.filter((_, i) => ranks[i] === null || (ranks[i] as number) > last).map((c) => c.q);
  return { total: cases.length, hitAt, rate, misses };
}
