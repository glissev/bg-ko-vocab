# Думи 단어

A personal Bulgarian–Korean vocabulary trainer. Static front end on Cloudflare Pages,
API in Pages Functions (Hono), data in Cloudflare D1, login through Cloudflare Access.
Runs on the free plans.

## Project layout

```
.github/workflows/ci.yml     checks every push; optional deploy to Cloudflare
migrations/0001_init.sql     D1 schema (entries, progress)
shared/lang.ts               normalization, answer checking, hints, initials (used by both sides)
shared/types.ts              shared types
server/app.ts                API: entries CRUD, quiz selection, Leitner scheduling, export
functions/api/[[route]].ts   mounts the API at /api/* on Cloudflare Pages
src/                         front end (vanilla TypeScript + Vite)
  views/words.ts             add / edit / search / import
  views/practice.ts          quiz session
tests/lang.test.ts           unit tests for the language helpers
```

## Run locally

Requires Node 22 or newer (see `.nvmrc`).

```bash
npm install
cp .dev.vars.example .dev.vars        # turns off the Access check locally
npm run db:migrate:local
npm run dev                           # open http://localhost:5173
```

`npm test` runs the language tests, `npm run typecheck` checks both the browser and Worker code.

## First-time Cloudflare setup

1. Log in and create the database:
   ```bash
   npx wrangler login
   npx wrangler d1 create bg-ko-vocab
   ```
   Paste the printed `database_id` into `wrangler.toml` and commit it. The id is not a
   secret: nothing can reach the database without your Cloudflare credentials.

2. Create the Pages project:
   ```bash
   npx wrangler pages project create bg-ko-vocab --production-branch main
   ```

3. Protect the site with Cloudflare Access (Zero Trust, free plan):
   - In the Cloudflare dashboard, open Zero Trust and add a **self-hosted application**
     for `bg-ko-vocab.pages.dev`. Add `*.bg-ko-vocab.pages.dev` too, so preview deployments
     are protected.
   - Add a policy: **Allow**, include **Emails** → your email address. One-time PIN login is
     enough.
   - Copy the application's **Audience (AUD) tag** and your team domain
     (`https://<team>.cloudflareaccess.com`), then store them as Pages secrets:
     ```bash
     npx wrangler pages secret put ACCESS_AUD --project-name bg-ko-vocab
     npx wrangler pages secret put ACCESS_TEAM_DOMAIN --project-name bg-ko-vocab
     ```

Until Access is configured, the API refuses every request. Never set `DEV_BYPASS_AUTH`
outside `.dev.vars`.

## Deploying

**From your machine:**

```bash
npm run db:migrate:remote
npm run deploy
```

**Automatically from GitHub:** every push and pull request runs typecheck, tests and build
(`.github/workflows/ci.yml`). To also deploy on every push to `main`:

1. Create a Cloudflare API token (My Profile → API Tokens → Create Token → Custom) with
   **Account → Cloudflare Pages → Edit** and **Account → D1 → Edit**.
2. In the GitHub repository, open Settings → Secrets and variables → Actions and add:
   - secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` (shown on the Cloudflare
     dashboard overview);
   - variable `CLOUDFLARE_DEPLOY` with the value `true`.

The deploy job applies any new migrations, then publishes the site.

## Entering words

- Bulgarian verbs in the 1st person singular, with aspect pairs as `казвам / кажа`.
  Korean verbs and adjectives in dictionary form (`말하다`).
- Separate accepted alternatives with `;` — `감사합니다; 고마워요`. Either one counts as correct.
- Homonyms are separate entries: `배 = круша`, `배 = кораб`, `배 = корем`. Only the exact same
  pair is rejected as a duplicate. In practice, typing another meaning of the same word isn't
  counted as wrong; the app tells you it's a different card and lets you try again.
- Romanization is filled in automatically and can be edited.
- Import: one pair per line as `къща = 집`, or paste spreadsheet rows (tab-separated):
  Bulgarian, Korean, romanization, hanja, part of speech, note, tags. Part of speech can be
  written in English, Bulgarian or Korean (`noun`, `същ.`, `명사`); unrecognized labels are
  left empty and listed after the import.

## How practice works

- Each word is tracked separately in both directions (Bulgarian → Korean and back).
- Sessions take due words first, then new ones, then those due soonest.
- Correct moves a word up a box (due again in 1, 2, 4, 8, 16 days). A correct answer after a
  hint keeps it in its box. Wrong sends it back to box 1 and it comes back once more at the end
  of the session.
- Answers ignore case, Bulgarian stress marks, Korean spacing and punctuation. Near misses
  (one or two letters off, measured per jamo for Korean) let you decide whether it was a typo.

## Free-plan notes

- D1 on the Workers Free plan allows 50 queries per request, so imports are sent in batches of 40.
- The free plan has daily D1 read and write limits; the app keeps the whole vocabulary cached
  in the browser and searches locally, so normal use stays far below them.
- `Download backup` (under Import and backup) exports everything as JSON.

## Changing the database

Add a new numbered file to `migrations/` (for example `0002_add_examples.sql`) rather than
editing `0001_init.sql`. Run `npm run db:migrate:local` to try it; the GitHub deploy job
(or `npm run db:migrate:remote`) applies it to production.

## Ideas for next steps

- A service worker so the app opens offline, with answers queued until you're back online.
- Restore from a backup file.
- A listening mode: play the Korean word and type what you hear.
