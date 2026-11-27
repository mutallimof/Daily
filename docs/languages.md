# Languages

Ask questions about German and get answers from your own material, with the page or section each answer comes from.

## How it works
1. **Library.** Word lists (PDF) and grammar notes (txt/md) are cut into pieces of at most 900 characters. A PDF page is never crossed, so a citation names the right page; notes keep the heading above each piece. Every piece is turned into a vector (768 numbers) and stored in `language_chunks`, private to you (row-level security).
2. **Search.** A question is searched two ways at once: by meaning (pgvector, cosine distance) and by keyword (Postgres full text). The two rankings are merged with reciprocal rank fusion in the database function `search_language`. If the embedding service is down, the search falls back to keywords only.
3. **Answer.** The best passages go to the model, numbered `[1]`, `[2]`. The model must cite the number after each claim; numbers it was never given are removed from the text, and only passages the answer cites are shown under it as Sources. When nothing matches, the answer says it is general knowledge.
4. **Tools, with confirmation.** `search_notes` looks something else up (three times at most per turn). `add_note` and `add_words` only propose: nothing is saved until you tap the button.

## Words and notes
- **Words tab:** your own word list (German with article and plural, English, an example). Words come back for review in five boxes: a word you knew moves up a box and waits longer (1, 2, 4, 8, 16 days); a word you missed goes back to box 1 and is due today. Practice shows the English side first, then the German.
- **From the chat:** ask "add these words to my vocabulary" and the model proposes words with `add_words`. Nothing is saved until you tap Add. Words already in your list are skipped.
- **Save to notes:** the button under an answer stores that answer as a note titled with your question. Notes join the library, so later answers can cite them.

## Load your material
See MANUAL_STEPS step 12. In short: run migration `0013`, then `npm run languages:ingest -- "<folder>"`.

## Measure it
`npm run languages:eval` runs 25 questions (`src/features/languages/eval/cases.json`) and prints hit@1, hit@3 and hit@5 for keyword-only search and for the hybrid search. A question counts as found when a passage containing one of its words, from the named file, is among the top results. The questions are written for the author's material: change them for yours.

## Limits
- Two-column PDF pages (such as the Goethe word lists) are read line by line, so an entry and the example next to it can share a piece, and a long entry can be split across lines. Search still finds them; the snippet can look mixed.
- Scanned PDFs have no text and are skipped.
- Grammar notes written by an AI chat can contain mistakes; check them against a textbook.
- Answers are only as good as the material: the library holds word lists and short grammar notes, not a full course book.

## Re-ranking and two-column pages
- **Re-ranking:** a lookup first brings back 15 candidates (meaning + keywords), then the model picks the best 6 and puts them first. If that step fails, the search order is kept, so it can only help. Code: `rerank.ts`.
- **Two-column PDFs:** on portrait pages with an empty strip down the middle (the Goethe word lists) the left half is read first, then the right half, so a headword stays with its example sentences. Wide pages and tables are read as before. A bigger vertical gap starts a new entry. Code: `columnSplit` in `pdf.server.ts`. Run `npm run languages:ingest` again for the Goethe files to use it.
- **Eval:** `npm run languages:eval` now prints three rows (keyword, hybrid, hybrid + re-rank). If any search fell back because of a quota error, it says the row is not valid.
