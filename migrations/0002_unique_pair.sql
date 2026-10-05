-- Allow Korean homonyms: 배 = круша, 배 = кораб and 배 = корем are separate entries.
-- Only the exact same Bulgarian–Korean pair counts as a duplicate now.

DROP INDEX idx_entries_ko;
CREATE UNIQUE INDEX idx_entries_pair ON entries(ko_norm, bg_norm);
CREATE INDEX idx_entries_ko ON entries(ko_norm);
