type Child = Node | string | number | null | undefined | false;
type Props = Record<string, unknown>;

/** Tiny element builder. Strings become text nodes, so user content is never parsed as HTML. */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Props = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null || value === false) continue;
    if (key.startsWith('on') && typeof value === 'function') {
      el.addEventListener(key.slice(2).toLowerCase(), value as EventListener);
    } else if (key === 'class') {
      el.className = String(value);
    } else if (key in el && typeof value !== 'string') {
      (el as unknown as Record<string, unknown>)[key] = value;
    } else {
      el.setAttribute(key, value === true ? '' : String(value));
    }
  }
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child instanceof Node ? child : String(child));
  }
  return el;
}

/**
 * Pressing Enter to finish a Hangul syllable must not submit or check the answer.
 * Chrome reports isComposing; Safari ends composition first and sends keyCode 229.
 */
export function isImeEnter(e: KeyboardEvent): boolean {
  return e.key === 'Enter' && (e.isComposing || e.keyCode === 229);
}

/** Calls fn on Enter, but never while an IME is composing. */
export function onEnter(el: HTMLElement, fn: () => void) {
  el.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || isImeEnter(e)) return;
    e.preventDefault();
    fn();
  });
}

/** For <form> submit handlers: true while the current Enter only committed IME input. */
export function trackImeEnter(form: HTMLFormElement): () => boolean {
  let imeEnter = false;
  form.addEventListener(
    'keydown',
    (e) => {
      if (isImeEnter(e)) {
        imeEnter = true;
        setTimeout(() => (imeEnter = false), 0);
      }
    },
    true,
  );
  return () => imeEnter;
}

const banner = () => document.getElementById('banner')!;

export function showBanner(message: string) {
  banner().textContent = message;
  banner().hidden = false;
}

export function hideBanner() {
  banner().hidden = true;
}
