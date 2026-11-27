// @vitest-environment node
// Runs migration 0013 (the Languages library) in an in-memory Postgres (PGlite). PGlite has no pgvector, so a small
// stand-in is created first: `vector` becomes an array of numbers and `<=>` the cosine distance. That is enough to
// check what the app cannot check itself: the SQL parses and runs twice, row-level security keeps people apart, the
// column rules hold, and the hybrid search fuses the two rankings. (The real pgvector index line is removed here.)
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const ALICE = "11111111-1111-1111-1111-111111111111";
const BOB = "22222222-2222-2222-2222-222222222222";

const migration = readFileSync(join(process.cwd(), "migrations", "0013_language_notes.sql"), "utf8")
  .replace(/CREATE EXTENSION IF NOT EXISTS vector;/, "")
  .replace(/CREATE INDEX IF NOT EXISTS language_chunks_embedding_idx[^;]*;/, "")
  .replace(/vector\(768\)/g, "vector");

let db: PGlite;

async function as(user: string | null) {
  await db.exec("RESET ROLE");
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [user ?? ""]);
  if (user) await db.exec("SET ROLE authenticated");
}

type Row = { id?: string; kind?: string; source?: string; page?: number | null; content: string; embedding?: number[] | null };
async function add(user: string, r: Row) {
  await as(user);
  await db.query("insert into language_chunks (id, user_id, kind, source, page, content, embedding) values (coalesce($1, gen_random_uuid()), $2, $3, $4, $5, $6, $7::float8[])", [
    r.id ?? null,
    user,
    r.kind ?? "material",
    r.source ?? "list.pdf",
    r.page ?? null,
    r.content,
    r.embedding ?? null,
  ]);
}

async function search(user: string, embedding: number[] | null, text: string, count = 8) {
  await as(user);
  const res = await db.query<{ id: string; similarity: number | null; score: number }>("select id, similarity, score from search_language($1::float8[], $2, $3)", [embedding, text, count]);
  return res.rows;
}

const P = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa";
const id = (n: number) => `00000000-0000-0000-0000-00000000000${n}`;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create schema auth;
    create schema extensions;
    create function auth.uid() returns uuid language sql stable
      as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create role authenticated;
    create role service_role;
    grant usage on schema public to authenticated, service_role;
    grant usage on schema auth to authenticated, service_role;
    create domain vector as float8[];
    create function cosdist(a float8[], b float8[]) returns float8 language sql immutable as $$
      select 1 - sum(x * y) / (sqrt(sum(x * x)) * sqrt(sum(y * y))) from unnest(a, b) as t(x, y) $$;
    create operator <=> (leftarg = float8[], rightarg = float8[], function = cosdist);
  `);
  await db.exec(migration);
  await db.exec(migration); // safe to run twice
}, 60_000);

afterAll(async () => {
  await db.close();
});

describe("language_chunks", () => {
  it("keeps each person's library private", async () => {
    await add(ALICE, { id: `${P}1`, content: "Alice Teig dough" });
    await add(BOB, { id: `${P}2`, content: "Bob Teig dough" });
    await as(BOB);
    const mine = await db.query<{ id: string }>("select id from language_chunks");
    expect(mine.rows.map((r) => r.id)).toEqual([`${P}2`]);
    expect((await search(BOB, null, "teig")).map((r) => r.id)).toEqual([`${P}2`]);
    await expect(db.query("insert into language_chunks (user_id, content, source) values ($1, 'x', 's')", [ALICE])).rejects.toThrow(/row-level security/);
    await as(ALICE);
    const del = await db.query("delete from language_chunks where id = $1 returning id", [`${P}2`]);
    expect(del.rows).toHaveLength(0);
  });

  it("rejects values outside the rules", async () => {
    await expect(add(ALICE, { kind: "other", content: "x" })).rejects.toThrow(/check/);
    await expect(add(ALICE, { page: 0, content: "x" })).rejects.toThrow(/check/);
    await expect(add(ALICE, { content: "" })).rejects.toThrow(/check/);
    await expect(add(ALICE, { content: "x".repeat(4001) })).rejects.toThrow(/check/);
  });
});

describe("search_language", () => {
  beforeAll(async () => {
    await as(ALICE);
    await db.exec("delete from language_chunks");
    await add(ALICE, { id: id(1), content: "der Teig | dough", embedding: [1, 0, 0] }); // matches by keyword and by meaning
    await add(ALICE, { id: id(2), content: "die Hefe | yeast", embedding: [0.9, 0.1, 0] }); // by meaning only
    await add(ALICE, { id: id(3), content: "der Teigling raw dough piece", embedding: [0, 1, 0] }); // shares no word with the question
    await add(ALICE, { id: id(4), content: "das Blech | baking tray", embedding: [0, 0, 1], page: 4 });
    await add(ALICE, { id: id(5), kind: "note", source: "my note", content: "teig rules", embedding: null });
  });

  it("puts what both rankings agree on first and finds meaning-only and keyword-only matches", async () => {
    const out = await search(ALICE, [1, 0, 0], "teig");
    expect(out[0]?.id).toBe(id(1));
    const ids = out.map((r) => r.id);
    expect(ids).toContain(id(2)); // near in meaning, shares no word
    expect(ids).toContain(id(5)); // keyword only: it has no vector
  });

  it("reports similarity for rows found by meaning and null for keyword-only rows", async () => {
    const out = await search(ALICE, [1, 0, 0], "teig");
    expect(out.find((r) => r.id === id(1))?.similarity).toBeCloseTo(1, 5);
    expect(out.find((r) => r.id === id(5))?.similarity).toBeNull();
  });

  it("searches by keyword only when there is no embedding", async () => {
    const out = await search(ALICE, null, "when or tray");
    expect(out.map((r) => r.id)).toEqual([id(4)]);
  });

  it("searches by meaning only when the text is empty", async () => {
    const out = await search(ALICE, [0, 0, 1], "");
    expect(out[0]?.id).toBe(id(4));
    expect(await search(ALICE, null, "")).toEqual([]);
  });

  it("treats several words as alternatives, not all required", async () => {
    const out = await search(ALICE, null, "yeast tray unknownword");
    expect(out.map((r) => r.id).sort()).toEqual([id(2), id(4)]);
  });

  it("limits the number of rows, between 1 and 20", async () => {
    expect(await search(ALICE, [1, 0, 0], "teig", 2)).toHaveLength(2);
    expect(await search(ALICE, [1, 0, 0], "teig", 0)).toHaveLength(1);
    expect((await search(ALICE, [1, 0, 0], "teig", 500)).length).toBeLessThanOrEqual(20);
  });

  it("returns the page and kind so answers can cite them", async () => {
    await as(ALICE);
    const res = await db.query<{ page: number; kind: string }>("select page, kind from search_language(null, 'tray', 3)");
    expect(res.rows[0]).toEqual({ page: 4, kind: "material" });
  });
});
