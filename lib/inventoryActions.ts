import type { PoolClient } from "pg";
import {
  canTransitionInventoryStatus,
  getInventoryUnit,
  type InventoryStatus,
  recordInventoryStatus,
} from "@/lib/inventory";

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
     RETURNING hold.unit_id`,
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
     SET status='expired', updated_at=CURRENT_TIMESTAMP
     WHERE ($1::integer IS NULL OR reservation.company_id=$1)
       AND ($2::integer IS NULL OR reservation.project_id=$2)
       AND reservation.status='active'
       AND reservation.expires_at IS NOT NULL
       AND reservation.expires_at<=CURRENT_TIMESTAMP
     RETURNING reservation.unit_id, reservation.reservation_id`,
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
  }
  return result.rowCount ?? 0;
}
