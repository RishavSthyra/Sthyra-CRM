-- Every assigned pre-sales lead needs one explicit next call. This backfills
-- existing active leads without changing any follow-up already recorded.
WITH candidates AS (
  SELECT
    lead.lead_id,
    latest_call.result AS latest_call_result,
    latest_call.occurred_at AS latest_call_at,
    ROW_NUMBER() OVER (
      ORDER BY COALESCE(lead.assigned_at, lead.created_at), lead.lead_id
    ) AS queue_position,
    COUNT(*) OVER () AS queue_size
  FROM leads lead
  LEFT JOIN LATERAL (
    SELECT
      COALESCE(call.outcome, call.status) AS result,
      COALESCE(call.ended_at, call.started_at, call.created_at) AS occurred_at
    FROM calls call
    WHERE call.lead_id = lead.lead_id
    ORDER BY COALESCE(call.ended_at, call.started_at, call.created_at) DESC,
             call.call_id DESC
    LIMIT 1
  ) latest_call ON TRUE
  WHERE lead.status IN ('active', 'nurture')
    AND (
      lead.current_owner_user_id IS NOT NULL
      OR lead.current_team_id IS NOT NULL
    )
    AND NOT EXISTS (
      SELECT 1
      FROM lead_next_actions next_action
      WHERE next_action.lead_id = lead.lead_id
    )
    AND COALESCE(latest_call.result, '') NOT IN (
      'not_interested',
      'wrong_number',
      'qualified',
      'do_not_call'
    )
), inserted AS (
  INSERT INTO lead_next_actions (
    lead_id,
    action_type,
    summary,
    due_at,
    status
  )
  SELECT
    candidate.lead_id,
    'call',
    CASE
      WHEN candidate.latest_call_result = 'no_answer'
        THEN 'Retry call — no answer'
      WHEN candidate.latest_call_result = 'voicemail'
        THEN 'Retry call — voicemail left'
      WHEN candidate.latest_call_result = 'interested'
        THEN 'Follow up after interested response'
      WHEN candidate.latest_call_result = 'follow_up'
        THEN 'Scheduled sales follow-up call'
      WHEN candidate.latest_call_result = 'connected'
        THEN 'Continue sales conversation'
      ELSE 'Initial sales call'
    END,
    CASE
      WHEN candidate.latest_call_result IN (
        'no_answer', 'voicemail', 'busy', 'missed', 'failed'
      ) THEN candidate.latest_call_at + INTERVAL '1 day'
      WHEN candidate.latest_call_result IN (
        'interested', 'follow_up', 'connected'
      ) THEN candidate.latest_call_at + INTERVAL '2 days'
      ELSE CURRENT_TIMESTAMP + (
        (candidate.queue_position - 1)::double precision
        / GREATEST(candidate.queue_size - 1, 1)
      ) * INTERVAL '48 hours'
    END,
    'pending'
  FROM candidates candidate
  ON CONFLICT (lead_id) DO NOTHING
  RETURNING *
)
INSERT INTO lead_next_action_history (
  lead_id,
  previous_action,
  next_action,
  performed_by
)
SELECT
  inserted.lead_id,
  NULL,
  TO_JSONB(inserted),
  NULL
FROM inserted;
