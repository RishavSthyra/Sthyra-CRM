CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- The lead list uses leading-wildcard ILIKE predicates, which ordinary btree
-- indexes cannot serve. Trigram GIN indexes keep partial contact searches fast.
CREATE INDEX IF NOT EXISTS contacts_first_name_trgm_idx
  ON contacts USING gin (first_name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS contacts_last_name_trgm_idx
  ON contacts USING gin (last_name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS contacts_email_trgm_idx
  ON contacts USING gin (email gin_trgm_ops);

CREATE INDEX IF NOT EXISTS contacts_phone_number_trgm_idx
  ON contacts USING gin (phone_number gin_trgm_ops);
