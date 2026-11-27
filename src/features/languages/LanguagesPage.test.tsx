import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { askLanguages, saveNote } from "./chat.functions";
import { addWords, reviewWord } from "./data";
import { LanguagesPage } from "./LanguagesPage";
import { encodeEvent, type LangEvent } from "./stream";
import type { Word } from "./vocab";

vi.mock("@tanstack/react-start", () => ({ useServerFn: (fn: unknown) => fn, createServerFn: () => ({}) }));
vi.mock("./chat.functions", () => ({ askLanguages: vi.fn(), saveNote: vi.fn() }));

let wordList: Word[] = [];
vi.mock("./data", () => ({
  libraryQuery: { queryKey: ["languages", "library"], queryFn: async () => ({ total: 12, material: 10, notes: 2 }) },
  notesQuery: { queryKey: ["languages", "notes"], queryFn: async () => [] },
  wordsQuery: { queryKey: ["languages", "words"], queryFn: async () => wordList },
  addWords: vi.fn(),
  deleteNote: vi.fn(),
  deleteWord: vi.fn(),
  reviewWord: vi.fn(),
  useInvalidateLanguages: () => async () => {},
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), message: vi.fn() } }));

const ask = vi.mocked(askLanguages) as unknown as ReturnType<typeof vi.fn>;
const save = vi.mocked(saveNote) as unknown as ReturnType<typeof vi.fn>;
const wrap = (ui: ReactNode) => <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>;

const enc = new TextEncoder();
const ndjson = (...events: LangEvent[]) =>
  new Response(
    new ReadableStream<Uint8Array>({
      start(c) {
        for (const e of events) c.enqueue(enc.encode(encodeEvent(e)));
        c.close();
      },
    }),
  );
const done = (over: Partial<Extract<LangEvent, { type: "done" }>> = {}): LangEvent => ({ type: "done", reply: "", citations: [], grounded: true, proposal: null, words: [], ...over });
const word = (over: Partial<Word> = {}): Word => ({ id: "w1", german: "Teig", article: "der", plural: null, english: "dough", example: null, box: 1, due: "2000-01-01", created_at: "2026-11-27", ...over });

async function send(text: string) {
  render(wrap(<LanguagesPage />));
  fireEvent.change(screen.getByLabelText("Ask about German"), { target: { value: text } });
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
}

beforeEach(() => {
  vi.clearAllMocks();
  wordList = [];
});

describe("Languages: Ask", () => {
  it("shows bold text and bullets properly, never as raw asterisks or HTML", async () => {
    ask.mockResolvedValue(ndjson(done({ reply: "**wurde** is past.\n\n* one *thing*\n* <b>two</b>" })));
    await send("wurde or würde");
    const strong = await screen.findByText("wurde");
    expect(strong.tagName).toBe("STRONG");
    expect(screen.queryByText(/\*\*/)).toBeNull();
    expect(screen.getAllByRole("listitem").some((li) => li.textContent === "<b>two</b>")).toBe(true);
    expect(document.querySelector("b")).toBeNull();
  });

  it("lists the sources an answer cites, with the page or section", async () => {
    ask.mockResolvedValue(
      ndjson(
        done({
          reply: "Dativ marks the indirect object [1].",
          citations: [{ n: 1, id: "a", kind: "material", source: "Guide.txt", page: null, section: "1. Cases", snippet: "Dativ is the indirect object" }],
        }),
      ),
    );
    await send("dative?");
    expect(await screen.findByText("Sources (1)")).toBeTruthy();
    expect(screen.getByText("[1] Guide.txt, 1. Cases")).toBeTruthy();
  });

  it("saves an answer to the notes, titled with the question", async () => {
    ask.mockResolvedValue(ndjson(done({ reply: "A rule." })));
    save.mockResolvedValue({ ok: true, id: "n1", searchable: "meaning" });
    await send("what is a rule?");
    fireEvent.click(await screen.findByRole("button", { name: /Save to notes/ }));
    await waitFor(() => expect(save).toHaveBeenCalledWith({ data: { title: "what is a rule?", text: "A rule." } }));
    expect(await screen.findByRole("button", { name: /Saved to notes/ })).toHaveProperty("disabled", true);
  });

  it("asks before saving proposed words, then saves them", async () => {
    const teig = { german: "Teig", article: "der" as const, plural: null, english: "dough", example: null };
    ask.mockResolvedValue(ndjson(done({ reply: "Here are words to keep.", words: [teig] })));
    vi.mocked(addWords).mockResolvedValue({ added: 1, skipped: 0 });
    await send("add Teig");
    expect(await screen.findByText("Add to your vocabulary?")).toBeTruthy();
    expect(addWords).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Add word" }));
    await waitFor(() => expect(addWords).toHaveBeenCalledWith([teig]));
    await waitFor(() => expect(screen.queryByText("Add to your vocabulary?")).toBeNull());
  });

  it("shows a problem as a message and keeps working", async () => {
    ask.mockResolvedValue(ndjson({ type: "error", error: "Could not search your library: boom" }));
    await send("x");
    expect((await screen.findByRole("alert")).textContent).toContain("Could not search your library");
  });
});

describe("Languages: Words", () => {
  it("lists words with their article and counts the ones due", async () => {
    wordList = [word(), word({ id: "w2", german: "Hefe", article: "die", english: "yeast", due: "2999-01-01" })];
    render(wrap(<LanguagesPage />));
    fireEvent.click(screen.getByRole("tab", { name: /Words/ }));
    expect(await screen.findByText("der Teig")).toBeTruthy();
    expect(screen.getByText("die Hefe")).toBeTruthy();
    expect(screen.getByText("2 words")).toBeTruthy();
    expect(screen.getByText("1 due for review")).toBeTruthy();
  });

  it("practises a due word: English first, then the answer, and records the result", async () => {
    wordList = [word()];
    vi.mocked(reviewWord).mockResolvedValue();
    render(wrap(<LanguagesPage />));
    fireEvent.click(screen.getByRole("tab", { name: /Words/ }));
    await screen.findByText("der Teig"); // the list has loaded, so the word is known to be due
    fireEvent.click(screen.getByRole("button", { name: /Practice/ }));
    expect(screen.getByText("dough")).toBeTruthy();
    expect(screen.queryByText("der Teig")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Show answer" }));
    const card = screen.getByText("der Teig").closest("div") as HTMLElement;
    expect(within(card).getByText("der Teig")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Knew it" }));
    await waitFor(() => expect(reviewWord).toHaveBeenCalledWith(expect.objectContaining({ id: "w1" }), true));
    expect(await screen.findByText("Done")).toBeTruthy();
    expect(screen.getByText(/You knew 1 of 1/)).toBeTruthy();
  });

  it("adds a typed word, taking the article out of the German", async () => {
    vi.mocked(addWords).mockResolvedValue({ added: 1, skipped: 0 });
    render(wrap(<LanguagesPage />));
    fireEvent.click(screen.getByRole("tab", { name: /Words/ }));
    fireEvent.change(await screen.findByLabelText("German word"), { target: { value: "das Blech" } });
    fireEvent.change(screen.getByLabelText("English meaning"), { target: { value: "baking tray" } });
    fireEvent.click(screen.getByRole("button", { name: "Add word" }));
    await waitFor(() => expect(addWords).toHaveBeenCalledWith([{ german: "Blech", article: "das", plural: null, english: "baking tray", example: null }]));
  });
});
