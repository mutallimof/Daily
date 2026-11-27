import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { BookOpen, Layers, NotebookPen, Send, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { MAX_NOTE_CHARS, whereFrom } from "./chat";
import { askLanguages, saveNote } from "./chat.functions";
import type { Citation } from "./chat-engine";
import { addWords, deleteNote, libraryQuery, notesQuery, useInvalidateLanguages } from "./data";
import { Rich } from "./Rich";
import { WordsTab } from "./WordsTab";
import { displayWord, type WordDraft } from "./vocab";
import { readEvents, type LangEvent } from "./stream";
import type { NoteProposal } from "./chat";

type Message = {
  id: number;
  role: "user" | "assistant";
  text: string;
  question?: string;
  citations?: Citation[];
  grounded?: boolean;
  proposal?: NoteProposal | null;
  words?: WordDraft[];
  saved?: boolean;
  error?: boolean;
  streaming?: boolean;
};

const EXAMPLES = ["When do I use dative and when accusative?", "What is the difference between wurde and würde?", "Add the kitchen words from my notes to my vocabulary"];
const VIEWS = [
  { id: "ask", label: "Ask", icon: BookOpen },
  { id: "words", label: "Words", icon: Layers },
  { id: "notes", label: "Notes", icon: NotebookPen },
] as const;
type View = (typeof VIEWS)[number]["id"];

/** Ask questions about German and get answers from your own library, with the page or section each answer comes from. */
export function LanguagesPage() {
  const [view, setView] = useState<View>("ask");
  return (
    <div className="flex min-h-[calc(100dvh-6.5rem)] flex-col gap-4">
      <h1 className="text-[1.75rem] leading-tight">Languages</h1>
      <div className="flex flex-1 flex-col">{view === "ask" ? <Ask /> : view === "words" ? <WordsTab /> : <Notes />}</div>
      <div role="tablist" aria-label="Languages" className="sticky bottom-2 z-20 grid h-16 grid-cols-3 rounded-full border bg-card/95 px-1.5 shadow-pop backdrop-blur">
        {VIEWS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={view === id}
            className={cn("group flex flex-col items-center justify-center gap-0.5 rounded-full text-[11px] font-medium text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", view === id && "font-semibold text-foreground")}
            onClick={() => setView(id)}
          >
            <span className={cn("flex h-8 w-12 items-center justify-center rounded-full transition-colors duration-200", view === id && "bg-primary text-primary-foreground")}>
              <Icon className="h-5 w-5" aria-hidden="true" />
            </span>
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}

function Ask() {
  const ask = useServerFn(askLanguages);
  const save = useServerFn(saveNote);
  const invalidate = useInvalidateLanguages();
  const library = useQuery(libraryQuery);
  const [messages, setMessages] = useState<Message[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const next = useRef(1);
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    end.current?.scrollIntoView?.({ block: "end" });
  }, [messages, busy]);

  async function send(message: string) {
    const clean = message.trim();
    if (!clean || busy) return;
    const history = messages.filter((m) => !m.error && !m.streaming).map((m) => ({ role: m.role, content: m.text }));
    const userId = next.current++;
    const answerId = next.current++;
    setMessages((all) => [...all, { id: userId, role: "user", text: clean }, { id: answerId, role: "assistant", text: "", question: clean, streaming: true }]);
    setText("");
    setBusy(true);
    const patch = (change: Partial<Message>) => setMessages((all) => all.map((m) => (m.id === answerId ? { ...m, ...change } : m)));
    let last: LangEvent | null = null;
    try {
      const res = await ask({ data: { turns: [...history, { role: "user", content: clean }] } });
      let shown = "";
      await readEvents(res.body, (e) => {
        if (e.type === "text") {
          shown += e.delta;
          patch({ text: shown });
        } else last = e;
      });
    } catch {
      last = { type: "error", error: "The AI request failed — please try again." };
    }
    const done = last as LangEvent | null;
    if (done?.type === "done") patch({ text: done.reply, citations: done.citations, grounded: done.grounded, proposal: done.proposal, words: done.words, streaming: false });
    else patch({ text: done?.type === "error" ? done.error : "The AI request failed — please try again.", error: true, streaming: false });
    setBusy(false);
  }

  async function confirm(id: number, note: NoteProposal) {
    const res = await save({ data: note });
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    setMessages((all) => all.map((m) => (m.id === id ? { ...m, proposal: null } : m)));
    toast.success(res.searchable === "meaning" ? "Note saved" : "Note saved (found by keyword only for now)");
    await invalidate();
  }

  async function confirmWords(id: number, words: WordDraft[]) {
    try {
      const res = await addWords(words);
      setMessages((all) => all.map((m) => (m.id === id ? { ...m, words: [] } : m)));
      toast.success(res.skipped ? `${res.added} saved, ${res.skipped} already in your list` : `${res.added} word${res.added === 1 ? "" : "s"} saved`);
      await invalidate();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save the words. Has migration 0014 been run?");
    }
  }

  async function saveAnswer(m: Message) {
    const res = await save({ data: { title: (m.question ?? "Answer").slice(0, 80), text: m.text } });
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    setMessages((all) => all.map((x) => (x.id === m.id ? { ...x, saved: true } : x)));
    toast.success("Saved to your notes");
    await invalidate();
  }

  const empty = library.data?.total === 0;
  return (
    <div className="flex flex-1 flex-col gap-4">
      {library.isError && <p className="tile p-4 text-sm text-destructive">Could not read your library. Has migration 0013 been run in this Supabase project?</p>}
      {empty && (
        <p className="tile p-4 text-sm text-muted-foreground">
          Your library is empty, so answers come from general knowledge. Load word lists and grammar notes with <code>npm run languages:ingest</code> (see the README), or save notes in the Notes tab.
        </p>
      )}
      {!messages.length && (
        <div className="space-y-2">
          {EXAMPLES.map((e) => (
            <button key={e} type="button" className="tile press flex min-h-13 w-full items-center gap-3 px-4 text-left text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => void send(e)}>
              {e}
            </button>
          ))}
          {library.data && !empty && <p className="px-1 text-xs text-muted-foreground">{library.data.material} passages and {library.data.notes} notes in your library. Your question and the matching passages are sent to your AI provider.</p>}
        </div>
      )}
      <ul className="space-y-3" aria-live="polite">
        {messages.map((m) => (
          <li key={m.id} className={m.role === "user" ? "flex justify-end" : "space-y-2"}>
            {m.role === "user" ? (
              <p className="max-w-[85%] rounded-3xl rounded-br-lg bg-primary px-4 py-2.5 text-[15px] text-primary-foreground">{m.text}</p>
            ) : (
              <>
                {m.streaming && !m.text ? (
                  <p role="status" aria-label="Thinking" className="inline-flex items-center gap-1 rounded-3xl rounded-bl-lg border bg-card px-4 py-3.5">
                    {[0, 1, 2].map((i) => (
                      <span key={i} className="h-2 w-2 animate-bounce rounded-full bg-muted-foreground/60 motion-reduce:animate-none" style={{ animationDelay: `${i * 150}ms` }} />
                    ))}
                  </p>
                ) : (
                  m.error ? (
                    <p role="alert" className="w-fit max-w-[92%] whitespace-pre-wrap rounded-3xl rounded-bl-lg border border-destructive/30 bg-destructive/10 px-4 py-2.5 text-[15px] text-destructive">
                      {m.text}
                    </p>
                  ) : (
                    <div className="w-fit max-w-[92%] rounded-3xl rounded-bl-lg border bg-card px-4 py-2.5 text-[15px] leading-relaxed">
                      <Rich text={m.text} />
                    </div>
                  )
                )}
                {m.citations && m.citations.length > 0 && <Sources citations={m.citations} />}
                {!m.streaming && !m.error && m.text && (
                  <Button variant="ghost" size="sm" className="h-9 px-3 text-xs" disabled={m.saved} onClick={() => void saveAnswer(m)}>
                    <NotebookPen className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                    {m.saved ? "Saved to notes" : "Save to notes"}
                  </Button>
                )}
                {!m.streaming && !m.error && m.grounded === false && <p className="px-1 text-xs text-muted-foreground">Nothing in your library matched, so this is general knowledge.</p>}
                {m.words && m.words.length > 0 && (
                  <div className="tile space-y-2 p-4">
                    <p className="text-sm font-semibold">Add to your vocabulary?</p>
                    <ul className="space-y-1 text-sm">
                      {m.words.map((w) => (
                        <li key={w.german}>
                          <span className="font-medium">{displayWord(w)}</span> — {w.english}
                          {w.example ? <span className="text-muted-foreground"> · {w.example}</span> : null}
                        </li>
                      ))}
                    </ul>
                    <div className="flex gap-2">
                      <Button className="h-11" onClick={() => void confirmWords(m.id, m.words!)}>Add {m.words.length === 1 ? "word" : `${m.words.length} words`}</Button>
                      <Button variant="outline" className="h-11" onClick={() => setMessages((all) => all.map((x) => (x.id === m.id ? { ...x, words: [] } : x)))}>Not now</Button>
                    </div>
                  </div>
                )}
                {m.proposal && (
                  <div className="tile space-y-2 p-4">
                    <p className="text-sm font-semibold">Save this note?</p>
                    <p className="text-sm font-medium">{m.proposal.title}</p>
                    <p className="whitespace-pre-wrap text-sm text-muted-foreground">{m.proposal.text}</p>
                    <div className="flex gap-2">
                      <Button className="h-11" onClick={() => void confirm(m.id, m.proposal!)}>Save note</Button>
                      <Button variant="outline" className="h-11" onClick={() => setMessages((all) => all.map((x) => (x.id === m.id ? { ...x, proposal: null } : x)))}>Not now</Button>
                    </div>
                  </div>
                )}
              </>
            )}
          </li>
        ))}
      </ul>
      <div ref={end} className="flex-1" />
      <form
        className="sticky bottom-[5rem] z-10 flex gap-2 rounded-full border bg-card p-1.5 shadow-pop"
        onSubmit={(e) => {
          e.preventDefault();
          void send(text);
        }}
      >
        <Input aria-label="Ask about German" placeholder="Ask about a word or a rule" className="h-11 rounded-full border-0 bg-transparent text-base focus-visible:ring-0 sm:text-sm" value={text} maxLength={1000} onChange={(e) => setText(e.target.value)} />
        <Button type="submit" size="icon" className="h-11 w-11 shrink-0" aria-label="Send" disabled={busy || !text.trim()}>
          <Send className="h-4 w-4" />
        </Button>
      </form>
    </div>
  );
}

/** The passages an answer used, by the number the answer gives them. */
function Sources({ citations }: { citations: Citation[] }) {
  return (
    <details className="w-fit max-w-[92%] text-sm">
      <summary className="min-h-8 cursor-pointer text-xs font-medium text-muted-foreground">Sources ({citations.length})</summary>
      <ul className="mt-1 space-y-2">
        {citations.map((c) => (
          <li key={c.n} className="rounded-xl border bg-card px-3 py-2">
            <p className="text-xs font-semibold">[{c.n}] {whereFrom(c)}{c.kind === "note" ? " · your note" : ""}</p>
            <p className="mt-1 text-xs text-muted-foreground">{c.snippet}</p>
          </li>
        ))}
      </ul>
    </details>
  );
}

function Notes() {
  const save = useServerFn(saveNote);
  const invalidate = useInvalidateLanguages();
  const notes = useQuery(notesQuery);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);

  async function add() {
    if (!body.trim() || busy) return;
    setBusy(true);
    try {
      const res = await save({ data: { title, text: body } });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      setTitle("");
      setBody("");
      toast.success(res.searchable === "meaning" ? "Note saved" : "Note saved (found by keyword only for now)");
      await invalidate();
    } catch {
      toast.error("Could not save the note.");
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    try {
      await deleteNote(id);
      await invalidate();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not delete");
    }
  }

  return (
    <div className="space-y-4">
      <form
        className="tile space-y-2 p-4"
        onSubmit={(e) => {
          e.preventDefault();
          void add();
        }}
      >
        <Input aria-label="Note title" placeholder="Title (optional)" value={title} maxLength={80} onChange={(e) => setTitle(e.target.value)} />
        <Textarea aria-label="Note" placeholder="A rule, a mistake you made, new words…" value={body} maxLength={MAX_NOTE_CHARS} rows={4} onChange={(e) => setBody(e.target.value)} />
        <Button type="submit" className="h-11" disabled={busy || !body.trim()}>Save note</Button>
      </form>
      {notes.isError && <p className="text-sm text-destructive">Could not load your notes. Has migration 0013 been run?</p>}
      {notes.data?.length === 0 && <p className="text-sm text-muted-foreground">No notes yet.</p>}
      <ul className="space-y-2">
        {notes.data?.map((n) => (
          <li key={n.id} className="tile flex items-start gap-2 p-4">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">{n.source}</p>
              <p className="whitespace-pre-wrap text-sm text-muted-foreground">{n.content}</p>
            </div>
            <Button variant="ghost" size="icon" className="h-11 w-11 shrink-0" aria-label={`Delete note ${n.source}`} onClick={() => void remove(n.id)}>
              <Trash2 className="h-4 w-4" />
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}
