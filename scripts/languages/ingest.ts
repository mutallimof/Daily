// Loads your German study material into your own Lifeplan library (table language_chunks).
//
//   npm run languages:ingest -- "C:\path\to\folder"            load every .pdf, .txt and .md in the folder
//   npm run languages:ingest -- "C:\path\to\folder" --dry      only count the pieces; no network, nothing written
//   npm run languages:ingest -- "C:\path\to\folder" --only B1  only files whose name contains "B1"
//
// You sign in as yourself, so every row belongs to you and no secret key is needed. The script asks for your Lifeplan
// email and password (or reads LANG_EMAIL and LANG_PASSWORD). SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY and AI_API_KEY
// (and AI_* if you do not use Gemini) come from .env.
// Running it again replaces the pieces of each file it reads; other files and your notes are left alone.
import { readdir, readFile } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { AiError, embed } from "../../src/features/gym/ai-provider.server";
import { chunkPage, chunkText, embedText, type Chunk } from "../../src/features/languages/chunk";
import { pdfPages } from "../../src/features/languages/pdf.server";
import { vectorText } from "../../src/features/languages/search";
import { signIn } from "./login";

const EMBED_BATCH = 32;
const INSERT_BATCH = 25;

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const value = (name: string) => args[args.indexOf(name) + 1];
const folder = args.find((a, i) => !a.startsWith("--") && args[i - 1] !== "--only");
const dry = flag("--dry");
const only = flag("--only") ? value("--only")?.toLowerCase() : undefined;

if (!folder) {
  console.error('Usage: npm run languages:ingest -- "<folder>" [--dry] [--only <text>]');
  process.exit(1);
}

async function chunksOf(path: string): Promise<Chunk[]> {
  const source = basename(path);
  if (extname(path).toLowerCase() === ".pdf") {
    const pages = await pdfPages(path);
    return pages.flatMap((text, i) => chunkPage(text, source, i + 1));
  }
  return chunkText(await readFile(path, "utf8"), source);
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Embeds a batch, waiting and trying again when the provider says "too many requests" (free keys have small limits). */
async function embedPatiently(texts: string[]): Promise<number[][]> {
  for (let n = 1; ; n++) {
    try {
      return await embed(texts);
    } catch (e) {
      if (!(e instanceof AiError) || n >= 8 || !/limiting|quota|overloaded|did not answer/i.test(e.message)) throw e;
      console.log(`  waiting 30 s (${e.message.slice(0, 80)}…)`);
      await sleep(30_000);
    }
  }
}

const files = (await readdir(folder))
  .filter((f) => /\.(pdf|txt|md)$/i.test(f) && (!only || f.toLowerCase().includes(only)))
  .sort();
if (!files.length) {
  console.error("No .pdf, .txt or .md files found" + (only ? ` matching "${only}"` : "") + ".");
  process.exit(1);
}

const plan: { file: string; chunks: Chunk[] }[] = [];
for (const file of files) {
  const chunks = await chunksOf(join(folder, file));
  plan.push({ file, chunks });
  const chars = chunks.reduce((n, c) => n + c.content.length, 0);
  console.log(`${file}: ${chunks.length} pieces, ${chars} characters${chunks.length ? "" : "  (no text found: a scanned PDF needs OCR first)"}`);
}
const total = plan.reduce((n, p) => n + p.chunks.length, 0);
console.log(`\n${total} pieces from ${plan.length} files.`);
if (dry) process.exit(0);

const { supabase, userId } = await signIn();

let done = 0;
for (const { file, chunks } of plan) {
  if (!chunks.length) continue;
  console.log(`\n${file}`);
  const rows: { user_id: string; kind: string; source: string; page: number | null; section: string | null; content: string; embedding: string }[] = [];
  for (let i = 0; i < chunks.length; i += EMBED_BATCH) {
    const batch = chunks.slice(i, i + EMBED_BATCH);
    const vectors = await embedPatiently(batch.map(embedText));
    batch.forEach((c, j) => rows.push({ user_id: userId, kind: "material", source: c.source, page: c.page, section: c.section, content: c.content, embedding: vectorText(vectors[j]!) }));
    done += batch.length;
    process.stdout.write(`  embedded ${Math.min(i + EMBED_BATCH, chunks.length)}/${chunks.length}   (${done}/${total} overall)\r`);
  }
  process.stdout.write("\n");
  // replace this file's old pieces only after the new ones are ready
  const del = await supabase.from("language_chunks").delete().eq("kind", "material").eq("source", basename(file));
  if (del.error) throw new Error(`Could not clear the old pieces: ${del.error.message}. Has migration 0013 been run?`);
  for (let i = 0; i < rows.length; i += INSERT_BATCH) {
    const ins = await supabase.from("language_chunks").insert(rows.slice(i, i + INSERT_BATCH));
    if (ins.error) throw new Error(`Could not save pieces: ${ins.error.message}`);
  }
  console.log(`  saved ${rows.length} pieces`);
}
console.log("\nDone. Open Languages in the app and ask a question.");
