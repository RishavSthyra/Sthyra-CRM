BEGIN;

-- Notification creation resolves the recipient's delivery preferences before
-- enqueuing a notification. When the recipient differs from the actor (for
-- example, an owner assigning work to an executive), the original self-only
-- policies blocked INSERT ... ON CONFLICT ... RETURNING and rolled back the
-- entire business transaction. Keep the original self policies, and add the
-- narrowly scoped trusted-server access required for same-company recipients.
DROP POLICY IF EXISTS tenant_notification_dispatch_select
  ON notification_preferences;
CREATE POLICY tenant_notification_dispatch_select
  ON notification_preferences
  FOR SELECT TO sthyra_app_server
  USING (
    private.can_access_user(user_id)
    AND private.is_trusted_app_request()
  );

DROP POLICY IF EXISTS tenant_notification_dispatch_insert
  ON notification_preferences;
CREATE POLICY tenant_notification_dispatch_insert
  ON notification_preferences
  FOR INSERT TO sthyra_app_server
  WITH CHECK (
    private.can_access_user(user_id)
    AND private.is_trusted_app_request()
  );

DROP POLICY IF EXISTS tenant_notification_dispatch_update
  ON notification_preferences;
CREATE POLICY tenant_notification_dispatch_update
  ON notification_preferences
  FOR UPDATE TO sthyra_app_server
  USING (
    private.can_access_user(user_id)
    AND private.is_trusted_app_request()
  )
  WITH CHECK (
    private.can_access_user(user_id)
    AND private.is_trusted_app_request()
  );

-- Business actions can notify a different user in the same company (for
-- example, a company owner assigning an appointment to a sales executive).
-- notification_deliveries intentionally remain self-only for SELECT, but the
-- trusted application server must be able to enqueue a delivery for that
-- recipient. The original ALL policy only allowed writes where the recipient
-- was the current user, causing the surrounding business transaction to roll
-- back whenever another user was notified.
DROP POLICY IF EXISTS tenant_server_insert_for_company_users
  ON notification_deliveries;
CREATE POLICY tenant_server_insert_for_company_users
  ON notification_deliveries
  FOR INSERT TO sthyra_app_server
  WITH CHECK (
    private.can_access_user(user_id)
    AND private.is_trusted_app_request()
  );

COMMIT;
