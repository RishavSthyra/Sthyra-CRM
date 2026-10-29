BEGIN;

-- The multitenancy foundation deliberately revokes default privileges from
-- future tables. WhatsApp tables therefore need an explicit application-role
-- grant in addition to their row-level security policies.
DO $$
DECLARE
  target TEXT;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='sthyra_app_server') THEN
    FOREACH target IN ARRAY ARRAY[
      'whatsapp_connections',
      'whatsapp_templates',
      'whatsapp_messages',
      'whatsapp_automation_rules',
      'whatsapp_delivery_jobs'
    ] LOOP
      EXECUTE FORMAT(
        'GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO sthyra_app_server',
        target
      );
    END LOOP;
  END IF;
END;
$$;

COMMIT;
