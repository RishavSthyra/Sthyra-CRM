import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { ACCOUNT_COLUMNS, validateAccountPayload } from "@/lib/accounts";
import { parsePagination } from "@/utils/parsePagination";

export async function GET(request: NextRequest) {
  const pagination = parsePagination(request.nextUrl.searchParams);
  if (!pagination.ok) {
    return NextResponse.json({ error: pagination.error }, { status: 400 });
  }

  const values: unknown[] = [];
  const filters = ["archived_at IS NULL"];
  const search = request.nextUrl.searchParams.get("search")?.trim();
  if (search) {
    values.push(`%${search}%`);
    filters.push(`name ILIKE $${values.length}`);
  }
  const accountType = request.nextUrl.searchParams.get("account_type")?.trim();
  if (accountType) {
    values.push(accountType.toLowerCase());
    filters.push(`account_type = $${values.length}`);
  }
  const whereClause = `WHERE ${filters.join(" AND ")}`;

  try {
    const countResult = await pool.query(
      `SELECT COUNT(*)::integer AS total FROM accounts ${whereClause}`,
      values,
    );
    const listValues = [...values, pagination.limit, pagination.offset];
    const result = await pool.query(
      `SELECT ${ACCOUNT_COLUMNS}
       FROM accounts
       ${whereClause}
       ORDER BY name ASC, account_id ASC
       LIMIT $${listValues.length - 1}
       OFFSET $${listValues.length}`,
      listValues,
    );
    const total = Number(countResult.rows[0]?.total ?? 0);
    return NextResponse.json({
      accounts: result.rows,
      pagination: {
        page: pagination.page,
        limit: pagination.limit,
        total,
        totalPages: Math.ceil(total / pagination.limit),
      },
    });
  } catch (error) {
    console.error("Failed to list accounts", error);
    return NextResponse.json(
      { error: "Unable to retrieve accounts" },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Request body must contain valid JSON" },
      { status: 400 },
    );
  }
  const validation = validateAccountPayload(body, { partial: false });
  if (!validation.ok) {
    return NextResponse.json(
      { error: "Validation failed", details: validation.errors },
      { status: 422 },
    );
  }

  try {
    const result = await pool.query(
      `INSERT INTO accounts (name, account_type)
       VALUES ($1, $2)
       RETURNING ${ACCOUNT_COLUMNS}`,
      [validation.data.name, validation.data.account_type],
    );
    return NextResponse.json(
      { message: "Account created", account: result.rows[0] },
      { status: 201 },
    );
  } catch (error) {
    console.error("Failed to create account", error);
    return NextResponse.json(
      { error: "Unable to create account" },
      { status: 500 },
    );
  }
}
