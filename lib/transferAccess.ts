import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { parseUuid } from "@/lib/operations";
import {
  canAccessOperationsEntity,
  requireOperationsContext,
} from "@/lib/operationsAccess";
import { getTransfer } from "@/lib/transfers";

export async function requireTransfer(
  request: NextRequest,
  rawTransferId: string,
) {
  const scope = await requireOperationsContext(request);
  if (!scope.ok) return scope;
  const transferId = parseUuid(rawTransferId);
  if (!transferId)
    return {
      ok: false as const,
      response: NextResponse.json(
        { error: "transferId must be a valid UUID" },
        { status: 400 },
      ),
    };
  try {
    const transfer = await getTransfer(pool, transferId);
    if (!transfer)
      return {
        ok: false as const,
        response: NextResponse.json(
          { error: "Transfer not found" },
          { status: 404 },
        ),
      };
    if (
      !canAccessOperationsEntity(
        scope.context.access,
        Number(transfer.company_id),
        Number(transfer.project_id),
      )
    )
      return {
        ok: false as const,
        response: NextResponse.json(
          { error: "You do not have access to this transfer" },
          { status: 403 },
        ),
      };
    return {
      ok: true as const,
      context: scope.context,
      transferId,
      transfer,
    };
  } catch (error) {
    console.error("Failed to resolve transfer access", error);
    return {
      ok: false as const,
      response: NextResponse.json(
        { error: "Unable to retrieve transfer" },
        { status: 500 },
      ),
    };
  }
}

