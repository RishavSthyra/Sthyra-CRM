import type { Pool, PoolClient } from "pg";

type Queryable = Pick<Pool | PoolClient, "query">;

export type InventoryPricingComponents = Record<string, number>;

export function calculatedBasePrice(
  saleableAreaSqft: number | string | null | undefined,
  pricePerSqft: number | string | null | undefined,
) {
  if (saleableAreaSqft === null || saleableAreaSqft === undefined)
    return null;
  if (pricePerSqft === null || pricePerSqft === undefined) return null;
  const area = Number(saleableAreaSqft);
  const rate = Number(pricePerSqft);
  if (!Number.isFinite(area) || area <= 0 || !Number.isFinite(rate) || rate < 0)
    return null;
  return Math.round((area * rate + Number.EPSILON) * 100) / 100;
}

export function pricingComponentsValue(
  value: unknown,
  errors: string[],
  field = "pricing_components",
): InventoryPricingComponents | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    errors.push(`${field} must be an object`);
    return undefined;
  }

  const normalized: InventoryPricingComponents = {};
  for (const [rawLabel, rawAmount] of Object.entries(value)) {
    const label = rawLabel.trim();
    if (!label || label.length > 200) {
      errors.push(`${field} labels must contain 1 to 200 characters`);
      continue;
    }
    if (
      typeof rawAmount !== "number" ||
      !Number.isFinite(rawAmount) ||
      rawAmount < 0
    ) {
      errors.push(`${field}.${label} must be a non-negative number`);
      continue;
    }
    normalized[label] = rawAmount;
  }
  return normalized;
}

export function pricingComponentsTotal(
  components: Record<string, unknown> | null | undefined,
) {
  return Object.values(components ?? {}).reduce<number>(
    (total, value) =>
      typeof value === "number" && Number.isFinite(value)
        ? total + value
        : total,
    0,
  );
}

export function hasPricingComponents(
  components: Record<string, unknown> | null | undefined,
) {
  return Object.values(components ?? {}).some(
    (value) => typeof value === "number" && Number.isFinite(value),
  );
}

type UnitTypePrice = {
  unit_type_id: string;
  company_id: number | string;
  project_id: number | string;
  base_price: number | string | null;
  currency: string;
};

export type PricingSyncResult = {
  status:
    | "created"
    | "updated"
    | "removed"
    | "manual_override"
    | "currency_mismatch"
    | "no_price";
  price_book_id?: string;
};

export async function ensureDefaultPriceBook(
  db: Queryable,
  companyId: number,
  projectId: number,
  currency: string,
) {
  await db.query("SELECT pg_advisory_xact_lock($1, $2)", [814729, projectId]);

  const current = await db.query(
    `SELECT * FROM inventory_price_books
     WHERE project_id=$1 AND is_default=TRUE AND is_active=TRUE
     ORDER BY created_at
     LIMIT 1
     FOR UPDATE`,
    [projectId],
  );
  if (current.rowCount) return current.rows[0];

  const reusable = await db.query(
    `SELECT * FROM inventory_price_books
     WHERE project_id=$1 AND currency=$3
       AND price_book_code=ANY($2::text[])
     ORDER BY (price_book_code='STANDARD') DESC, created_at
     LIMIT 1
     FOR UPDATE`,
    [
      projectId,
      ["STANDARD", `STANDARD-${currency}`, `STANDARD-${currency}-${projectId}`],
      currency,
    ],
  );
  if (reusable.rowCount) {
    const result = await db.query(
      `UPDATE inventory_price_books
       SET is_default=TRUE,is_active=TRUE,updated_at=CURRENT_TIMESTAMP
       WHERE price_book_id=$1
       RETURNING *`,
      [reusable.rows[0].price_book_id],
    );
    return result.rows[0];
  }

  const codeConflicts = await db.query(
    `SELECT price_book_code FROM inventory_price_books
     WHERE project_id=$1 AND price_book_code=ANY($2::text[])`,
    [projectId, ["STANDARD", `STANDARD-${currency}`]],
  );
  const usedCodes = new Set(
    codeConflicts.rows.map((row) => String(row.price_book_code)),
  );
  const code = !usedCodes.has("STANDARD")
    ? "STANDARD"
    : !usedCodes.has(`STANDARD-${currency}`)
      ? `STANDARD-${currency}`
      : `STANDARD-${currency}-${projectId}`;
  const result = await db.query(
    `INSERT INTO inventory_price_books
       (company_id,project_id,price_book_code,price_book_name,currency,is_default)
     VALUES ($1,$2,$3,'Standard Pricing',$4,TRUE)
     RETURNING *`,
    [companyId, projectId, code, currency],
  );
  return result.rows[0];
}

export async function syncUnitTypeBasePrice(
  db: Queryable,
  unitType: UnitTypePrice,
  components?: InventoryPricingComponents,
): Promise<PricingSyncResult> {
  if (unitType.base_price === null) {
    const removed = await db.query(
      `DELETE FROM inventory_price_book_entries
       WHERE unit_type_id=$1 AND source='unit_type_base'
       RETURNING price_entry_id`,
      [unitType.unit_type_id],
    );
    return { status: removed.rowCount ? "removed" : "no_price" };
  }

  const book = await ensureDefaultPriceBook(
    db,
    Number(unitType.company_id),
    Number(unitType.project_id),
    unitType.currency,
  );
  if (String(book.currency) !== unitType.currency) {
    await db.query(
      `DELETE FROM inventory_price_book_entries
       WHERE unit_type_id=$1 AND source='unit_type_base'`,
      [unitType.unit_type_id],
    );
    return {
      status: "currency_mismatch",
      price_book_id: book.price_book_id,
    };
  }

  const existing = await db.query(
    `SELECT * FROM inventory_price_book_entries
     WHERE price_book_id=$1 AND unit_type_id=$2 AND valid_from IS NULL
     LIMIT 1
     FOR UPDATE`,
    [book.price_book_id, unitType.unit_type_id],
  );
  if (existing.rowCount) {
    if (existing.rows[0].source !== "unit_type_base") {
      return {
        status: "manual_override",
        price_book_id: book.price_book_id,
      };
    }
    if (components === undefined) {
      await db.query(
        `UPDATE inventory_price_book_entries
         SET base_amount=$1,updated_at=CURRENT_TIMESTAMP
         WHERE price_entry_id=$2`,
        [unitType.base_price, existing.rows[0].price_entry_id],
      );
    } else {
      await db.query(
        `UPDATE inventory_price_book_entries
         SET base_amount=$1,components=$2::jsonb,updated_at=CURRENT_TIMESTAMP
         WHERE price_entry_id=$3`,
        [
          unitType.base_price,
          JSON.stringify(components),
          existing.rows[0].price_entry_id,
        ],
      );
    }
    return { status: "updated", price_book_id: book.price_book_id };
  }

  await db.query(
    `INSERT INTO inventory_price_book_entries
       (price_book_id,unit_type_id,base_amount,components,source)
     VALUES ($1,$2,$3,$4::jsonb,'unit_type_base')`,
    [
      book.price_book_id,
      unitType.unit_type_id,
      unitType.base_price,
      JSON.stringify(components ?? {}),
    ],
  );
  return { status: "created", price_book_id: book.price_book_id };
}

export async function syncProjectBasePrices(
  db: Queryable,
  companyId: number,
  projectId: number,
  currency = "INR",
) {
  const book = await ensureDefaultPriceBook(db, companyId, projectId, currency);
  const unitTypes = await db.query(
    `SELECT unit_type_id,company_id,project_id,base_price,currency
     FROM inventory_unit_types
     WHERE company_id=$1 AND project_id=$2 AND base_price IS NOT NULL
     ORDER BY created_at,unit_type_id`,
    [companyId, projectId],
  );
  const counts: Record<PricingSyncResult["status"], number> = {
    created: 0,
    updated: 0,
    removed: 0,
    manual_override: 0,
    currency_mismatch: 0,
    no_price: 0,
  };
  for (const unitType of unitTypes.rows) {
    const result = await syncUnitTypeBasePrice(db, unitType as UnitTypePrice);
    counts[result.status]++;
  }
  return { price_book: book, counts };
}

export function totalPrice(
  baseAmount: number | string,
  components: Record<string, unknown>,
) {
  return Number(baseAmount) + pricingComponentsTotal(components);
}
