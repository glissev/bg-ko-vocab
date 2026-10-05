import {
  isInitialsQuery,
  normBg,
  normKo,
  parsePos,
  suggestRomanization,
} from '../../shared/lang';
import {
  BG_GENDERS,
  MAX_ENTRIES_PER_REQUEST,
  PARTS_OF_SPEECH,
  type Entry,
  type EntryInput,
} from '../../shared/types';
import { api } from '../api';
import { h, trackImeEnter } from '../dom';
import { speakButton } from '../speech';
import { store } from '../store';

const POS_LABELS: Record<string, string> = {
  noun: 'Noun', verb: 'Verb', adjective: 'Adjective', adverb: 'Adverb', phrase: 'Phrase', other: 'Other',
};
const GENDER_LABELS: Record<string, string> = { м: 'м. (masculine)', ж: 'ж. (feminine)', ср: 'ср. (neuter)' };

const bgCollator = new Intl.Collator('bg');
const koCollator = new Intl.Collator('ko');

export function renderWords(root: HTMLElement): () => void {
  let editing: Entry | null = null;
  let romanTouched = false;

  // ---- Form --------------------------------------------------------------
  const bg = h('input', {
    id: 'bg', lang: 'bg', required: true, autocomplete: 'off', placeholder: 'къща',
  });
  const ko = h('input', {
    id: 'ko', lang: 'ko', required: true, autocomplete: 'off', placeholder: '집',
  });
  const roman = h('input', { id: 'roman', autocomplete: 'off', placeholder: 'Filled in as you type' });
  const hanja = h('input', { id: 'hanja', lang: 'ko', autocomplete: 'off', placeholder: '住宅' });
  const pos = h(
    'select', { id: 'pos' },
    h('option', { value: '' }, '—'),
    ...PARTS_OF_SPEECH.map((p) => h('option', { value: p }, POS_LABELS[p])),
  );
  const gender = h(
    'select', { id: 'gender' },
    h('option', { value: '' }, '—'),
    ...BG_GENDERS.map((g) => h('option', { value: g }, GENDER_LABELS[g])),
  );
  const note = h('textarea', { id: 'note', rows: 2, placeholder: 'Example sentence, speech level, particle' });
  const tags = h('input', { id: 'tags', autocomplete: 'off', placeholder: 'home, topik1' });
  const details = h(
    'details', { class: 'more' },
    h('summary', {}, 'More details'),
    h('div', { class: 'grid-2' },
      field('Hanja', hanja),
      field('Part of speech', pos),
      field('Gender (nouns)', gender),
      field('Tags', tags, 'Comma-separated'),
    ),
    field('Note', note),
  );
  const submit = h('button', { type: 'submit', class: 'primary' }, 'Add word');
  const cancel = h('button', { type: 'button', hidden: true, onclick: () => resetForm() }, 'Cancel');
  const status = h('p', { class: 'status', role: 'status' });

  ko.addEventListener('input', () => {
    if (!romanTouched) roman.value = suggestRomanization(ko.value);
  });
  roman.addEventListener('input', () => (romanTouched = roman.value.trim() !== ''));

  const form = h(
    'form', { class: 'entry-form', novalidate: true },
    h('h1', {}, 'Add a word'),
    h('div', { class: 'pair' },
      field('Bulgarian', bg, 'Verbs in 1st person: казвам / кажа'),
      field('Korean', ko, 'Dictionary form: 말하다'),
    ),
    field('Romanization', roman),
    details,
    h('p', { class: 'help' }, 'Separate accepted alternatives with ;'),
    h('div', { class: 'actions' }, submit, cancel),
    status,
  );
  const imeEnter = trackImeEnter(form);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (imeEnter()) return;
    if (!bg.value.trim() || !ko.value.trim()) {
      setStatus('Enter both the Bulgarian and the Korean word.', 'error');
      (bg.value.trim() ? ko : bg).focus();
      return;
    }
    const input: EntryInput = {
      bg_text: bg.value,
      ko_text: ko.value,
      ko_roman: roman.value || null,
      hanja: hanja.value || null,
      pos: (pos.value || null) as EntryInput['pos'],
      bg_gender: (gender.value || null) as EntryInput['bg_gender'],
      note: note.value || null,
      tags: tags.value || null,
    };
    submit.disabled = true;
    try {
      if (editing) {
        store.upsert(await api.updateEntry(editing.id, input));
        setStatus(`Saved ${input.bg_text} — ${input.ko_text}.`, 'ok');
        resetForm(false);
      } else {
        const res = await api.createEntries([input]);
        if (res.created.length) {
          store.upsert(...res.created);
          setStatus(`Added ${input.bg_text} — ${input.ko_text}.`, 'ok');
          resetForm(false, true);
        } else {
          setStatus(`${input.bg_text} — ${input.ko_text} is already in your vocabulary.`, 'error');
        }
      }
    } catch (err) {
      setStatus((err as Error).message, 'error');
    } finally {
      submit.disabled = false;
    }
  });

  function setStatus(message: string, kind: 'ok' | 'error') {
    status.textContent = message;
    status.dataset.kind = kind;
  }

  function resetForm(clearStatus = true, keepDetails = false) {
    editing = null;
    romanTouched = false;
    const keepTags = keepDetails ? tags.value : '';
    form.reset();
    tags.value = keepTags; // handy when entering a batch of words for one topic
    submit.textContent = 'Add word';
    cancel.hidden = true;
    form.querySelector('h1')!.textContent = 'Add a word';
    if (clearStatus) status.textContent = '';
    bg.focus();
  }

  function startEdit(entry: Entry) {
    editing = entry;
    bg.value = entry.bg_text;
    ko.value = entry.ko_text;
    roman.value = entry.ko_roman ?? '';
    romanTouched = true;
    hanja.value = entry.hanja ?? '';
    pos.value = entry.pos ?? '';
    gender.value = entry.bg_gender ?? '';
    note.value = entry.note ?? '';
    tags.value = entry.tags?.split(',').join(', ') ?? '';
    details.open = Boolean(entry.hanja || entry.pos || entry.bg_gender || entry.note || entry.tags);
    submit.textContent = 'Save changes';
    cancel.hidden = false;
    form.querySelector('h1')!.textContent = 'Edit word';
    status.textContent = '';
    form.scrollIntoView({ behavior: 'smooth', block: 'start' });
    bg.focus({ preventScroll: true });
  }

  // ---- List --------------------------------------------------------------
  const search = h('input', {
    type: 'search', placeholder: 'Search in Bulgarian, Korean, romanization or ㅎㄱ', 'aria-label': 'Search words',
  });
  const sort = h(
    'select', { 'aria-label': 'Sort' },
    h('option', { value: 'new' }, 'Newest first'),
    h('option', { value: 'bg' }, 'Bulgarian А–Я'),
    h('option', { value: 'ko' }, 'Korean ㄱ–ㅎ'),
  );
  const count = h('p', { class: 'count' });
  const list = h('ul', { class: 'word-list' });
  search.addEventListener('input', renderList);
  sort.addEventListener('change', renderList);

  function matches(entry: Entry, query: string): boolean {
    const qKo = normKo(query);
    if (isInitialsQuery(qKo)) return entry.ko_initials.replace(/\|/g, ' ').includes(qKo);
    const qBg = normBg(query);
    const qRoman = query.toLowerCase().replace(/\s+/g, '');
    return (
      (qBg !== '' && entry.bg_norm.includes(qBg)) ||
      (qKo !== '' && entry.ko_norm.includes(qKo)) ||
      (qRoman !== '' && (entry.ko_roman ?? '').toLowerCase().replace(/\s+/g, '').includes(qRoman)) ||
      (qKo !== '' && (entry.tags ?? '').includes(qKo))
    );
  }

  function renderList() {
    const query = search.value.trim();
    let rows = [...store.entries];
    if (query) rows = rows.filter((e) => matches(e, query));
    if (sort.value === 'bg') rows.sort((a, b) => bgCollator.compare(a.bg_text, b.bg_text));
    else if (sort.value === 'ko') rows.sort((a, b) => koCollator.compare(a.ko_text, b.ko_text));
    else rows.sort((a, b) => b.id - a.id);

    const total = store.entries.length;
    count.textContent = query ? `${rows.length} of ${total} words` : `${total} words`;
    const shown = rows.slice(0, 300);
    list.replaceChildren(
      ...shown.map((entry) =>
        h('li', {},
          h('div', { class: 'bg-side' },
            h('span', { lang: 'bg', class: 'word' }, entry.bg_text),
            entry.bg_gender ? h('span', { class: 'meta', lang: 'bg' }, ` ${entry.bg_gender}.`) : null,
          ),
          h('div', { class: 'ko-side' },
            h('span', { lang: 'ko', class: 'word' }, entry.ko_text),
            entry.hanja ? h('span', { class: 'meta', lang: 'ko' }, ` ${entry.hanja}`) : null,
            entry.ko_roman ? h('span', { class: 'roman' }, entry.ko_roman) : null,
          ),
          h('div', { class: 'row-actions' },
            speakButton(entry.ko_text, 'ko'),
            h('button', { type: 'button', onclick: () => startEdit(entry) }, 'Edit'),
            h('button', { type: 'button', class: 'danger', onclick: () => remove(entry) }, 'Delete'),
          ),
        ),
      ),
    );
    if (rows.length > shown.length) {
      list.append(h('li', { class: 'more-rows' }, `${rows.length - shown.length} more — refine the search to see them.`));
    }
    if (total === 0) {
      list.replaceChildren(h('li', { class: 'empty' }, 'Your vocabulary is empty. Add your first word above, or paste a list under Import.'));
    }
  }

  async function remove(entry: Entry) {
    if (!confirm(`Delete ${entry.bg_text} — ${entry.ko_text} and its practice history?`)) return;
    try {
      await api.deleteEntry(entry.id);
      store.remove(entry.id);
      if (editing?.id === entry.id) resetForm();
    } catch (err) {
      alert((err as Error).message);
    }
  }

  // ---- Import & backup ---------------------------------------------------
  const importBox = h('textarea', {
    rows: 6,
    placeholder: 'къща = 집\nказвам / кажа = 말하다\nблагодаря = 감사합니다; 고마워요',
    'aria-label': 'Words to import',
  });
  const importTags = h('input', { autocomplete: 'off', placeholder: 'Optional tags for all imported words' });
  const importBtn = h('button', { type: 'button', class: 'primary', onclick: runImport }, 'Import words');
  const importStatus = h('p', { class: 'status', role: 'status' });

  /** Unrecognized part-of-speech labels are dropped (and reported) so one odd cell can't fail a batch. */
  function parseImport(raw: string): { items: EntryInput[]; unknownPos: string[] } {
    const unknownPos = new Set<string>();
    const items = raw
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line): EntryInput => {
        // Tab-separated (pasted from a spreadsheet): bg, ko, romanization, hanja, pos, note, tags
        if (line.includes('\t')) {
          const [bg_text, ko_text, ko_roman, hanja, p, note, t] = line.split('\t').map((c) => c.trim() || null);
          const pos = parsePos(p);
          if (p && !pos) unknownPos.add(p);
          return { bg_text: bg_text ?? '', ko_text: ko_text ?? '', ko_roman, hanja, pos, note, tags: t ?? (importTags.value || null) };
        }
        const [bg_text, ko_text = ''] = line.split(/\s*=\s*/);
        return { bg_text, ko_text, tags: importTags.value || null };
      });
    return { items, unknownPos: [...unknownPos] };
  }

  async function runImport() {
    const { items, unknownPos } = parseImport(importBox.value);
    const invalid = items.filter((i) => !i.bg_text.trim() || !i.ko_text.trim());
    if (!items.length) return;
    if (invalid.length) {
      importStatus.dataset.kind = 'error';
      importStatus.textContent = `${invalid.length} line(s) are missing one side, e.g. "${invalid[0].bg_text || invalid[0].ko_text}". Use: българска дума = 한국어 단어`;
      return;
    }
    importBtn.disabled = true;
    let created = 0;
    const skipped: string[] = [];
    try {
      for (let i = 0; i < items.length; i += MAX_ENTRIES_PER_REQUEST) {
        importStatus.textContent = `Importing ${Math.min(i + MAX_ENTRIES_PER_REQUEST, items.length)} of ${items.length}…`;
        const res = await api.createEntries(items.slice(i, i + MAX_ENTRIES_PER_REQUEST));
        store.upsert(...res.created);
        created += res.created.length;
        skipped.push(...res.skipped.map((s) => `${s.bg_text} — ${s.ko_text}`));
      }
      importStatus.dataset.kind = 'ok';
      importStatus.textContent =
        `Imported ${created} word(s).` +
        (skipped.length ? ` Skipped ${skipped.length} already in your vocabulary: ${skipped.join(', ')}.` : '') +
        (unknownPos.length ? ` Part of speech left empty where it said: ${unknownPos.join(', ')}.` : '');
      importBox.value = '';
    } catch (err) {
      importStatus.dataset.kind = 'error';
      importStatus.textContent = `Imported ${created} before an error: ${(err as Error).message}`;
    } finally {
      importBtn.disabled = false;
    }
  }

  const importSection = h(
    'details', { class: 'import' },
    h('summary', {}, 'Import and backup'),
    h('p', { class: 'help' },
      'One pair per line as ', h('code', {}, 'български = 한국어'),
      ', or paste rows from a spreadsheet with columns: Bulgarian, Korean, romanization, hanja, part of speech, note, tags.'),
    importBox,
    field('Tags', importTags),
    h('div', { class: 'actions' }, importBtn, h('a', { href: '/api/export', class: 'button' }, 'Download backup')),
    importStatus,
  );

  root.append(
    form,
    h('section', { class: 'list-section', 'aria-label': 'Your words' },
      h('div', { class: 'list-tools' }, search, sort),
      count,
      list,
    ),
    importSection,
  );
  renderList();
  bg.focus();
  return store.subscribe(renderList);
}

function field(label: string, control: HTMLElement, help?: string) {
  return h('label', { class: 'field' },
    h('span', { class: 'label' }, label),
    control,
    help ? h('span', { class: 'help' }, help) : null,
  );
}
