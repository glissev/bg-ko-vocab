import { Hono } from 'hono';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { deriveColumns, suggestRomanization } from '../shared/lang';
import {
  BG_GENDERS,
  MAX_ENTRIES_PER_REQUEST,
  PARTS_OF_SPEECH,
  type AnswerResult,
  type CreateResponse,
  type Direction,
  type Entry,
  type EntryInput,
  type QuizCard,
} from '../shared/types';

export interface Env {
  DB: D1Database;
  /** e.g. https://yourteam.cloudflareaccess.com */
  ACCESS_TEAM_DOMAIN?: string;
  /** Application Audience (AUD) tag from the Access application. */
  ACCESS_AUD?: string;
  /** 'true' only in local .dev.vars */
  DEV_BYPASS_AUTH?: string;
}

const app = new Hono<{ Bindings: Env }>().basePath('/api');

// ---------------------------------------------------------------------------
// Auth: every request must carry a valid Cloudflare Access token.
// ---------------------------------------------------------------------------

let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

app.use('*', async (c, next) => {
  if (c.env.DEV_BYPASS_AUTH === 'true') return next();

  const team = c.env.ACCESS_TEAM_DOMAIN?.replace(/\/$/, '');
  const aud = c.env.ACCESS_AUD;
  if (!team || !aud) {
    return c.json({ error: 'Access is not configured: set ACCESS_TEAM_DOMAIN and ACCESS_AUD.' }, 500);
  }
  const token = c.req.header('Cf-Access-Jwt-Assertion');
  if (!token) return c.json({ error: 'Not signed in. Reload the page to sign in.' }, 401);

  jwks ??= createRemoteJWKSet(new URL(`${team}/cdn-cgi/access/certs`));
  try {
    await jwtVerify(token, jwks, { issuer: team, audience: aud });
  } catch {
    return c.json({ error: 'Sign-in expired or invalid. Reload the page to sign in again.' }, 403);
  }
  return next();
});

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

class InputError extends Error {}

function text(value: unknown, field: string, max: number, required = false): string | null {
  if (value === undefined || value === null || value === '') {
    if (required) throw new InputError(`${field} is required.`);
    return null;
  }
  if (typeof value !== 'string') throw new InputError(`${field} must be text.`);
  const t = value.trim();
  if (required && !t) throw new InputError(`${field} is required.`);
  if (t.length > max) throw new InputError(`${field} is longer than ${max} characters.`);
  return t || null;
}

function cleanEntry(raw: unknown): Omit<Entry, 'id' | 'created_at' | 'updated_at'> {
  if (!raw || typeof raw !== 'object') throw new InputError('Each entry must be an object.');
  const r = raw as Record<string, unknown>;

  const bg_text = text(r.bg_text, 'Bulgarian', 200, true)!;
  const ko_text = text(r.ko_text, 'Korean', 200, true)!;

  const pos = text(r.pos, 'Part of speech', 20);
  if (pos && !(PARTS_OF_SPEECH as readonly string[]).includes(pos)) {
    throw new InputError(`Part of speech must be one of: ${PARTS_OF_SPEECH.join(', ')}.`);
  }
  const bg_gender = text(r.bg_gender, 'Gender', 2);
  if (bg_gender && !(BG_GENDERS as readonly string[]).includes(bg_gender)) {
    throw new InputError(`Gender must be one of: ${BG_GENDERS.join(', ')}.`);
  }
  const tags = text(r.tags, 'Tags', 200);

  return {
    bg_text,
    ko_text,
    ko_roman: text(r.ko_roman, 'Romanization', 200) ?? (suggestRomanization(ko_text) || null),
    hanja: text(r.hanja, 'Hanja', 100),
    pos: pos as Entry['pos'],
    bg_gender: bg_gender as Entry['bg_gender'],
    note: text(r.note, 'Note', 1000),
    tags: tags
      ? [...new Set(tags.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean))].join(',') || null
      : null,
    ...deriveColumns(bg_text, ko_text),
  };
}

const COLUMNS = [
  'bg_text', 'ko_text', 'ko_roman', 'hanja', 'pos', 'bg_gender',
  'note', 'tags', 'bg_norm', 'ko_norm', 'ko_initials',
] as const;

app.onError((err, c) => {
  if (err instanceof InputError) return c.json({ error: err.message }, 400);
  if (String(err).includes('UNIQUE constraint failed')) {
    return c.json({ error: 'That Bulgarian–Korean pair is already in your vocabulary.' }, 409);
  }
  console.error(err);
  return c.json({ error: 'Server error. Check the Worker logs.' }, 500);
});

// ---------------------------------------------------------------------------
// Entries
// ---------------------------------------------------------------------------

app.get('/entries', async (c) => {
  const { results } = await c.env.DB.prepare('SELECT * FROM entries ORDER BY id').all<Entry>();
  return c.json(results);
});

app.post('/entries', async (c) => {
  const body = await c.req.json();
  const items: unknown[] = Array.isArray(body) ? body : [body];
  if (items.length === 0) throw new InputError('Nothing to add.');
  if (items.length > MAX_ENTRIES_PER_REQUEST) {
    throw new InputError(`Send at most ${MAX_ENTRIES_PER_REQUEST} entries per request.`);
  }
  const rows = items.map(cleanEntry);

  const sql = `INSERT INTO entries (${COLUMNS.join(', ')})
               VALUES (${COLUMNS.map(() => '?').join(', ')})
               ON CONFLICT(ko_norm, bg_norm) DO NOTHING
               RETURNING *`;
  const stmt = c.env.DB.prepare(sql);
  const results = await c.env.DB.batch<Entry>(rows.map((r) => stmt.bind(...COLUMNS.map((k) => r[k]))));

  const response: CreateResponse = { created: [], skipped: [] };
  results.forEach((res, i) => {
    const row = res.results[0];
    if (row) response.created.push(row);
    else response.skipped.push({ bg_text: rows[i].bg_text, ko_text: rows[i].ko_text, reason: 'Already in vocabulary' });
  });
  return c.json(response, 201);
});

app.put('/entries/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const r = cleanEntry(await c.req.json());
  const row = await c.env.DB.prepare(
    `UPDATE entries SET ${COLUMNS.map((k) => `${k} = ?`).join(', ')}, updated_at = datetime('now')
     WHERE id = ? RETURNING *`,
  )
    .bind(...COLUMNS.map((k) => r[k]), id)
    .first<Entry>();
  if (!row) return c.json({ error: 'Entry not found.' }, 404);
  return c.json(row);
});

app.delete('/entries/:id', async (c) => {
  const id = Number(c.req.param('id'));
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM progress WHERE entry_id = ?').bind(id),
    c.env.DB.prepare('DELETE FROM entries WHERE id = ?').bind(id),
  ]);
  return c.body(null, 204);
});

// ---------------------------------------------------------------------------
// Quiz
// ---------------------------------------------------------------------------

/** Leitner intervals in days for boxes 1..5. */
const INTERVAL_DAYS = [1, 2, 4, 8, 16];
const MAX_BOX = INTERVAL_DAYS.length;

function tagFilter(tag: string | null) {
  return tag
    ? { sql: `AND (',' || IFNULL(e.tags, '') || ',') LIKE ?`, args: [`%,${tag.toLowerCase()},%`] }
    : { sql: '', args: [] as string[] };
}

/** Due cards first, then never-practised ones, then the ones due soonest. */
async function pickCards(db: D1Database, direction: Direction, n: number, tag: string | null): Promise<QuizCard[]> {
  const t = tagFilter(tag);
  const cards: QuizCard[] = [];
  const add = (rows: (Entry & { box: number | null })[]) => {
    for (const { box, ...entry } of rows) cards.push({ entry: entry as Entry, direction, box });
  };

  const due = await db
    .prepare(
      `SELECT e.*, p.box FROM progress p JOIN entries e ON e.id = p.entry_id
       WHERE p.direction = ? AND p.due_at <= datetime('now') ${t.sql}
       ORDER BY p.due_at LIMIT ?`,
    )
    .bind(direction, ...t.args, n)
    .all<Entry & { box: number }>();
  add(due.results);

  if (cards.length < n) {
    const fresh = await db
      .prepare(
        `SELECT e.*, NULL AS box FROM entries e
         LEFT JOIN progress p ON p.entry_id = e.id AND p.direction = ?
         WHERE p.entry_id IS NULL ${t.sql}
         ORDER BY random() LIMIT ?`,
      )
      .bind(direction, ...t.args, n - cards.length)
      .all<Entry & { box: null }>();
    add(fresh.results);
  }

  if (cards.length < n) {
    const upcoming = await db
      .prepare(
        `SELECT e.*, p.box FROM progress p JOIN entries e ON e.id = p.entry_id
         WHERE p.direction = ? AND p.due_at > datetime('now') ${t.sql}
         ORDER BY p.due_at LIMIT ?`,
      )
      .bind(direction, ...t.args, n - cards.length)
      .all<Entry & { box: number }>();
    add(upcoming.results);
  }
  return cards;
}

function shuffle<T>(items: T[]): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

app.get('/quiz', async (c) => {
  const dir = c.req.query('dir') ?? 'mixed';
  const n = Math.min(Math.max(Number(c.req.query('n')) || 20, 1), 100);
  const tag = c.req.query('tag') || null;

  let cards: QuizCard[];
  if (dir === 'bg2ko' || dir === 'ko2bg') {
    cards = await pickCards(c.env.DB, dir, n, tag);
  } else {
    const half = Math.ceil(n / 2);
    const [a, b] = await Promise.all([
      pickCards(c.env.DB, 'bg2ko', half, tag),
      pickCards(c.env.DB, 'ko2bg', n - half, tag),
    ]);
    cards = [...a, ...b];
  }
  return c.json(shuffle(cards));
});

app.post('/quiz/answer', async (c) => {
  const body = await c.req.json<{ entry_id: number; direction: Direction; result: AnswerResult }>();
  const { entry_id, direction, result } = body;
  if (!['bg2ko', 'ko2bg'].includes(direction)) throw new InputError('Unknown direction.');
  if (!['correct', 'hinted', 'wrong'].includes(result)) throw new InputError('Unknown result.');

  const current = await c.env.DB.prepare('SELECT box FROM progress WHERE entry_id = ? AND direction = ?')
    .bind(entry_id, direction)
    .first<{ box: number }>();
  const box = current?.box ?? 1;

  let nextBox = box;
  let dueModifier = '+0 seconds'; // wrong: due again right away
  if (result === 'correct') {
    nextBox = current ? Math.min(box + 1, MAX_BOX) : 2; // first-time correct skips box 1
    dueModifier = `+${INTERVAL_DAYS[nextBox - 1]} days`;
  } else if (result === 'hinted') {
    dueModifier = `+${INTERVAL_DAYS[box - 1]} days`;
  } else {
    nextBox = 1;
  }

  const row = await c.env.DB.prepare(
    `INSERT INTO progress (entry_id, direction, box, due_at, correct, wrong)
     VALUES (?, ?, ?, datetime('now', ?), ?, ?)
     ON CONFLICT(entry_id, direction) DO UPDATE SET
       box = excluded.box,
       due_at = excluded.due_at,
       correct = progress.correct + excluded.correct,
       wrong = progress.wrong + excluded.wrong
     RETURNING *`,
  )
    .bind(entry_id, direction, nextBox, dueModifier, result === 'wrong' ? 0 : 1, result === 'wrong' ? 1 : 0)
    .first();
  return c.json(row);
});

// ---------------------------------------------------------------------------
// Backup
// ---------------------------------------------------------------------------

app.get('/export', async (c) => {
  const [entries, progress] = await c.env.DB.batch([
    c.env.DB.prepare('SELECT * FROM entries ORDER BY id'),
    c.env.DB.prepare('SELECT * FROM progress'),
  ]);
  const date = new Date().toISOString().slice(0, 10);
  c.header('Content-Disposition', `attachment; filename="bg-ko-vocab-${date}.json"`);
  return c.json({ exported_at: new Date().toISOString(), entries: entries.results, progress: progress.results });
});

export default app;
