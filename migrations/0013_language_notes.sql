-- 0013_language_notes.sql
-- Languages: a private library of German study material (word lists, grammar notes, your own notes), searchable by
-- meaning (pgvector) and by keyword, so the Languages chat can answer from your own material and cite where.
-- Material is loaded by `npm run languages:ingest` (you sign in as yourself, so every row is yours). Notes are saved
-- from the app after you confirm. Safe to run more than once. Nothing is deleted.
-- Run in the Supabase SQL editor. The vector extension is built in: this only switches it on.

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS public.language_chunks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid(),
  kind text NOT NULL DEFAULT 'material' CHECK (kind IN ('material', 'note')),
  source text NOT NULL CHECK (char_length(source) BETWEEN 1 AND 200),
  page integer CHECK (page IS NULL OR page > 0),
  section text CHECK (section IS NULL OR char_length(section) <= 200),
  content text NOT NULL CHECK (char_length(content) BETWEEN 1 AND 4000),
  embedding vector(768),
  fts tsvector GENERATED ALWAYS AS (to_tsvector('simple', content)) STORED,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS language_chunks_user_idx ON public.language_chunks (user_id, kind, source);
CREATE INDEX IF NOT EXISTS language_chunks_fts_idx ON public.language_chunks USING gin (fts);
CREATE INDEX IF NOT EXISTS language_chunks_embedding_idx ON public.language_chunks USING hnsw (embedding vector_cosine_ops);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.language_chunks TO authenticated;
GRANT ALL ON public.language_chunks TO service_role;

ALTER TABLE public.language_chunks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "own language_chunks" ON public.language_chunks;
CREATE POLICY "own language_chunks" ON public.language_chunks
  FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Hybrid search over the caller's own rows (row-level security applies: SECURITY INVOKER). The two rankings, by
-- meaning and by keyword, are merged with reciprocal rank fusion. Either side may be missing: pass a NULL embedding to
-- search by keyword only (used when the embedding service is down), or empty text to search by meaning only.
CREATE OR REPLACE FUNCTION public.search_language(
  query_embedding vector(768) DEFAULT NULL,
  query_text text DEFAULT '',
  match_count integer DEFAULT 8
)
RETURNS TABLE (
  id uuid,
  kind text,
  source text,
  page integer,
  section text,
  content text,
  similarity double precision,
  score double precision
)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public, extensions
AS $$
  WITH p AS (
    SELECT least(greatest(coalesce(match_count, 8), 1), 20) AS k,
           nullif(trim(coalesce(query_text, '')), '') AS q
  ),
  sem AS (
    SELECT c.id, c.embedding <=> query_embedding AS dist,
           row_number() OVER (ORDER BY c.embedding <=> query_embedding) AS r
    FROM public.language_chunks c
    WHERE query_embedding IS NOT NULL AND c.embedding IS NOT NULL
    ORDER BY c.embedding <=> query_embedding
    LIMIT (SELECT k * 3 FROM p)
  ),
  lex AS (
    SELECT c.id, row_number() OVER (ORDER BY ts_rank_cd(c.fts, tq.t) DESC) AS r
    FROM public.language_chunks c,
         (SELECT websearch_to_tsquery('simple', regexp_replace(p.q, '\s+', ' or ', 'g')) AS t FROM p WHERE p.q IS NOT NULL) tq
    WHERE c.fts @@ tq.t
    ORDER BY ts_rank_cd(c.fts, tq.t) DESC
    LIMIT (SELECT k * 3 FROM p)
  ),
  fused AS (
    SELECT id, sum(1.0 / (60 + r)) AS score
    FROM (SELECT id, r FROM sem UNION ALL SELECT id, r FROM lex) ranked
    GROUP BY id
  )
  SELECT c.id, c.kind, c.source, c.page, c.section, c.content,
         (SELECT 1 - s.dist FROM sem s WHERE s.id = c.id) AS similarity,
         f.score::double precision
  FROM fused f
  JOIN public.language_chunks c ON c.id = f.id
  ORDER BY f.score DESC, c.id
  LIMIT (SELECT k FROM p);
$$;

GRANT EXECUTE ON FUNCTION public.search_language(vector, text, integer) TO authenticated;
