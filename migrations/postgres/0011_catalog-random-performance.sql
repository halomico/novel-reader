-- Stable pivot sampling scans at most one ordered range on either side of the
-- random pivot. These indexes keep source and paid-only filters indexable.
CREATE INDEX novels_source_id_order_idx ON novels (source_id, id);
CREATE INDEX novels_soda_id_order_idx ON novels (id)
  WHERE access_mode = 'soda' AND soda_price > 0;
CREATE INDEX novels_source_soda_id_order_idx ON novels (source_id, id)
  WHERE access_mode = 'soda' AND soda_price > 0;
