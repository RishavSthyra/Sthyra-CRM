import type { Pool, PoolClient } from "pg";
import { isObject } from "@/utils/isObject";

type Queryable = Pick<Pool | PoolClient, "query">;

export type InventoryLayoutRoomInput = {
  room_name: string;
  room_type: string | null;
  length: number | null;
  width: number | null;
  measurement_unit: "ft" | "m";
  area_sqft: number | null;
  notes: string | null;
  display_order: number;
};

export type InventoryLayoutAssetInput = {
  asset_kind: "floor_plan" | "render" | "document";
  asset_url: string;
  file_name: string | null;
  mime_type: string | null;
  display_order: number;
};

export type InventoryLayoutInput = {
  notes: string | null;
  rooms: InventoryLayoutRoomInput[];
  assets: InventoryLayoutAssetInput[];
};

function text(
  value: unknown,
  field: string,
  errors: string[],
  options: { required?: boolean; maximum?: number } = {},
) {
  if (value === null || value === undefined || value === "") {
    if (options.required) errors.push(`${field} is required`);
    return null;
  }
  if (typeof value !== "string") {
    errors.push(`${field} must be text`);
    return null;
  }
  const normalized = value.trim();
  if (!normalized) {
    if (options.required) errors.push(`${field} is required`);
    return null;
  }
  if (normalized.length > (options.maximum ?? 500)) {
    errors.push(`${field} must be at most ${options.maximum ?? 500} characters`);
    return null;
  }
  return normalized;
}

function positiveNumber(value: unknown, field: string, errors: string[]) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    errors.push(`${field} must be a positive number`);
    return null;
  }
  return Math.round(value * 100) / 100;
}

export function validateInventoryLayout(
  value: unknown,
  field = "layout",
): { ok: true; data: InventoryLayoutInput } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!isObject(value) || Array.isArray(value)) {
    return { ok: false, errors: [`${field} must be an object`] };
  }
  const notes = text(value.notes, `${field}.notes`, errors, { maximum: 2000 });
  const rawRooms = value.rooms ?? [];
  const rawAssets = value.assets ?? [];
  if (!Array.isArray(rawRooms)) errors.push(`${field}.rooms must be an array`);
  if (!Array.isArray(rawAssets)) errors.push(`${field}.assets must be an array`);
  if (Array.isArray(rawRooms) && rawRooms.length > 100)
    errors.push(`${field}.rooms cannot contain more than 100 rooms`);
  if (Array.isArray(rawAssets) && rawAssets.length > 20)
    errors.push(`${field}.assets cannot contain more than 20 files`);

  const rooms: InventoryLayoutRoomInput[] = [];
  if (Array.isArray(rawRooms)) {
    rawRooms.forEach((raw, index) => {
      const prefix = `${field}.rooms[${index}]`;
      if (!isObject(raw) || Array.isArray(raw)) {
        errors.push(`${prefix} must be an object`);
        return;
      }
      const roomName = text(raw.room_name, `${prefix}.room_name`, errors, {
        required: true,
        maximum: 150,
      });
      const roomType = text(raw.room_type, `${prefix}.room_type`, errors, {
        maximum: 80,
      });
      const length = positiveNumber(raw.length, `${prefix}.length`, errors);
      const width = positiveNumber(raw.width, `${prefix}.width`, errors);
      const suppliedArea = positiveNumber(
        raw.area_sqft,
        `${prefix}.area_sqft`,
        errors,
      );
      const measurementUnit = raw.measurement_unit === "m" ? "m" : "ft";
      if ((length === null) !== (width === null))
        errors.push(`${prefix}.length and width must be provided together`);
      if (length === null && suppliedArea === null)
        errors.push(`${prefix} needs dimensions or an area`);
      const calculatedArea =
        length !== null && width !== null
          ? length * width * (measurementUnit === "m" ? 10.7639 : 1)
          : suppliedArea;
      const roomNotes = text(raw.notes, `${prefix}.notes`, errors, {
        maximum: 500,
      });
      if (roomName)
        rooms.push({
          room_name: roomName,
          room_type: roomType,
          length,
          width,
          measurement_unit: measurementUnit,
          area_sqft:
            calculatedArea === null
              ? null
              : Math.round(calculatedArea * 100) / 100,
          notes: roomNotes,
          display_order: index + 1,
        });
    });
  }

  const assets: InventoryLayoutAssetInput[] = [];
  if (Array.isArray(rawAssets)) {
    rawAssets.forEach((raw, index) => {
      const prefix = `${field}.assets[${index}]`;
      if (!isObject(raw) || Array.isArray(raw)) {
        errors.push(`${prefix} must be an object`);
        return;
      }
      const assetUrl = text(raw.asset_url, `${prefix}.asset_url`, errors, {
        required: true,
        maximum: 2000,
      });
      if (assetUrl) {
        try {
          const parsed = new URL(assetUrl);
          if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error();
        } catch {
          errors.push(`${prefix}.asset_url must be an http or https URL`);
        }
      }
      const assetKind = ["floor_plan", "render", "document"].includes(
        String(raw.asset_kind),
      )
        ? (String(raw.asset_kind) as InventoryLayoutAssetInput["asset_kind"])
        : "floor_plan";
      const fileName = text(raw.file_name, `${prefix}.file_name`, errors, {
        maximum: 255,
      });
      const mimeType = text(raw.mime_type, `${prefix}.mime_type`, errors, {
        maximum: 150,
      });
      if (assetUrl)
        assets.push({
          asset_kind: assetKind,
          asset_url: assetUrl,
          file_name: fileName,
          mime_type: mimeType,
          display_order: index + 1,
        });
    });
  }

  if (errors.length) return { ok: false, errors };
  return { ok: true, data: { notes, rooms, assets } };
}

export async function replaceUnitTypeLayout(
  db: Queryable,
  unitTypeId: string,
  layout: InventoryLayoutInput,
) {
  await db.query(
    "UPDATE inventory_unit_types SET layout_notes=$2,updated_at=CURRENT_TIMESTAMP WHERE unit_type_id=$1",
    [unitTypeId, layout.notes],
  );
  await db.query("DELETE FROM inventory_unit_type_rooms WHERE unit_type_id=$1", [
    unitTypeId,
  ]);
  await db.query(
    "DELETE FROM inventory_unit_type_layout_assets WHERE unit_type_id=$1",
    [unitTypeId],
  );
  for (const room of layout.rooms) {
    await db.query(
      `INSERT INTO inventory_unit_type_rooms
        (unit_type_id,room_name,room_type,length,width,measurement_unit,area_sqft,notes,display_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        unitTypeId,
        room.room_name,
        room.room_type,
        room.length,
        room.width,
        room.measurement_unit,
        room.area_sqft,
        room.notes,
        room.display_order,
      ],
    );
  }
  for (const asset of layout.assets) {
    await db.query(
      `INSERT INTO inventory_unit_type_layout_assets
        (unit_type_id,asset_kind,asset_url,file_name,mime_type,display_order)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [
        unitTypeId,
        asset.asset_kind,
        asset.asset_url,
        asset.file_name,
        asset.mime_type,
        asset.display_order,
      ],
    );
  }
}

export async function replaceUnitLayout(
  db: Queryable,
  unitId: string,
  layout: InventoryLayoutInput,
) {
  await db.query(
    "UPDATE inventory_units SET layout_notes=$2 WHERE unit_id=$1",
    [unitId, layout.notes],
  );
  await db.query("DELETE FROM inventory_unit_rooms WHERE unit_id=$1", [unitId]);
  await db.query("DELETE FROM inventory_unit_layout_assets WHERE unit_id=$1", [
    unitId,
  ]);
  for (const room of layout.rooms) {
    await db.query(
      `INSERT INTO inventory_unit_rooms
        (unit_id,room_name,room_type,length,width,measurement_unit,area_sqft,notes,display_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        unitId,
        room.room_name,
        room.room_type,
        room.length,
        room.width,
        room.measurement_unit,
        room.area_sqft,
        room.notes,
        room.display_order,
      ],
    );
  }
  for (const asset of layout.assets) {
    await db.query(
      `INSERT INTO inventory_unit_layout_assets
        (unit_id,asset_kind,asset_url,file_name,mime_type,display_order)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [
        unitId,
        asset.asset_kind,
        asset.asset_url,
        asset.file_name,
        asset.mime_type,
        asset.display_order,
      ],
    );
  }
}
