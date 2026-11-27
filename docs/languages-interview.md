# Languages: explaining it in an interview

## What to say it is
"A retrieval-augmented generation (RAG) feature in my personal planner. It answers German questions from my own word lists and notes and cites the page or section. I designed it and built it with Claude Code (AI-assisted coding)."

Be honest about the second sentence. You chose the problem, the sources, the question set and the design; you should be able to explain every step below.

## The pipeline in 60 seconds
1. **Ingest.** PDFs and notes are cut into pieces of at most 900 characters. A PDF page is never crossed, so a citation always names the right page; notes keep the heading above each piece.
2. **Embed.** Each piece is turned into a vector of 768 numbers by an embedding model and stored in Postgres with the pgvector extension. Texts with similar meaning have vectors that point in similar directions.
3. **Retrieve.** The question is embedded the same way. One SQL function (`search_language`) finds the nearest vectors (cosine distance) and, separately, the pieces sharing the question's words (Postgres full-text search). The two rankings are merged with reciprocal rank fusion.
4. **Generate.** The best passages go to the language model as numbered context, with an instruction to answer from them and cite [n].
4b. **Re-rank.** The search brings back 15 candidates; the model picks the best 6 and puts them first. If it fails the search order is kept.
5. **Check.** Any citation number the model was never given is removed from the text. Only passages the answer actually cites are shown under it.
6. **Tools.** The model can search again (`search_notes`) or propose a note or words (`add_note`, `add_words`). These only propose: the person confirms on screen before anything is saved.
7. **Evaluate.** 25 questions with the words a good passage must contain. `npm run languages:eval` prints hit@1, hit@3 and hit@5 for keyword-only search and for the hybrid search.

## Where the code is
| Step | Files |
| --- | --- |
| Ingest | `scripts/languages/ingest.ts`, `src/features/languages/chunk.ts`, `pdf.server.ts` |
| Embed | `embed()` in `src/features/gym/ai-provider.server.ts` |
| Retrieve | `migrations/0013_language_notes.sql` (`search_language`), `src/features/languages/search.ts` |
| Generate, check, tools | `chat.ts`, `chat-engine.ts`, `chat.functions.ts` |
| Evaluate | `eval.ts`, `eval/cases.json`, `scripts/languages/eval.ts` |

## Questions you may get, and honest answers
- **Why hybrid search?** Vectors find paraphrases ("pizza base" for "Teig"); keywords find exact rare words and forms (a word list entry). Each misses cases the other catches. Run `languages:eval` to show the numbers instead of claiming it.
- **Why chunk by page for PDFs?** So a citation can say "p. 12" and be right.
- **How do you stop made-up citations?** The engine only accepts numbers it gave the model, and strips the rest. It does not prove the claim matches the passage; that is a known limit.
- **What about privacy?** Every table is private to the signed-in user (row-level security). Only the question, the matching passages and the last few turns go to the AI provider, never the whole library.
- **What does not work well?** Two-column PDF pages (the Goethe lists) are read line by line, so an entry and its example can share a piece. Scanned PDFs have no text. Grammar notes written by an AI chat can contain mistakes. The 25 questions are small and written by me, so the hit rates are indicative, not a benchmark.
- **What would you improve?** Split two-column pages by position, a larger and independent question set, re-ranking the top results with a model, and a check that each claim is supported by its cited passage.

## What not to claim
- Not "I wrote it all myself" (see above).
- Not "I trained a model": you used a pretrained embedding model and a pretrained chat model.
- Not a hit rate you have not measured: run `npm run languages:eval` and quote what it prints.
