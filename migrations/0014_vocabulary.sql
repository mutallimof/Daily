-- 0014_vocabulary.sql
-- Languages: your own word list with simple spaced review (five boxes: a word you knew moves up and comes back later,
-- a word you missed goes back to box 1). Private to you by row-level security. Safe to run more than once. Nothing is deleted.

CREATE TABLE IF NOT EXISTS public.vocab_words (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid(),
  german text NOT NULL CHECK (char_length(btrim(german)) BETWEEN 1 AND 80),
  article text CHECK (article IS NULL OR article IN ('der', 'die', 'das')),
  plural text CHECK (plural IS NULL OR char_length(plural) <= 80),
  english text NOT NULL CHECK (char_length(btrim(english)) BETWEEN 1 AND 120),
  example text CHECK (example IS NULL OR char_length(example) <= 300),
  box smallint NOT NULL DEFAULT 1 CHECK (box BETWEEN 1 AND 5),
  due date NOT NULL DEFAULT current_date,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- one entry per German word (any letter case) for each person
CREATE UNIQUE INDEX IF NOT EXISTS vocab_words_user_word_idx ON public.vocab_words (user_id, lower(german));
CREATE INDEX IF NOT EXISTS vocab_words_due_idx ON public.vocab_words (user_id, due);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.vocab_words TO authenticated;
GRANT ALL ON public.vocab_words TO service_role;

ALTER TABLE public.vocab_words ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "own vocab_words" ON public.vocab_words;
CREATE POLICY "own vocab_words" ON public.vocab_words
  FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
