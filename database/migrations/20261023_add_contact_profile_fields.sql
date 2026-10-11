ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS occupation VARCHAR(200),
  ADD COLUMN IF NOT EXISTS marital_status VARCHAR(30),
  ADD COLUMN IF NOT EXISTS city VARCHAR(100),
  ADD COLUMN IF NOT EXISTS district VARCHAR(100),
  ADD COLUMN IF NOT EXISTS state VARCHAR(100),
  ADD COLUMN IF NOT EXISTS postal_code VARCHAR(20);

ALTER TABLE contacts
  DROP CONSTRAINT IF EXISTS contacts_marital_status_check;

ALTER TABLE contacts
  ADD CONSTRAINT contacts_marital_status_check
  CHECK (
    marital_status IS NULL OR marital_status IN (
      'single',
      'married',
      'separated',
      'divorced',
      'widowed',
      'prefer_not_to_say'
    )
  );

UPDATE contacts
SET marital_status = 'married'
WHERE is_married = TRUE
  AND marital_status IS NULL;
