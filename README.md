# Lifeplan

A personal planner for training and food. It started as a gym planner and grew a pantry, an illustrated kitchen and an AI chat that can edit your plan.

## What it does

- **Training:** sessions with sets, reps and weight, an exercise library (38 seeded, about 850 more with the optional import), workout logging with progress charts, week and month views, a body-weight log.
- **Pantry:** items by place with expiry markers, receipt import (paste, PDF, HTML, or a photo read in your browser), a product dictionary that learns from your corrections, and a kitchen view to browse it.
- **Cooking:** recipes with rough calories and protein, what you can cook from what you have, and used food is removed when you cook.
- **AI chat (optional):** adds, swaps and schedules sessions, and helps with cooking. It needs your own API key.
- Installs on a phone as a PWA, with an offline copy of the plan.

Built with TanStack Start (React 19), Vite, Tailwind, shadcn/Radix and Supabase (auth and Postgres with row-level security).

## Run it

You need Node 22 or newer and a free Supabase project.

1. `npm install`
2. In Supabase, open **SQL Editor** and run `setup.sql` once. Then run the files in `migrations/` one by one, in order (`0002` to `0012`). `MANUAL_STEPS.md` says what each one adds.
3. Copy `.env.example` to `.env` and fill in the project URL and publishable key (Supabase, Project Settings, API). Never use the `service_role` key.
4. In Supabase, Authentication, URL Configuration, add `http://localhost:5173/**`.
5. `npm run dev`

Email sign-in works right away. Google sign-in needs a few more steps, listed in `MANUAL_STEPS.md`.

## AI chat: bring your own key

The app ships without a key, so each person uses their own. Create one in [Google AI Studio](https://aistudio.google.com/apikey) and add it to `.env`:

```
AI_API_KEY=your-key
```

Gemini is the default. For another provider with an OpenAI-compatible API (OpenAI, OpenRouter, a local Ollama server), set `AI_PROVIDER=openai-compatible`, `AI_BASE_URL` and `AI_MODEL`. The other options are described in `.env.example`.

The key stays on the server and never reaches the browser. If you leave it out, everything else works and the chat says it is unavailable. If it reports "no quota left", see section 4 of `MANUAL_STEPS.md`.

## Deploy

Vercel or Cloudflare Pages. Steps and the environment variables are in `DEPLOY.md`.

## Commands

| Command | |
| --- | --- |
| `npm run dev` | dev server |
| `npm run build` | production build |
| `npm test` | tests |
| `npm run lint` | lint |

## Layout

- `src/routes/`: file-based routes
- `src/features/gym/`: training data, AI tools, exercise browser
- `src/features/pantry/`: items, dictionary, receipts, OCR
- `src/features/cook/`: recipes and nutrition
- `src/features/kitchen/`: the kitchen view
- `setup.sql`, `migrations/`: database
- `docs/features.md`: notes on the pantry, receipts, OCR and the exercise import

## Credits

Product pictures are Twemoji (CC-BY 4.0). Exercise data comes from free-exercise-db, nutrition values from USDA FoodData Central, and photo OCR from tesseract.js.

## License

MIT, see `LICENSE`.
