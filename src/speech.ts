import { splitAlternatives, type Lang } from '../shared/lang';
import { h } from './dom';

const LOCALES: Record<Lang, string> = { ko: 'ko-KR', bg: 'bg-BG' };
let voices: SpeechSynthesisVoice[] = [];
const supported = typeof window !== 'undefined' && 'speechSynthesis' in window;

if (supported) {
  voices = speechSynthesis.getVoices();
  speechSynthesis.addEventListener('voiceschanged', () => (voices = speechSynthesis.getVoices()));
}

const voiceFor = (lang: Lang) => voices.find((v) => v.lang.toLowerCase().startsWith(lang));

export function speak(text: string, lang: Lang) {
  if (!supported) return;
  const utterance = new SpeechSynthesisUtterance(splitAlternatives(text)[0] ?? text);
  utterance.lang = LOCALES[lang];
  const voice = voiceFor(lang);
  if (voice) utterance.voice = voice;
  speechSynthesis.cancel();
  speechSynthesis.speak(utterance);
}

/** A speaker button that only appears when the device has a voice for the language. */
export function speakButton(text: string, lang: Lang): HTMLButtonElement {
  const btn = h(
    'button',
    { type: 'button', class: 'speak', onclick: () => speak(text, lang), 'aria-label': 'Play pronunciation' },
    '▶ Listen',
  );
  const update = () => (btn.hidden = !voiceFor(lang));
  update();
  if (supported) speechSynthesis.addEventListener('voiceschanged', update);
  return btn;
}
