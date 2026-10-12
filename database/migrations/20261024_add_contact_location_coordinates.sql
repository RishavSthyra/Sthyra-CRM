ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS country_code VARCHAR(2),
  ADD COLUMN IF NOT EXISTS state_code VARCHAR(10),
  ADD COLUMN IF NOT EXISTS latitude NUMERIC(9, 6),
  ADD COLUMN IF NOT EXISTS longitude NUMERIC(10, 6);

ALTER TABLE contacts
  DROP CONSTRAINT IF EXISTS contacts_country_code_check,
  DROP CONSTRAINT IF EXISTS contacts_latitude_check,
  DROP CONSTRAINT IF EXISTS contacts_longitude_check;

ALTER TABLE contacts
  ADD CONSTRAINT contacts_country_code_check
    CHECK (country_code IS NULL OR country_code ~ '^[A-Z]{2}$'),
  ADD CONSTRAINT contacts_latitude_check
    CHECK (latitude IS NULL OR latitude BETWEEN -90 AND 90),
  ADD CONSTRAINT contacts_longitude_check
    CHECK (longitude IS NULL OR longitude BETWEEN -180 AND 180);
