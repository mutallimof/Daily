// @vitest-environment node
// Runs migration 0014 (the word list) in an in-memory Postgres (PGlite): the SQL runs twice, row-level security keeps
// people apart, a German word can be saved once per person (any letter case), and the column rules hold.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const ALICE = "11111111-1111-1111-1111-111111111111";
const BOB = "22222222-2222-2222-2222-222222222222";
const sql = readFileSync(join(process.cwd(), "migrations", "0014_vocabulary.sql"), "utf8");

let db: PGlite;

async function as(user: string) {
  await db.exec("RESET ROLE");
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [user]);
  await db.exec("SET ROLE authenticated");
}

async function add(user: string, german: string, extra: Record<string, unknown> = {}) {
  await as(user);
  await db.query("insert into vocab_words (user_id, german, english, article, box, plural, example) values ($1, $2, $3, $4, $5, $6, $7)", [
    user,
    german,
    (extra["english"] as string | undefined) ?? "x",
    (extra["article"] as string | null | undefined) ?? null,
    (extra["box"] as number | undefined) ?? 1,
    (extra["plural"] as string | null | undefined) ?? null,
    (extra["example"] as string | null | undefined) ?? null,
  ]);
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create schema auth;
    create function auth.uid() returns uuid language sql stable
      as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create role authenticated;
    create role service_role;
    grant usage on schema public to authenticated, service_role;
    grant usage on schema auth to authenticated, service_role;
  `);
  await db.exec(sql);
  await db.exec(sql); // safe to run twice
}, 60_000);

afterAll(async () => {
  await db.close();
});

describe("vocab_words", () => {
  it("keeps each person's list private", async () => {
    await add(ALICE, "Teig", { article: "der" });
    await add(BOB, "Hefe", { article: "die" });
    await as(BOB);
    const rows = await db.query<{ german: string }>("select german from vocab_words");
    expect(rows.rows.map((r) => r.german)).toEqual(["Hefe"]);
    await expect(db.query("insert into vocab_words (user_id, german, english) values ($1, 'x', 'y')", [ALICE])).rejects.toThrow(/row-level security/);
    expect((await db.query("update vocab_words set english = 'hacked' where german = 'Teig' returning id")).rows).toHaveLength(0);
  });

  it("allows a German word once per person, ignoring letter case, and the same word for another person", async () => {
    await add(ALICE, "Blech");
    await expect(add(ALICE, "blech")).rejects.toThrow(/duplicate key/);
    await add(BOB, "Blech");
  });

  it("starts a new word in box 1, due today", async () => {
    await add(ALICE, "Schürze");
    const r = await db.query<{ box: number; due: string; today: string }>("select box, due::text, current_date::text as today from vocab_words where german = 'Schürze'");
    expect(r.rows[0]?.box).toBe(1);
    expect(r.rows[0]?.due).toBe(r.rows[0]?.today);
  });

  it("rejects values outside the rules", async () => {
    await expect(add(ALICE, "Ofen", { article: "ein" })).rejects.toThrow(/check/);
    await expect(add(ALICE, "Ofen2", { box: 6 })).rejects.toThrow(/check/);
    await expect(add(ALICE, "   ")).rejects.toThrow(/check/);
    await expect(add(ALICE, "Ofen3", { english: "" })).rejects.toThrow(/check/);
    await expect(add(ALICE, "Ofen4", { example: "x".repeat(301) })).rejects.toThrow(/check/);
  });
});
