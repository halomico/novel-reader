-- Uniform sampling for 随便看看.
--
-- The dice used to pick a pivot uniformly between MIN(id) and MAX(id) and then read the
-- rows nearest that pivot. Identity keys are not dense: in production 74,485 novels are
-- spread across ids 2..2,286,213, so a uniform draw over the *id value space* is not a
-- uniform draw over *rows*. Whole neighbourhoods — including the densely packed early
-- ids where every indexed book lives — were reached on roughly 1.6% of throws.
--
-- A per-row random key makes the draw uniform by construction: every row owns exactly
-- one point in [0,1), so a pivot in that space selects rows in proportion to their
-- number rather than to the gaps between their ids. It also turns the scan into an
-- index range read of a couple of hundred rows instead of 1,600.
--
-- PostgreSQL evaluates a volatile column default once per row when adding a column, so
-- existing rows each receive their own key without a separate backfill.
ALTER TABLE novels ADD COLUMN random_key double precision NOT NULL DEFAULT random();

ALTER TABLE novels ADD CONSTRAINT novels_random_key_unit_interval
  CHECK (random_key >= 0 AND random_key < 1);

CREATE INDEX novels_random_idx ON novels (random_key, id);
CREATE INDEX novels_source_random_idx ON novels (source_id, random_key, id);

-- The catalog's paid filter is selective enough to deserve its own partial indexes,
-- matching how 0007 treats the other sort orders.
CREATE INDEX novels_soda_random_idx ON novels (random_key, id)
  WHERE access_mode = 'soda' AND soda_price > 0;
CREATE INDEX novels_source_soda_random_idx ON novels (source_id, random_key, id)
  WHERE access_mode = 'soda' AND soda_price > 0;
