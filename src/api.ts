import type { AnswerResult, CreateResponse, Direction, Entry, EntryInput, QuizCard, QuizDirection } from '../shared/types';

export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      ...init,
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', ...init.headers },
    });
  } catch {
    // An expired Access session redirects to the login page, which fetch reports as a network error.
    throw new ApiError("Can't reach the server. If you've been away for a while, reload the page to sign in again.", 0);
  }
  if (res.status === 204) return undefined as T;
  const data = (await res.json().catch(() => null)) as { error?: string } | null;
  if (!res.ok) throw new ApiError(data?.error ?? `Request failed with status ${res.status}.`, res.status);
  return data as T;
}

export const api = {
  listEntries: () => request<Entry[]>('/entries'),
  createEntries: (items: EntryInput[]) =>
    request<CreateResponse>('/entries', { method: 'POST', body: JSON.stringify(items) }),
  updateEntry: (id: number, input: EntryInput) =>
    request<Entry>(`/entries/${id}`, { method: 'PUT', body: JSON.stringify(input) }),
  deleteEntry: (id: number) => request<void>(`/entries/${id}`, { method: 'DELETE' }),
  quiz: (dir: QuizDirection, n: number, tag: string | null) =>
    request<QuizCard[]>(`/quiz?${new URLSearchParams({ dir, n: String(n), ...(tag ? { tag } : {}) })}`),
  answer: (entry_id: number, direction: Direction, result: AnswerResult) =>
    request('/quiz/answer', { method: 'POST', body: JSON.stringify({ entry_id, direction, result }) }),
};
