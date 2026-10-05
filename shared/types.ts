export type Direction = 'bg2ko' | 'ko2bg';
export type QuizDirection = Direction | 'mixed';
export type AnswerResult = 'correct' | 'hinted' | 'wrong';

export const PARTS_OF_SPEECH = ['noun', 'verb', 'adjective', 'adverb', 'phrase', 'other'] as const;
export type PartOfSpeech = (typeof PARTS_OF_SPEECH)[number];

export const BG_GENDERS = ['м', 'ж', 'ср'] as const;
export type BgGender = (typeof BG_GENDERS)[number];

/** What the user types in. */
export interface EntryInput {
  bg_text: string;
  ko_text: string;
  ko_roman?: string | null;
  hanja?: string | null;
  pos?: PartOfSpeech | null;
  bg_gender?: BgGender | null;
  note?: string | null;
  tags?: string | null;
}

/** A stored row. */
export interface Entry extends Required<EntryInput> {
  id: number;
  bg_norm: string;
  ko_norm: string;
  ko_initials: string;
  created_at: string;
  updated_at: string;
}

export interface QuizCard {
  entry: Entry;
  direction: Direction;
  box: number | null; // null = never practised in this direction
}

export interface CreateResponse {
  created: Entry[];
  skipped: { bg_text: string; ko_text: string; reason: string }[];
}

/** D1 on the free plan allows 50 queries per request, so imports are sent in chunks. */
export const MAX_ENTRIES_PER_REQUEST = 40;
