import { checkAnswer, hint, type Lang } from '../../shared/lang';
import type { AnswerResult, QuizCard, QuizDirection } from '../../shared/types';
import { api } from '../api';
import { h, trackImeEnter } from '../dom';
import { speakButton } from '../speech';
import { store } from '../store';

const DIRECTION_LABELS: Record<QuizDirection, string> = {
  bg2ko: 'Bulgarian → Korean',
  ko2bg: 'Korean → Bulgarian',
  mixed: 'Both directions',
};
const POS_BG: Record<string, string> = {
  noun: 'съществително', verb: 'глагол', adjective: 'прилагателно', adverb: 'наречие', phrase: 'израз', other: '',
};

interface SessionCard extends QuizCard {
  retry: boolean; // second chance at the end of the session; not recorded
}

interface Settings {
  dir: QuizDirection;
  n: number;
  tag: string | null;
}

let lastSettings: Settings = { dir: 'mixed', n: 20, tag: null };

export function renderPractice(root: HTMLElement): () => void {
  let disposed = false;
  const unsubscribe = store.subscribe(() => {
    // Refresh the tag list on the setup screen once the vocabulary has loaded.
    if (root.querySelector('.setup')) showSetup();
  });

  function showSetup() {
    root.replaceChildren();
    if (store.entries.length === 0) {
      root.append(
        h('section', { class: 'setup' },
          h('h1', {}, 'Practice'),
          h('p', {}, 'Add a few words first, then come back to practise them.'),
          h('a', { href: '#/words', class: 'button primary' }, 'Add words'),
        ),
      );
      return;
    }

    const radios = (Object.keys(DIRECTION_LABELS) as QuizDirection[]).map((dir) =>
      h('label', { class: 'choice' },
        h('input', { type: 'radio', name: 'dir', value: dir, checked: dir === lastSettings.dir }),
        DIRECTION_LABELS[dir],
      ),
    );
    const count = h('select', { id: 'count' },
      ...[10, 20, 40].map((n) => h('option', { value: String(n), selected: n === lastSettings.n }, `${n} words`)),
    );
    const tagSelect = h('select', { id: 'tag' },
      h('option', { value: '' }, 'All words'),
      ...store.tags().map((t) => h('option', { value: t, selected: t === lastSettings.tag }, t)),
    );
    const start = h('button', { type: 'submit', class: 'primary' }, 'Start practice');
    const error = h('p', { class: 'status', role: 'status', 'data-kind': 'error' });

    const form = h('form', { class: 'setup' },
      h('h1', {}, 'Practice'),
      h('fieldset', {}, h('legend', {}, 'Direction'), ...radios),
      h('div', { class: 'grid-2' },
        h('label', { class: 'field' }, h('span', { class: 'label' }, 'Session length'), count),
        h('label', { class: 'field' }, h('span', { class: 'label' }, 'Topic'), tagSelect),
      ),
      h('div', { class: 'actions' }, start),
      error,
    );
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const dir = (form.querySelector<HTMLInputElement>('input[name=dir]:checked')?.value ?? 'mixed') as QuizDirection;
      lastSettings = { dir, n: Number(count.value), tag: tagSelect.value || null };
      start.disabled = true;
      try {
        const cards = await api.quiz(lastSettings.dir, lastSettings.n, lastSettings.tag);
        if (disposed) return;
        if (!cards.length) {
          error.textContent = 'No words match this topic yet.';
          start.disabled = false;
          return;
        }
        runSession(cards.map((c) => ({ ...c, retry: false })), true);
      } catch (err) {
        error.textContent = (err as Error).message;
        start.disabled = false;
      }
    });
    root.append(form);
  }

  function runSession(queue: SessionCard[], record: boolean) {
    const total = queue.length;
    let index = 0;
    const firstTry = new Map<string, AnswerResult>();
    const missed: QuizCard[] = [];
    const key = (c: QuizCard) => `${c.entry.id}:${c.direction}`;

    const progress = h('p', { class: 'progress' });
    const bar = h('div', { class: 'bar' }, h('span', {}));
    const stage = h('section', { class: 'card', 'aria-live': 'polite' });
    const saveError = h('p', { class: 'status', role: 'status', 'data-kind': 'error' });
    root.replaceChildren(progress, bar, stage, saveError);

    function finish(card: SessionCard, result: AnswerResult) {
      if (!card.retry) {
        firstTry.set(key(card), result);
        if (result === 'wrong') {
          missed.push(card);
          queue.push({ ...card, retry: true }); // one more try at the end
        }
        if (record) {
          api.answer(card.entry.id, card.direction, result).catch((err) => {
            saveError.textContent = `Your answer wasn't saved: ${(err as Error).message}`;
          });
        }
      }
    }

    function next() {
      if (index >= queue.length) return showSummary();
      showCard(queue[index++]);
    }

    function showCard(card: SessionCard) {
      const answered = firstTry.size;
      progress.textContent = card.retry ? 'Second try' : `${answered + 1} of ${total}`;
      (bar.firstElementChild as HTMLElement).style.width = `${(answered / total) * 100}%`;

      const toKo = card.direction === 'bg2ko';
      const promptLang: Lang = toKo ? 'bg' : 'ko';
      const answerLang: Lang = toKo ? 'ko' : 'bg';
      const promptText = toKo ? card.entry.bg_text : card.entry.ko_text;
      const expected = toKo ? card.entry.ko_text : card.entry.bg_text;
      let hintLevel = 0;

      const meta = [
        toKo ? POS_BG[card.entry.pos ?? ''] : null,
        toKo && card.entry.bg_gender ? `${card.entry.bg_gender}. р.` : null,
      ].filter(Boolean).join(', ');

      const hintLine = h('p', { class: 'hint', lang: answerLang, 'aria-live': 'polite' });
      const input = h('input', {
        class: 'answer',
        lang: answerLang,
        autocomplete: 'off',
        autocapitalize: 'off',
        autocorrect: 'off',
        spellcheck: 'false',
        'aria-label': toKo ? 'Your answer in Korean' : 'Your answer in Bulgarian',
        placeholder: toKo ? '한국어로 입력' : 'Пиши на български',
      });
      const checkBtn = h('button', { type: 'submit', class: 'primary' }, 'Check');
      const hintBtn = h('button', { type: 'button', onclick: showHint }, 'Hint');
      const giveUp = h('button', { type: 'button', onclick: () => reveal('wrong', null) }, "Don't know");

      const form = h('form', { class: 'answer-form' },
        input, hintLine, h('div', { class: 'actions' }, checkBtn, hintBtn, giveUp),
      );
      const imeEnter = trackImeEnter(form);
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        if (imeEnter() || !input.value.trim()) return;
        const verdict = checkAnswer(input.value, expected, answerLang);
        if (verdict.verdict === 'correct') reveal(hintLevel ? 'hinted' : 'correct', null);
        else if (verdict.verdict === 'close') reveal(null, verdict.matched);
        else reveal('wrong', null);
      });

      function showHint() {
        hintLevel = Math.min(hintLevel + 1, 2);
        hintLine.textContent = hint(expected, answerLang, hintLevel as 1 | 2);
        if (hintLevel === 2) hintBtn.hidden = true;
        else hintBtn.textContent = 'Another hint';
        input.focus();
      }

      /** result === null means a near miss: the user decides. */
      function reveal(result: AnswerResult | null, closeTo: string | null) {
        input.disabled = true;
        form.querySelector('.actions')!.remove();
        const typed = input.value.trim();

        const verdictText =
          result === 'correct' ? 'Correct' :
          result === 'hinted' ? 'Correct, with a hint' :
          result === 'wrong' ? (typed ? 'Not quite' : 'The answer is') :
          'Almost — check the spelling';
        const kind = result === 'wrong' ? 'wrong' : result === null ? 'close' : 'right';
        stage.dataset.result = kind;

        const e = card.entry;
        const feedback = h('div', { class: 'feedback' },
          h('p', { class: 'verdict' }, verdictText),
          h('p', { class: 'solution' },
            h('span', { lang: 'ko', class: 'ko' }, e.ko_text),
            e.hanja ? h('span', { lang: 'ko', class: 'hanja' }, e.hanja) : null,
          ),
          e.ko_roman ? h('p', { class: 'roman' }, e.ko_roman) : null,
          h('p', { lang: 'bg', class: 'bg' }, e.bg_text, e.bg_gender ? ` (${e.bg_gender}.)` : ''),
          closeTo && typed ? h('p', { class: 'typed' }, 'You wrote: ', h('span', { lang: answerLang }, typed)) : null,
          e.note ? h('p', { class: 'note' }, e.note) : null,
          speakButton(e.ko_text, 'ko'),
        );

        const actions = h('div', { class: 'actions' });
        if (result === null) {
          const yes = h('button', { type: 'button', class: 'primary' }, 'Count as correct');
          const no = h('button', { type: 'button' }, 'Count as wrong');
          yes.onclick = () => { finish(card, hintLevel ? 'hinted' : 'correct'); next(); };
          no.onclick = () => { finish(card, 'wrong'); next(); };
          actions.append(yes, no);
          feedback.append(actions);
          stage.append(feedback);
          yes.focus();
        } else {
          finish(card, result);
          const nextBtn = h('button', { type: 'button', class: 'primary' }, 'Next');
          nextBtn.onclick = next;
          actions.append(nextBtn);
          feedback.append(actions);
          stage.append(feedback);
          nextBtn.focus();
        }
      }

      delete stage.dataset.result;
      stage.replaceChildren(...nodes(
        h('p', { class: 'direction' }, DIRECTION_LABELS[card.direction]),
        h('p', { class: 'prompt', lang: promptLang }, promptText),
        meta ? h('p', { class: 'meta', lang: 'bg' }, meta) : null,
        !toKo ? speakButton(card.entry.ko_text, 'ko') : null,
        form,
      ));
      input.focus();
    }

    function showSummary() {
      const results = [...firstTry.values()];
      const right = results.filter((r) => r === 'correct').length;
      const hinted = results.filter((r) => r === 'hinted').length;
      (bar.firstElementChild as HTMLElement).style.width = '100%';
      progress.textContent = 'Session complete';

      const again = h('button', { type: 'button', class: 'primary' }, 'Practise missed words');
      again.onclick = () => runSession(missed.map((c) => ({ ...c, retry: false })), false);
      const fresh = h('button', { type: 'button', onclick: showSetup }, 'New session');

      stage.dataset.result = 'summary';
      stage.replaceChildren(...nodes(
        h('p', { class: 'score' }, `${right + hinted} / ${total}`),
        h('p', { class: 'score-detail' },
          `${right} on the first try` + (hinted ? `, ${hinted} with a hint` : '') + `, ${missed.length} missed.`),
        missed.length
          ? h('ul', { class: 'missed' },
              ...missed.map((c) =>
                h('li', {}, h('span', { lang: 'bg' }, c.entry.bg_text), h('span', { lang: 'ko' }, c.entry.ko_text)),
              ))
          : null,
        record ? null : h('p', { class: 'help' }, 'Review rounds are not saved to your progress.'),
        h('div', { class: 'actions' }, missed.length ? again : null, fresh),
      ));
      (missed.length ? again : fresh).focus();
    }

    next();
  }

  showSetup();
  return () => {
    disposed = true;
    unsubscribe();
  };
}

function nodes(...items: (Node | null)[]): Node[] {
  return items.filter((n): n is Node => n !== null);
}
