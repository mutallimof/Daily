import { describe, expect, it, vi } from "vitest";
import type { ChatMessage, ModelReply, ToolCall } from "@/features/gym/ai-provider.server";
import { runChat, type ChatDeps } from "./chat-engine";
import type { Passage } from "./search";

const pass = (id: string, content: string, over: Partial<Passage> = {}): Passage => ({ id, kind: "material", source: "Guide.txt", page: null, section: "1. Cases", content, similarity: 0.9, score: 0.03, ...over });
const reply = (text: string, calls: ToolCall[] = []): ModelReply => ({ message: { role: "assistant", content: text || null, ...(calls.length ? { tool_calls: calls } : {}) }, text, toolCalls: calls });
const call = (name: string, args: unknown, id = "c1"): ToolCall => ({ id, type: "function", function: { name, arguments: typeof args === "string" ? args : JSON.stringify(args) } });
const ask = [{ role: "user" as const, content: "When do I use dative?" }];

function deps(replies: ModelReply[], search: ChatDeps["search"] = async () => [pass("a", "Dativ is the indirect object"), pass("b", "Akkusativ is the direct object", { page: 4, section: null, source: "list.pdf" })]) {
  const seen: ChatMessage[][] = [];
  const queue = [...replies];
  const complete = vi.fn(async (messages: ChatMessage[]) => {
    seen.push(structuredClone(messages));
    return queue.shift() ?? reply("(out of replies)");
  });
  return { d: { complete, search: vi.fn(search) } as ChatDeps, complete, seen };
}

describe("runChat", () => {
  it("searches the library for the latest question and gives the passages to the model, numbered", async () => {
    const t = deps([reply("Dativ marks the indirect object [1].")]);
    const out = await runChat(t.d, ask);
    expect(t.d.search).toHaveBeenCalledWith("When do I use dative?");
    const context = t.seen[0]?.find((m) => m.role === "user" && typeof m.content === "string" && m.content.startsWith("Passages"));
    expect(context && "content" in context ? context.content : "").toMatch(/\[1\] \(Guide\.txt, 1\. Cases\)[\s\S]*\[2\] \(list\.pdf, p\. 4\)/);
    expect(out.grounded).toBe(true);
    expect(out.citations).toEqual([expect.objectContaining({ n: 1, id: "a", source: "Guide.txt", section: "1. Cases" })]);
  });

  it("returns only the passages the answer cites, with their page", async () => {
    const out = await runChat(deps([reply("Accusative is the direct object [2]. Dative the indirect [1].")]).d, ask);
    expect(out.citations.map((c) => [c.n, c.page])).toEqual([[2, 4], [1, null]]);
  });

  it("removes a citation number that was never given", async () => {
    const out = await runChat(deps([reply("True [1]. Made up [7]. Mixed [2, 9].")]).d, ask);
    expect(out.reply).toBe("True [1]. Made up. Mixed [2].");
    expect(out.citations.map((c) => c.n)).toEqual([1, 2]);
  });

  it("is not grounded, and has no citations, when nothing was found", async () => {
    const out = await runChat(deps([reply("That is not in your material. In general, dative is for indirect objects [1].")], async () => []).d, ask);
    expect(out.grounded).toBe(false);
    expect(out.citations).toEqual([]);
    expect(out.reply).not.toContain("[1]");
  });

  it("lets the model look something up and numbers the new passages after the first ones", async () => {
    const search = vi.fn(async (q: string) => (q === "When do I use dative?" ? [pass("a", "one")] : [pass("a", "one"), pass("c", "Passiv uses werden")]));
    const t = deps([reply("", [call("search_notes", { query: "passiv" })]), reply("Passive uses werden [2].")], search);
    const out = await runChat(t.d, ask);
    expect(search).toHaveBeenCalledWith("passiv");
    const tool = t.seen[1]?.find((m) => m.role === "tool");
    expect(tool && "content" in tool ? tool.content : "").toMatch(/^\[2\] /);
    expect(out.citations.map((c) => c.id)).toEqual(["c"]);
  });

  it("stops looking things up after three lookups", async () => {
    const lookups = [1, 2, 3, 4].map((i) => reply("", [call("search_notes", { query: `q${i}` }, `c${i}`)]));
    const t = deps([...lookups, reply("done")]);
    await runChat(t.d, ask);
    expect(t.d.search).toHaveBeenCalledTimes(1 + 3);
  });

  it("proposes a note without saving anything", async () => {
    const t = deps([reply("", [call("add_note", { title: "wurde", text: "wurde = Passiv" })]), reply("")]);
    const out = await runChat(t.d, ask);
    expect(out.proposal).toEqual({ title: "wurde", text: "wurde = Passiv" });
    expect(out.reply).toBe("Here is a note to keep.");
  });

  it("proposes words without saving anything, once each", async () => {
    const t = deps([reply("", [call("add_words", { words: [{ german: "der Teig", english: "dough" }, { german: "teig", english: "dough" }, { german: "Hefe", article: "die", english: "yeast" }, { german: "nur deutsch" }] })]), reply("")]);
    const out = await runChat(t.d, ask);
    expect(out.words.map((w) => [w.article, w.german])).toEqual([["der", "Teig"], ["die", "Hefe"]]);
    expect(out.reply).toBe("Here are words to keep.");
    expect(out.proposal).toBeNull();
  });

  it("sends a malformed tool call back as an error and gives up after three", async () => {
    const bad = (i: number) => reply("", [call("search_notes", "{oops", `b${i}`)]);
    const out = await runChat(deps([bad(1), bad(2), bad(3), reply("never reached")]).d, ask);
    expect(out.reply).toBe("I couldn't understand the AI's answer — please try again.");
  });

  it("streams text as it arrives and lets provider errors through", async () => {
    const onText = vi.fn();
    const d: ChatDeps = {
      search: async () => [],
      complete: async (_m, _t, text) => {
        text?.("Hal");
        text?.("lo");
        return reply("Hallo");
      },
    };
    await runChat(d, ask, onText);
    expect(onText.mock.calls.map((c) => c[0])).toEqual(["Hal", "lo"]);
    await expect(runChat({ search: async () => [], complete: async () => Promise.reject(new Error("boom")) }, ask)).rejects.toThrow("boom");
  });
});
