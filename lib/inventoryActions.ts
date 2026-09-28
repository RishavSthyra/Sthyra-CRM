import type { PoolClient } from "pg";
import {
  canTransitionInventoryStatus,
  getInventoryUnit,
  type InventoryStatus,
  recordInventoryStatus,
} from "@/lib/inventory";
import {
  createNotificationsForUsers,
  resolveNotificationRecipients,
} from "@/lib/notifications";

export class InventoryActionError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export async function changeInventoryUnitStatus(
  client: PoolClient,
  options: {
    unitId: string;
    companyId: number;
    projectId: number;
    toStatus: InventoryStatus;
    userId: string;
    reason: string | null;
    metadata?: Record<string, unknown>;
  },
) {
  const unit = await getInventoryUnit(client, options.unitId, true);
  if (!unit) throw new InventoryActionError("Inventory unit not found", 404);
  if (
    Number(unit.company_id) !== options.companyId ||
    Number(unit.project_id) !== options.projectId
  ) {
    throw new InventoryActionError(
      "You do not have access to this inventory unit",
      403,
    );
  }
  const currentStatus = String(unit.status) as InventoryStatus;
  if (!canTransitionInventoryStatus(currentStatus, options.toStatus)) {
    throw new InventoryActionError(
      `Cannot change inventory status from ${currentStatus} to ${options.toStatus}`,
      409,
    );
  }
  const result = await client.query(
    `UPDATE inventory_units
     SET status=$2, version=version+1, updated_at=CURRENT_TIMESTAMP
     WHERE unit_id=$1 AND version=$3
     RETURNING *`,
    [options.unitId, options.toStatus, unit.version],
  );
  if (!result.rowCount)
    throw new InventoryActionError(
      "Inventory unit was updated by another request; reload and retry",
      409,
    );
  await recordInventoryStatus(
    client,
    options.unitId,
    currentStatus,
    options.toStatus,
    options.userId,
    options.reason,
    options.metadata,
  );
  return result.rows[0];
}

export async function expireStaleInventoryHolds(
  client: PoolClient,
  companyId?: number,
  projectId?: number,
) {
  const result = await client.query(
    `UPDATE inventory_holds hold
     SET status='expired', released_at=CURRENT_TIMESTAMP,
         updated_at=CURRENT_TIMESTAMP
     WHERE ($1::integer IS NULL OR hold.company_id=$1)
       AND ($2::integer IS NULL OR hold.project_id=$2)
       AND hold.status='active'
       AND hold.expires_at<=CURRENT_TIMESTAMP
     RETURNING hold.hold_id,hold.unit_id,hold.company_id,hold.project_id,
       hold.opportunity_id,hold.created_by`,
    [companyId ?? null, projectId ?? null],
  );
  for (const row of result.rows) {
    const unit = await getInventoryUnit(client, String(row.unit_id), true);
    if (unit?.status !== "held") continue;
    const activeReservation = await client.query(
      "SELECT 1 FROM inventory_reservations WHERE unit_id=$1 AND status='active'",
      [row.unit_id],
    );
    if (activeReservation.rowCount) continue;
    await client.query(
      `UPDATE inventory_units SET status='available', version=version+1,
       updated_at=CURRENT_TIMESTAMP WHERE unit_id=$1`,
      [row.unit_id],
    );
    await client.query(
      `INSERT INTO inventory_unit_status_history
       (unit_id,from_status,to_status,reason,metadata)
       VALUES ($1,'held','available','Hold expired',$2)`,
      [row.unit_id, { source: "hold_expiry" }],
    );
    const opportunity = row.opportunity_id
      ? await client.query(
          `SELECT current_owner_user_id,current_team_id
           FROM opportunities WHERE opportunity_id=$1`,
          [row.opportunity_id],
        )
      : null;
    const recipients = await resolveNotificationRecipients(client, {
      companyId: Number(row.company_id),
      userIds: [opportunity?.rows[0]?.current_owner_user_id, row.created_by],
      teamIds: [opportunity?.rows[0]?.current_team_id],
    });
    await createNotificationsForUsers(client, recipients, {
      companyId: Number(row.company_id),
      projectId: Number(row.project_id),
      type: "booking.hold_expired",
      category: "booking",
      title: "Inventory hold expired",
      body: "An inventory hold expired and the unit is available again.",
      severity: "warning",
      entityType: "inventory_hold",
      entityId: String(row.hold_id),
      actionUrl: row.opportunity_id
        ? `/opportunities?opportunity_id=${row.opportunity_id}`
        : "/inventory",
      eventKey: `inventory-hold:${row.hold_id}:expired`,
      metadata: { unit_id: row.unit_id },
      channels: ["in_app", "email"],
    });
  }
  return result.rowCount ?? 0;
}

export async function expireStaleInventoryReservations(
  client: PoolClient,
  companyId?: number,
  projectId?: number,
) {
  const result = await client.query(
    `UPDATE inventory_reservations reservation
     SET status='expired', booking_status='expired', updated_at=CURRENT_TIMESTAMP
     WHERE ($1::integer IS NULL OR reservation.company_id=$1)
       AND ($2::integer IS NULL OR reservation.project_id=$2)
       AND reservation.status='active'
       AND reservation.expires_at IS NOT NULL
       AND reservation.expires_at<=CURRENT_TIMESTAMP
     RETURNING reservation.unit_id,reservation.reservation_id,
       reservation.company_id,reservation.project_id,
       reservation.opportunity_id,reservation.created_by`,
    [companyId ?? null, projectId ?? null],
  );
  for (const row of result.rows) {
    const unit = await getInventoryUnit(client, String(row.unit_id), true);
    if (unit?.status !== "reserved") continue;
    await client.query(
      `UPDATE inventory_units SET status='available', version=version+1,
       updated_at=CURRENT_TIMESTAMP WHERE unit_id=$1`,
      [row.unit_id],
    );
    await client.query(
      `INSERT INTO inventory_unit_status_history
       (unit_id,from_status,to_status,reason,metadata)
       VALUES ($1,'reserved','available','Reservation expired',$2)`,
      [
        row.unit_id,
        { source: "reservation_expiry", reservation_id: row.reservation_id },
      ],
    );
    const opportunity = await client.query(
      `SELECT current_owner_user_id,current_team_id
       FROM opportunities WHERE opportunity_id=$1`,
      [row.opportunity_id],
    );
    const recipients = await resolveNotificationRecipients(client, {
      companyId: Number(row.company_id),
      userIds: [opportunity.rows[0]?.current_owner_user_id, row.created_by],
      teamIds: [opportunity.rows[0]?.current_team_id],
    });
    await createNotificationsForUsers(client, recipients, {
      companyId: Number(row.company_id),
      projectId: Number(row.project_id),
      type: "booking.reservation_expired",
      category: "booking",
      title: "Inventory reservation expired",
      body: "An inventory reservation expired and the unit is available again.",
      severity: "warning",
      entityType: "reservation",
      entityId: String(row.reservation_id),
      actionUrl: `/opportunities?opportunity_id=${row.opportunity_id}`,
      eventKey: `reservation:${row.reservation_id}:expired`,
      metadata: { unit_id: row.unit_id },
      channels: ["in_app", "email"],
    });
  }
  return result.rowCount ?? 0;
}
