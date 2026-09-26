BEGIN;

ALTER TABLE inventory_price_book_entries
  ADD COLUMN IF NOT EXISTS source VARCHAR(30) NOT NULL DEFAULT 'manual';

ALTER TABLE inventory_price_book_entries
  DROP CONSTRAINT IF EXISTS inventory_price_book_entries_source_check;
ALTER TABLE inventory_price_book_entries
  ADD CONSTRAINT inventory_price_book_entries_source_check
  CHECK (source IN ('manual', 'unit_type_base'));

CREATE INDEX IF NOT EXISTS inventory_price_entries_effective_type_idx
  ON inventory_price_book_entries
    (price_book_id, unit_type_id, valid_from DESC, valid_until)
  WHERE unit_type_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS inventory_price_entries_effective_unit_idx
  ON inventory_price_book_entries
    (price_book_id, unit_id, valid_from DESC, valid_until)
  WHERE unit_id IS NOT NULL;

-- Reuse a previously-created standard book when possible.
UPDATE inventory_price_books standard
SET is_default=TRUE,
    is_active=TRUE,
    updated_at=CURRENT_TIMESTAMP
WHERE standard.price_book_code='STANDARD'
  AND NOT EXISTS (
    SELECT 1
    FROM inventory_price_books current_default
    WHERE current_default.project_id=standard.project_id
      AND current_default.is_default=TRUE
      AND current_default.is_active=TRUE
  );

-- Existing projects receive one standard book based on their unit-type currency.
WITH priced_projects AS (
  SELECT DISTINCT ON (unit_type.project_id)
    unit_type.company_id,
    unit_type.project_id,
    unit_type.currency
  FROM inventory_unit_types unit_type
  WHERE unit_type.base_price IS NOT NULL
  ORDER BY unit_type.project_id, unit_type.created_at, unit_type.unit_type_id
)
INSERT INTO inventory_price_books
  (company_id,project_id,price_book_code,price_book_name,currency,is_default)
SELECT
  priced.company_id,
  priced.project_id,
  'STANDARD',
  'Standard Pricing',
  priced.currency,
  TRUE
FROM priced_projects priced
WHERE NOT EXISTS (
  SELECT 1
  FROM inventory_price_books existing
  WHERE existing.project_id=priced.project_id
    AND existing.is_default=TRUE
    AND existing.is_active=TRUE
)
AND NOT EXISTS (
  SELECT 1
  FROM inventory_price_books code_conflict
  WHERE code_conflict.project_id=priced.project_id
    AND code_conflict.price_book_code='STANDARD'
);

-- Seed only missing timeless entries. Existing manual prices always win.
INSERT INTO inventory_price_book_entries
  (price_book_id,unit_type_id,base_amount,source)
SELECT
  book.price_book_id,
  unit_type.unit_type_id,
  unit_type.base_price,
  'unit_type_base'
FROM inventory_unit_types unit_type
JOIN inventory_price_books book
  ON book.project_id=unit_type.project_id
 AND book.is_default=TRUE
 AND book.is_active=TRUE
 AND book.currency=unit_type.currency
WHERE unit_type.base_price IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM inventory_price_book_entries existing
    WHERE existing.price_book_id=book.price_book_id
      AND existing.unit_type_id=unit_type.unit_type_id
      AND existing.valid_from IS NULL
  );

COMMIT;
