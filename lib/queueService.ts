import type { PoolClient } from "pg";
import { QueueInput } from "@/lib/operations";
import { OperationsReferenceError } from "@/lib/assignmentService";

export async function validateQueueReferences(
  client: PoolClient,
  companyId: number,
  queue: QueueInput,
): Promise<void> {
  if (queue.project_id) {
    const project = await client.query(
      "SELECT project_id FROM projects WHERE project_id=$1 AND company_id=$2 AND is_active=TRUE",
      [queue.project_id, companyId],
    );
    if (!project.rowCount)
      throw new OperationsReferenceError("Active company project not found");
  }
  if (queue.team_id) {
    const team = await client.query(
      "SELECT team_id FROM teams WHERE team_id=$1 AND company_id=$2 AND is_active=TRUE",
      [queue.team_id, companyId],
    );
    if (!team.rowCount)
      throw new OperationsReferenceError("Active company team not found");
  }
  if (queue.member_user_ids?.length) {
    const users = await client.query(
      `SELECT u.user_id FROM users u JOIN teams t ON t.team_id=u.team_id
       WHERE u.user_id=ANY($1::uuid[]) AND u.is_active=TRUE AND u.deleted_at IS NULL
         AND t.company_id=$2 AND t.is_active=TRUE`,
      [queue.member_user_ids, companyId],
    );
    if (users.rowCount !== queue.member_user_ids.length) {
      throw new OperationsReferenceError(
        "Every queue member must be an active user in the company",
      );
    }
  }
}

export async function replaceQueueMembers(
  client: PoolClient,
  queueId: string,
  memberUserIds: string[],
): Promise<void> {
  await client.query("DELETE FROM queue_members WHERE queue_id=$1", [queueId]);
  if (!memberUserIds.length) return;
  await client.query(
    `INSERT INTO queue_members (queue_id, user_id, position)
     SELECT $1, member.user_id, member.position::integer
     FROM UNNEST($2::uuid[]) WITH ORDINALITY AS member(user_id, position)`,
    [queueId, memberUserIds],
  );
}
