import { describe, expect, it } from 'vitest';
import {
  checkAnswer, deriveColumns, hint, initials, normBg, normKo, parsePos, sharesAlternative, splitAlternatives, suggestRomanization,
} from '../shared/lang';

describe('normalization', () => {
  it('strips Bulgarian stress marks and case', () => {
    expect(normBg('Къ́ща')).toBe('къща');
    expect(normBg('ѝ')).toBe('и');
  });
  it('fixes Latin lookalikes typed on the wrong layout', () => {
    expect(normBg('кaпa')).toBe('капа'); // Latin 'a'
  });
  it('keeps й (breve is not a stress mark)', () => {
    expect(normBg('Чай')).toBe('чай');
  });
  it('ignores Korean spacing and recomposes jamo', () => {
    expect(normKo('한국 어')).toBe('한국어');
    expect(normKo('한국어'.normalize('NFD'))).toBe('한국어');
  });
});

describe('alternatives and derived columns', () => {
  it('splits ; and aspect pairs', () => {
    expect(splitAlternatives('казвам / кажа; говоря')).toEqual(['казвам', 'кажа', 'говоря']);
  });
  it('derives initials', () => {
    expect(initials('한국어')).toBe('ㅎㄱㅇ');
    expect(deriveColumns('къща', '집; 주택')).toEqual({ bg_norm: 'къща', ko_norm: '집|주택', ko_initials: 'ㅈ|ㅈㅌ' });
  });
  it('romanizes with sound changes', () => {
    expect(suggestRomanization('같이; 집')).toBe('gachi; jip');
  });
});

describe('checkAnswer', () => {
  it('accepts any alternative', () => {
    expect(checkAnswer('고마워요', '감사합니다; 고마워요', 'ko').verdict).toBe('correct');
    expect(checkAnswer('кажа', 'казвам / кажа', 'bg').verdict).toBe('correct');
  });
  it('treats one wrong batchim as a near miss', () => {
    expect(checkAnswer('학국어', '한국어', 'ko')).toMatchObject({ verdict: 'close', matched: '한국어' });
  });
  it('rejects a different word', () => {
    expect(checkAnswer('사과', '한국어', 'ko').verdict).toBe('wrong');
    expect(checkAnswer('', '한국어', 'ko').verdict).toBe('wrong');
  });
  it('flags Bulgarian typos', () => {
    expect(checkAnswer('кщща', 'къща', 'bg').verdict).toBe('close');
    expect(checkAnswer('Къща', 'къ́ща', 'bg').verdict).toBe('correct');
  });
});

describe('hints', () => {
  it('gives Korean initials, then the first syllable', () => {
    expect(hint('한국어', 'ko', 1)).toBe('ㅎㄱㅇ');
    expect(hint('한국어', 'ko', 2)).toBe('한ㄱㅇ');
  });
  it('gives the first Bulgarian letter, then half the word', () => {
    expect(hint('къща', 'bg', 1)).toBe('к _ _ _');
    expect(hint('къща', 'bg', 2)).toBe('к ъ _ _');
  });
});

describe('homonyms', () => {
  it('detects entries that share a Korean form', () => {
    const pear = deriveColumns('круша', '배');
    const boat = deriveColumns('кораб', '배; 선박');
    const house = deriveColumns('къща', '집');
    expect(sharesAlternative(pear.ko_norm, boat.ko_norm)).toBe(true);
    expect(sharesAlternative(pear.ko_norm, house.ko_norm)).toBe(false);
  });
});

describe('parsePos', () => {
  it('accepts English, Bulgarian and Korean labels and abbreviations', () => {
    expect(parsePos('Noun')).toBe('noun');
    expect(parsePos('същ.')).toBe('noun');
    expect(parsePos('Глагол')).toBe('verb');
    expect(parsePos('형용사')).toBe('adjective');
    expect(parsePos(' adv ')).toBe('adverb');
  });
  it('returns null for empty or unknown labels', () => {
    expect(parsePos('')).toBeNull();
    expect(parsePos(null)).toBeNull();
    expect(parsePos('частица')).toBeNull();
  });
});
