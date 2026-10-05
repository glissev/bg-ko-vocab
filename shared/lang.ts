import { romanize } from 'es-hangul';
import type { PartOfSpeech } from './types';

export type Lang = 'bg' | 'ko';

// ---------------------------------------------------------------------------
// Normalization
// ---------------------------------------------------------------------------

// Latin letters that look identical to Cyrillic ones; typed by accident when the
// keyboard layout is wrong. Applied after lowercasing.
const LATIN_LOOKALIKES: Record<string, string> = {
  a: 'а', e: 'е', o: 'о', p: 'р', c: 'с', x: 'х', y: 'у',
};

/** Lowercase, strip stress marks and punctuation, fix Latin lookalikes. */
export function normBg(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300\u0301]/g, '') // stress marks; also lets 'и' match 'ѝ'
    .normalize('NFC')
    .toLocaleLowerCase('bg')
    .replace(/[aeopcxy]/g, (ch) => LATIN_LOOKALIKES[ch])
    .replace(/[^\p{L}\p{N} ]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Compose syllables, drop spacing (띄어쓰기) and punctuation. */
export function normKo(s: string): string {
  return s.normalize('NFC').replace(/[^\p{L}\p{N}]/gu, '').toLowerCase();
}

export function norm(s: string, lang: Lang): string {
  return lang === 'bg' ? normBg(s) : normKo(s);
}

/** Split 'a; b' and aspect pairs 'казвам / кажа' into accepted alternatives. */
export function splitAlternatives(s: string): string[] {
  return s
    .split(/[;/]/)
    .map((t) => t.trim())
    .filter(Boolean);
}

// ---------------------------------------------------------------------------
// Korean helpers
// ---------------------------------------------------------------------------

const CHOSEONG = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ';

/** 한국어 → ㅎㄱㅇ. Non-Hangul characters (spaces, Latin) are kept as they are. */
export function initials(s: string): string {
  return [...s.normalize('NFC')]
    .map((ch) => {
      const code = ch.charCodeAt(0) - 0xac00;
      return code >= 0 && code < 11172 ? CHOSEONG[Math.floor(code / 588)] : ch;
    })
    .join('');
}

/** True when the string is only initial consonants, e.g. a search for 'ㅎㄱ'. */
export function isInitialsQuery(s: string): boolean {
  return /^[ㄱ-ㅎ]+$/.test(s);
}

export function suggestRomanization(koText: string): string {
  return splitAlternatives(koText)
    .map((alt) => {
      try {
        return romanize(alt);
      } catch {
        return '';
      }
    })
    .filter(Boolean)
    .join('; ');
}

/**
 * True when two normalized columns (bg_norm or ko_norm) share any alternative,
 * e.g. the ko_norm of 배 = круша and 배 = кораб.
 */
export function sharesAlternative(aNorm: string, bNorm: string): boolean {
  const a = new Set(aNorm.split('|'));
  return bNorm.split('|').some((alt) => a.has(alt));
}

/** Columns the server stores alongside the user's text. */
export function deriveColumns(bgText: string, koText: string) {
  const ko = splitAlternatives(koText);
  return {
    bg_norm: splitAlternatives(bgText).map(normBg).join('|'),
    ko_norm: ko.map(normKo).join('|'),
    ko_initials: ko.map((alt) => initials(normKo(alt))).join('|'),
  };
}

// ---------------------------------------------------------------------------
// Answer checking
// ---------------------------------------------------------------------------

export function levenshtein(a: string, b: string): number {
  const x = [...a];
  const y = [...b];
  let prev = Array.from({ length: y.length + 1 }, (_, i) => i);
  for (let i = 1; i <= x.length; i++) {
    const cur = [i];
    for (let j = 1; j <= y.length; j++) {
      cur[j] = Math.min(
        prev[j] + 1,
        cur[j - 1] + 1,
        prev[j - 1] + (x[i - 1] === y[j - 1] ? 0 : 1),
      );
    }
    prev = cur;
  }
  return prev[y.length];
}

export type Verdict =
  | { verdict: 'correct'; matched: string }
  | { verdict: 'close'; matched: string; distance: number }
  | { verdict: 'wrong' };

/**
 * Compare the typed answer with every accepted alternative.
 * Korean near-misses are measured on jamo (NFD), so one wrong batchim
 * (한 vs 학) counts as a single error instead of a whole syllable.
 */
export function checkAnswer(input: string, expected: string, lang: Lang): Verdict {
  const typed = norm(input, lang);
  if (!typed) return { verdict: 'wrong' };

  const alternatives = splitAlternatives(expected);
  for (const alt of alternatives) {
    if (norm(alt, lang) === typed) return { verdict: 'correct', matched: alt };
  }

  let best: Verdict = { verdict: 'wrong' };
  let bestDistance = Infinity;
  for (const alt of alternatives) {
    const target = norm(alt, lang);
    const a = lang === 'ko' ? typed.normalize('NFD') : typed;
    const b = lang === 'ko' ? target.normalize('NFD') : target;
    const tolerance = [...b].length <= 5 ? 1 : 2;
    const d = levenshtein(a, b);
    if (d <= tolerance && d < bestDistance) {
      bestDistance = d;
      best = { verdict: 'close', matched: alt, distance: d };
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Hints
// ---------------------------------------------------------------------------

/**
 * Level 1: Korean → initial consonants (ㅎㄱㅇ); Bulgarian → first letter + blanks.
 * Level 2: Korean → first syllable + initials of the rest; Bulgarian → first half.
 */
export function hint(expected: string, lang: Lang, level: 1 | 2): string {
  const target = splitAlternatives(expected)[0] ?? '';
  const chars = [...target.normalize('NFC')];

  if (lang === 'ko') {
    return level === 1 ? initials(target) : chars[0] + initials(chars.slice(1).join(''));
  }

  const letters = chars.filter((ch) => /\p{L}/u.test(ch)).length;
  const reveal = level === 1 ? 1 : Math.max(2, Math.ceil(letters / 2));
  let shown = 0;
  return chars
    .map((ch) => {
      if (!/\p{L}/u.test(ch)) return ch === ' ' ? '   ' : ch;
      shown++;
      return shown <= reveal ? ch : '_';
    })
    .join(' ')
    .replace(/ {3,}/g, '   ');
}

// ---------------------------------------------------------------------------
// Part of speech from imported spreadsheets
// ---------------------------------------------------------------------------

const POS_ALIASES: Record<string, PartOfSpeech> = {
  noun: 'noun', n: 'noun', съществително: 'noun', същ: 'noun', съществ: 'noun', 명사: 'noun',
  verb: 'verb', v: 'verb', глагол: 'verb', гл: 'verb', 동사: 'verb',
  adjective: 'adjective', adj: 'adjective', прилагателно: 'adjective', прил: 'adjective', 형용사: 'adjective',
  adverb: 'adverb', adv: 'adverb', наречие: 'adverb', нар: 'adverb', 부사: 'adverb',
  phrase: 'phrase', expression: 'phrase', израз: 'phrase', фраза: 'phrase', 표현: 'phrase',
  other: 'other', друго: 'other', 기타: 'other',
};

/**
 * Accepts English, Bulgarian or Korean labels and common abbreviations
 * ('Noun', 'същ.', '동사'). Returns null for empty or unrecognized input.
 */
export function parsePos(raw: string | null | undefined): PartOfSpeech | null {
  if (!raw) return null;
  const key = raw.trim().toLocaleLowerCase('bg').replace(/\.$/, '');
  return POS_ALIASES[key] ?? null;
}
