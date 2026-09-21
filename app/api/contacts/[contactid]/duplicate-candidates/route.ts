import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { parseContactId } from "@/lib/contacts";
import { parsePagination } from "@/utils/parsePagination";

type ContactContext = { params: Promise<{ contactid: string }> };

export async function GET(request: NextRequest, context: ContactContext) {
  const contactId = parseContactId((await context.params).contactid);
  if (!contactId) {
    return NextResponse.json(
      { error: "contactId must be a valid UUID" },
      { status: 400 },
    );
  }
  const pagination = parsePagination(request.nextUrl.searchParams);
  if (!pagination.ok) {
    return NextResponse.json({ error: pagination.error }, { status: 400 });
  }

  try {
    const targetResult = await pool.query(
      `SELECT contact_id FROM contacts
       WHERE contact_id = $1 AND archived_at IS NULL AND merged_into_contact_id IS NULL`,
      [contactId],
    );
    if (targetResult.rowCount === 0) {
      return NextResponse.json({ error: "Contact not found" }, { status: 404 });
    }

    const result = await pool.query(
      `WITH target AS (
         SELECT * FROM contacts WHERE contact_id = $1
       )
       SELECT
         c.contact_id,
         c.account_id,
         c.first_name,
         c.last_name,
         c.phone_number,
         c.alternate_phone_number,
         c.email,
         c.date_of_birth::text AS date_of_birth,
         c.country,
         c.company_works_at,
         c.created_at,
         match_data.match_score,
         match_data.match_reasons
       FROM contacts c
       CROSS JOIN target t
       CROSS JOIN LATERAL (
         SELECT
           (CASE WHEN c.email IS NOT NULL AND t.email IS NOT NULL
                     AND LOWER(c.email) = LOWER(t.email) THEN 60 ELSE 0 END
            + CASE WHEN c.phone_number IS NOT NULL AND t.phone_number IS NOT NULL
                     AND REGEXP_REPLACE(c.phone_number, '\\D', '', 'g') =
                         REGEXP_REPLACE(t.phone_number, '\\D', '', 'g') THEN 60 ELSE 0 END
            + CASE WHEN LOWER(CONCAT_WS(' ', c.first_name, c.last_name)) =
                         LOWER(CONCAT_WS(' ', t.first_name, t.last_name)) THEN 25 ELSE 0 END
            + CASE WHEN c.date_of_birth IS NOT NULL AND t.date_of_birth IS NOT NULL
                     AND c.date_of_birth = t.date_of_birth THEN 20 ELSE 0 END
            + CASE WHEN EXISTS (
                SELECT 1
                FROM contact_aliases ca
                JOIN contact_aliases ta
                  ON ta.normalized_value = ca.normalized_value
                 AND ta.alias_type = ca.alias_type
                WHERE ca.contact_id = c.contact_id AND ta.contact_id = t.contact_id
              ) THEN 40 ELSE 0 END) AS match_score,
           ARRAY_REMOVE(ARRAY[
             CASE WHEN c.email IS NOT NULL AND t.email IS NOT NULL
                        AND LOWER(c.email) = LOWER(t.email) THEN 'email' END,
             CASE WHEN c.phone_number IS NOT NULL AND t.phone_number IS NOT NULL
                        AND REGEXP_REPLACE(c.phone_number, '\\D', '', 'g') =
                            REGEXP_REPLACE(t.phone_number, '\\D', '', 'g') THEN 'phone' END,
             CASE WHEN LOWER(CONCAT_WS(' ', c.first_name, c.last_name)) =
                        LOWER(CONCAT_WS(' ', t.first_name, t.last_name)) THEN 'name' END,
             CASE WHEN c.date_of_birth IS NOT NULL AND t.date_of_birth IS NOT NULL
                        AND c.date_of_birth = t.date_of_birth THEN 'date_of_birth' END,
             CASE WHEN EXISTS (
                SELECT 1 FROM contact_aliases ca
                JOIN contact_aliases ta
                  ON ta.normalized_value = ca.normalized_value
                 AND ta.alias_type = ca.alias_type
                WHERE ca.contact_id = c.contact_id AND ta.contact_id = t.contact_id
             ) THEN 'alias' END
           ], NULL) AS match_reasons
       ) match_data
       WHERE c.contact_id <> $1
         AND c.archived_at IS NULL
         AND c.merged_into_contact_id IS NULL
         AND match_data.match_score >= 25
         AND NOT EXISTS (
           SELECT 1 FROM contact_duplicate_exclusions e
           WHERE (e.contact_id_low = $1 AND e.contact_id_high = c.contact_id)
              OR (e.contact_id_high = $1 AND e.contact_id_low = c.contact_id)
         )
       ORDER BY match_data.match_score DESC, c.created_at DESC
       LIMIT $2 OFFSET $3`,
      [contactId, pagination.limit, pagination.offset],
    );
    return NextResponse.json({
      candidates: result.rows,
      pagination: {
        page: pagination.page,
        limit: pagination.limit,
        returned: result.rows.length,
      },
    });
  } catch (error) {
    console.error("Failed to find duplicate candidates", error);
    return NextResponse.json(
      { error: "Unable to retrieve duplicate candidates" },
      { status: 500 },
    );
  }
}
