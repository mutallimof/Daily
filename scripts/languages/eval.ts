// Measures how well the library search finds the right passage, on the 25 questions in
// src/features/languages/eval/cases.json (edit them to match your own material).
//
//   npm run languages:eval
//
// Compares keyword-only search with the real hybrid search (meaning + keyword), so you can see what the vectors add.
// Needs the same settings as languages:ingest (it asks for your Lifeplan login). Reads only; changes nothing.
import { readFile } from "node:fs/promises";
import { complete, embed } from "../../src/features/gym/ai-provider.server";
import { firstHit, summarize, type EvalCase } from "../../src/features/languages/eval";
import { rerankPassages, RERANK_POOL } from "../../src/features/languages/rerank";
import { searchLibrary, type SearchClient } from "../../src/features/languages/search";
import { signIn } from "./login";

const cases = JSON.parse(await readFile(new URL("../../src/features/languages/eval/cases.json", import.meta.url), "utf8")) as EvalCase[];
const { supabase } = await signIn();
const client = supabase as unknown as SearchClient;
const K = 5;

type Mode = "keyword" | "hybrid" | "rerank";
const askModel = async (prompt: string) => (await complete([{ role: "user", content: prompt }])).text;

async function run(label: string, mode: Mode) {
  const ranks: (number | null)[] = [];
  let fallbacks = 0; // questions whose search quietly fell back to keywords or to the search order
  for (const c of cases) {
    const embedQuery = async (t: string) => {
      if (mode === "keyword") throw new Error("keyword only");
      return (await embed([t]))[0] ?? [];
    };
    const onError = () => { if (mode !== "keyword") fallbacks++; };
    let found = await searchLibrary(client, embedQuery, c.q, mode === "rerank" ? RERANK_POOL : K, onError);
    if (mode === "rerank") found = await rerankPassages(askModel, c.q, found, K, onError);
    ranks.push(firstHit(found, c));
    await new Promise((r) => setTimeout(r, mode === "keyword" ? 0 : 700)); // stay under free-tier request limits
  }
  const s = summarize(cases, ranks);
  const pct = (k: number) => `${s.hitAt[k]}/${s.total} (${Math.round((s.rate[k] ?? 0) * 100)}%)`;
  const note = fallbacks ? `   NOT VALID: ${fallbacks} step(s) failed and fell back (quota?). Run again later.` : "";
  console.log(`${label.padEnd(14)} hit@1 ${pct(1)}   hit@3 ${pct(3)}   hit@5 ${pct(5)}${note}`);
  return { ...s, fallbacks };
}

const keyword = await run("keyword only", "keyword");
const hybrid = await run("hybrid", "hybrid");
const reranked = await run("hybrid+rerank", "rerank");
if (reranked.misses.length) {
  console.log(`\nNot found in the top ${K} after re-ranking:`);
  for (const q of reranked.misses) console.log(`  - ${q}`);
}
if (hybrid.fallbacks || reranked.fallbacks) {
  console.log("\nSome searches fell back, so the hybrid rows are not a fair result. Do not quote them; run again when the quota has reset.");
} else {
  const diff = (a: number, b: number) => `${b >= a ? "+" : "-"}${Math.abs(b - a)}`;
  console.log(`\nAt hit@5: vectors ${diff(keyword.hitAt[5]!, hybrid.hitAt[5]!)}, re-ranking ${diff(hybrid.hitAt[5]!, reranked.hitAt[5]!)} question(s). At hit@1: re-ranking ${diff(hybrid.hitAt[1]!, reranked.hitAt[1]!)}.`);
}
