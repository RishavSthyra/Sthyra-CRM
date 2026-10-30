BEGIN;

ALTER TABLE inventory_unit_types
  ADD COLUMN IF NOT EXISTS price_per_sqft NUMERIC(16,2);

UPDATE inventory_unit_types
SET price_per_sqft = ROUND(base_price / saleable_area_sqft, 2),
    base_price = ROUND(ROUND(base_price / saleable_area_sqft, 2) * saleable_area_sqft, 2)
WHERE price_per_sqft IS NULL
  AND base_price IS NOT NULL
  AND saleable_area_sqft IS NOT NULL
  AND saleable_area_sqft > 0;

UPDATE inventory_price_book_entries entry
SET base_amount = unit_type.base_price,
    updated_at = CURRENT_TIMESTAMP
FROM inventory_unit_types unit_type
WHERE entry.unit_type_id = unit_type.unit_type_id
  AND entry.unit_id IS NULL
  AND entry.source = 'unit_type_base'
  AND unit_type.price_per_sqft IS NOT NULL
  AND entry.base_amount IS DISTINCT FROM unit_type.base_price;

ALTER TABLE inventory_unit_types
  DROP CONSTRAINT IF EXISTS inventory_unit_types_price_per_sqft_check;

ALTER TABLE inventory_unit_types
  ADD CONSTRAINT inventory_unit_types_price_per_sqft_check
  CHECK (price_per_sqft IS NULL OR price_per_sqft >= 0);

CREATE OR REPLACE FUNCTION sync_inventory_unit_type_base_price()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.price_per_sqft IS NULL THEN
    NEW.base_price := NULL;
  ELSIF NEW.saleable_area_sqft IS NULL OR NEW.saleable_area_sqft <= 0 THEN
    RAISE EXCEPTION 'saleable_area_sqft is required when price_per_sqft is set'
      USING ERRCODE = '23514';
  ELSE
    NEW.base_price := ROUND(NEW.price_per_sqft * NEW.saleable_area_sqft, 2);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS inventory_unit_types_sync_base_price
  ON inventory_unit_types;

CREATE TRIGGER inventory_unit_types_sync_base_price
BEFORE INSERT OR UPDATE OF price_per_sqft, saleable_area_sqft, base_price
ON inventory_unit_types
FOR EACH ROW
EXECUTE FUNCTION sync_inventory_unit_type_base_price();

COMMIT;
