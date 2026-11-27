import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { GraduationCap, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { addWords, deleteWord, reviewWord, useInvalidateLanguages, wordsQuery } from "./data";
import { cleanWord, displayWord, isDue, localDay, shuffle, type Word } from "./vocab";

/** The word list: add words, search them, and practise the ones that are due. */
export function WordsTab() {
  const words = useQuery(wordsQuery);
  const invalidate = useInvalidateLanguages();
  const [german, setGerman] = useState("");
  const [english, setEnglish] = useState("");
  const [example, setExample] = useState("");
  const [find, setFind] = useState("");
  const [busy, setBusy] = useState(false);
  const [queue, setQueue] = useState<Word[] | null>(null);

  const today = localDay();
  const all = words.data ?? [];
  const due = useMemo(() => all.filter((w) => isDue(w, today)), [all, today]);
  const shown = useMemo(() => {
    const q = find.trim().toLowerCase();
    return q ? all.filter((w) => `${w.german} ${w.english}`.toLowerCase().includes(q)) : all;
  }, [all, find]);

  async function add() {
    const draft = cleanWord({ german, english, example });
    if (!draft) {
      toast.error("A word needs a German and an English side.");
      return;
    }
    if (busy) return;
    setBusy(true);
    try {
      const res = await addWords([draft]);
      if (!res.added) {
        toast.message("That word is already in your list.");
        return;
      }
      setGerman("");
      setEnglish("");
      setExample("");
      await invalidate();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save the word.");
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    try {
      await deleteWord(id);
      await invalidate();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not delete");
    }
  }

  if (queue) return <Practice queue={queue} onExit={() => { setQueue(null); void invalidate(); }} />;

  return (
    <div className="space-y-4">
      <div className="tile flex items-center gap-3 p-4">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">{all.length} words</p>
          <p className="text-sm text-muted-foreground">{due.length ? `${due.length} due for review` : "Nothing due today"}</p>
        </div>
        <Button className="h-11" disabled={!due.length} onClick={() => setQueue(shuffle(due))}>
          <GraduationCap className="mr-2 h-4 w-4" aria-hidden="true" />
          Practice
        </Button>
      </div>

      <form
        className="tile space-y-2 p-4"
        onSubmit={(e) => {
          e.preventDefault();
          void add();
        }}
      >
        <div className="grid gap-2 sm:grid-cols-2">
          <Input aria-label="German word" placeholder="German, e.g. der Teig" value={german} maxLength={80} onChange={(e) => setGerman(e.target.value)} />
          <Input aria-label="English meaning" placeholder="English, e.g. dough" value={english} maxLength={120} onChange={(e) => setEnglish(e.target.value)} />
        </div>
        <Input aria-label="Example sentence" placeholder="Example (optional)" value={example} maxLength={300} onChange={(e) => setExample(e.target.value)} />
        <Button type="submit" className="h-11" disabled={busy || !german.trim() || !english.trim()}>Add word</Button>
      </form>

      {words.isError && <p className="text-sm text-destructive">Could not load your words. Has migration 0014 been run?</p>}
      {all.length > 6 && <Input aria-label="Search your words" placeholder="Search your words" value={find} onChange={(e) => setFind(e.target.value)} />}
      {words.data && all.length === 0 && <p className="text-sm text-muted-foreground">No words yet. Add one above, or ask the chat: "add these kitchen words to my vocabulary".</p>}
      <ul className="space-y-2">
        {shown.map((w) => (
          <li key={w.id} className="tile flex items-start gap-2 p-4">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">
                {displayWord(w)}
                {w.plural ? <span className="font-normal text-muted-foreground"> · pl. {w.plural}</span> : null}
              </p>
              <p className="text-sm">{w.english}</p>
              {w.example && <p className="text-sm text-muted-foreground">{w.example}</p>}
              <p className="mt-1 text-xs text-muted-foreground">Box {w.box} · {isDue(w, today) ? "due" : `next ${w.due}`}</p>
            </div>
            <Button variant="ghost" size="icon" className="h-11 w-11 shrink-0" aria-label={`Delete ${displayWord(w)}`} onClick={() => void remove(w.id)}>
              <Trash2 className="h-4 w-4" />
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** One word at a time: the English side first, then the German with its article. */
function Practice({ queue, onExit }: { queue: Word[]; onExit: () => void }) {
  const [i, setI] = useState(0);
  const [shownAnswer, setShownAnswer] = useState(false);
  const [known, setKnown] = useState(0);
  const [saving, setSaving] = useState(false);
  const word = queue[i];

  async function answer(knew: boolean) {
    if (!word || saving) return;
    setSaving(true);
    try {
      await reviewWord(word, knew);
      if (knew) setKnown((n) => n + 1);
      setShownAnswer(false);
      setI((n) => n + 1);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save your answer.");
    } finally {
      setSaving(false);
    }
  }

  if (!word) {
    return (
      <div className="tile space-y-3 p-6 text-center">
        <p className="text-lg font-semibold">Done</p>
        <p className="text-sm text-muted-foreground">You knew {known} of {queue.length}. Missed words come back today; the others later.</p>
        <Button className="h-11" onClick={onExit}>Back to the list</Button>
      </div>
    );
  }
  return (
    <div className="space-y-4">
      <p className="text-center text-sm text-muted-foreground" aria-live="polite">{i + 1} of {queue.length}</p>
      <div className="tile space-y-3 p-6 text-center">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">How do you say</p>
        <p className="text-2xl font-semibold">{word.english}</p>
        {shownAnswer ? (
          <div className="space-y-1 border-t pt-3">
            <p className="text-xl font-semibold">{displayWord(word)}</p>
            {word.plural && <p className="text-sm text-muted-foreground">pl. {word.plural}</p>}
            {word.example && <p className="text-sm text-muted-foreground">{word.example}</p>}
          </div>
        ) : (
          <Button variant="outline" className="h-11" onClick={() => setShownAnswer(true)}>Show answer</Button>
        )}
      </div>
      {shownAnswer && (
        <div className="grid grid-cols-2 gap-2">
          <Button variant="outline" className="h-12" disabled={saving} onClick={() => void answer(false)}>Missed it</Button>
          <Button className="h-12" disabled={saving} onClick={() => void answer(true)}>Knew it</Button>
        </div>
      )}
      <Button variant="ghost" className="h-11 w-full" onClick={onExit}>Stop</Button>
    </div>
  );
}
