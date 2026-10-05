import './style.css';
import { hideBanner, showBanner } from './dom';
import { store } from './store';
import { renderPractice } from './views/practice';
import { renderWords } from './views/words';

const app = document.getElementById('app')!;
let cleanup: (() => void) | undefined;

function route() {
  const name = location.hash.startsWith('#/practice') ? 'practice' : 'words';
  document.querySelectorAll<HTMLAnchorElement>('nav a').forEach((a) => {
    if (a.dataset.route === name) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
  cleanup?.();
  app.replaceChildren();
  cleanup = name === 'practice' ? renderPractice(app) : renderWords(app);
}

window.addEventListener('hashchange', route);
route();

store.load().then(hideBanner, (err: Error & { usingCache?: boolean }) =>
  showBanner(err.usingCache ? `Showing your saved copy. ${err.message}` : err.message),
);
