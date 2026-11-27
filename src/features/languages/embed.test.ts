import { afterEach, describe, expect, it, vi } from "vitest";
import { AiError, EMBED_DIMS, embed, parseEmbeddings } from "@/features/gym/ai-provider.server";

const vec = (x: number) => Array.from({ length: EMBED_DIMS }, () => x);

describe("parseEmbeddings", () => {
  it("returns the vectors in input order", () => {
    const out = parseEmbeddings({ data: [{ index: 1, embedding: vec(2) }, { index: 0, embedding: vec(1) }] }, 2);
    expect(out.map((v) => v[0])).toEqual([1, 2]);
  });
  it("rejects a wrong count, a wrong size and bad numbers", () => {
    expect(() => parseEmbeddings({ data: [] }, 1)).toThrow(AiError);
    expect(() => parseEmbeddings({ data: [{ embedding: [1, 2, 3] }] }, 1)).toThrow(/768/);
    expect(() => parseEmbeddings({ data: [{ embedding: [...vec(1).slice(1), "x"] }] }, 1)).toThrow(AiError);
    expect(() => parseEmbeddings(null, 1)).toThrow(AiError);
  });
});

describe("embed", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("asks the provider for EMBED_DIMS numbers per text", async () => {
    vi.stubEnv("AI_API_KEY", "k");
    vi.stubEnv("AI_PROVIDER", "gemini");
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ data: [{ index: 0, embedding: vec(0.5) }] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const out = await embed(["Hallo"]);
    expect(out).toHaveLength(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toMatch(/\/embeddings$/);
    expect(JSON.parse(String(init.body))).toMatchObject({ model: "gemini-embedding-001", input: ["Hallo"], dimensions: EMBED_DIMS });
    expect((init.headers as Record<string, string>)["Authorization"]).toBe("Bearer k");
  });

  it("needs a key, and a model for other providers", async () => {
    vi.stubEnv("AI_API_KEY", "");
    await expect(embed(["x"])).rejects.toThrow(/AI_API_KEY/);
    vi.stubEnv("AI_API_KEY", "k");
    vi.stubEnv("AI_PROVIDER", "openai-compatible");
    vi.stubEnv("AI_BASE_URL", "http://localhost:11434/v1");
    vi.stubEnv("AI_EMBED_MODEL", "");
    await expect(embed(["x"])).rejects.toThrow(/AI_EMBED_MODEL/);
  });

  it("retries a rate limit, then succeeds, and never puts the key in an error", async () => {
    vi.stubEnv("AI_API_KEY", "secret-key");
    vi.stubEnv("AI_RETRY_BASE_MS", "1");
    const ok = () => new Response(JSON.stringify({ data: [{ embedding: vec(1) }] }), { status: 200 });
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response("slow down", { status: 429, headers: { "retry-after": "0" } })).mockResolvedValueOnce(ok());
    vi.stubGlobal("fetch", fetchMock);
    expect(await embed(["x"])).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    vi.stubGlobal("fetch", vi.fn(async () => new Response("denied", { status: 401 })));
    const err = await embed(["x"]).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AiError);
    expect((err as Error).message).not.toContain("secret-key");
  });

  it("does nothing for no texts", async () => {
    expect(await embed([])).toEqual([]);
  });
});
