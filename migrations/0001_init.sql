-- Bulgarian–Korean vocabulary schema

CREATE TABLE entries (
  id           INTEGER PRIMARY KEY,
  bg_text      TEXT NOT NULL,   -- 'къща' | 'казвам / кажа' | 'благодаря; мерси'
  ko_text      TEXT NOT NULL,   -- '집' | '말하다' | '감사합니다; 고마워요'
  ko_roman     TEXT,            -- 'jip'
  hanja        TEXT,            -- '住宅'
  pos          TEXT,            -- noun, verb, adjective, adverb, phrase, other
  bg_gender    TEXT CHECK (bg_gender IN ('м', 'ж', 'ср')),
  note         TEXT,
  tags         TEXT,            -- comma-separated, lowercase: 'food,home'
  bg_norm      TEXT NOT NULL,   -- normalized alternatives joined by '|'
  ko_norm      TEXT NOT NULL,
  ko_initials  TEXT NOT NULL,   -- 'ㅈ' for 집, alternatives joined by '|'
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE progress (
  entry_id   INTEGER NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
  direction  TEXT NOT NULL CHECK (direction IN ('bg2ko', 'ko2bg')),
  box        INTEGER NOT NULL DEFAULT 1,
  due_at     TEXT NOT NULL DEFAULT (datetime('now')),
  correct    INTEGER NOT NULL DEFAULT 0,
  wrong      INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (entry_id, direction)
);

CREATE UNIQUE INDEX idx_entries_ko ON entries(ko_norm);
CREATE INDEX idx_entries_bg ON entries(bg_norm);
CREATE INDEX idx_progress_due ON progress(direction, due_at);
