BEGIN;

DO $calendar_seed$
DECLARE
  v_company_id INTEGER;
  v_project_id INTEGER;
  v_user_id UUID;
  v_lead_ids UUID[];
  v_contact_ids UUID[];
  v_existing INTEGER;
  v_index INTEGER;
  v_lead_index INTEGER;
  v_day_offset INTEGER;
  v_starts_at TIMESTAMPTZ;
  v_ends_at TIMESTAMPTZ;
  v_type VARCHAR(30);
  v_status VARCHAR(20);
  v_title VARCHAR(250);
  v_location VARCHAR(500);
  v_appointment appointments%ROWTYPE;
  v_types TEXT[] := ARRAY['call', 'meeting', 'site_visit', 'video', 'other'];
  v_titles TEXT[] := ARRAY[
    'Qualification call',
    'Project discovery meeting',
    'Sample flat site visit',
    'Virtual property tour',
    'Document collection',
    'Budget follow-up',
    'Pricing consultation',
    'Tower walkthrough',
    'Remote family consultation',
    'Home loan consultation',
    'Decision-maker check-in',
    'Floor plan review',
    'Amenities tour',
    'Online payment walkthrough',
    'Registration preparation'
  ];
BEGIN
  SELECT p.company_id, p.project_id
    INTO v_company_id, v_project_id
  FROM projects p
  WHERE p.is_active=TRUE
    AND EXISTS (SELECT 1 FROM leads l WHERE l.project_id=p.project_id)
  ORDER BY (p.project_code='DEMO-CRM') DESC, p.project_id
  LIMIT 1;

  IF v_project_id IS NULL THEN
    RAISE NOTICE 'Calendar showcase skipped: no active project with leads exists.';
    RETURN;
  END IF;

  SELECT u.user_id
    INTO v_user_id
  FROM users u
  JOIN teams t ON t.team_id=u.team_id
  WHERE t.company_id=v_company_id
    AND t.is_active=TRUE
    AND u.is_active=TRUE
    AND u.deleted_at IS NULL
  ORDER BY u.created_at
  LIMIT 1;

  IF v_user_id IS NULL THEN
    RAISE NOTICE 'Calendar showcase skipped: no active company user exists.';
    RETURN;
  END IF;

  SELECT
    ARRAY_AGG(l.lead_id ORDER BY l.updated_at DESC, l.lead_id),
    ARRAY_AGG(l.contact_id ORDER BY l.updated_at DESC, l.lead_id)
    INTO v_lead_ids, v_contact_ids
  FROM leads l
  WHERE l.project_id=v_project_id;

  SELECT COUNT(*)::INTEGER
    INTO v_existing
  FROM appointments ap
  JOIN activities a
    ON a.source_type='appointment'
   AND a.source_id=ap.appointment_id
   AND a.metadata->>'demo_seed'='calendar-showcase-v1'
  WHERE ap.project_id=v_project_id;

  IF v_existing >= 60 THEN
    RAISE NOTICE 'Calendar showcase already contains % appointments.', v_existing;
    RETURN;
  END IF;

  FOR v_index IN v_existing..59 LOOP
    v_lead_index := (v_index % ARRAY_LENGTH(v_lead_ids, 1)) + 1;
    v_day_offset := ((v_index * 7) % 50) - 12;
    v_starts_at := DATE_TRUNC('day', CURRENT_TIMESTAMP)
      + MAKE_INTERVAL(days => v_day_offset, hours => 8 + ((v_index * 3) % 11))
      + CASE WHEN v_index % 3 = 0 THEN INTERVAL '30 minutes' ELSE INTERVAL '0 minutes' END;
    v_ends_at := v_starts_at
      + ((ARRAY[30, 45, 60, 90])[(v_index % 4) + 1] || ' minutes')::INTERVAL;
    v_type := v_types[(v_index % ARRAY_LENGTH(v_types, 1)) + 1];
    v_title := v_titles[(v_index % ARRAY_LENGTH(v_titles, 1)) + 1];
    v_location := CASE
      WHEN v_type='site_visit' THEN 'CRM Demo Project · Site office'
      WHEN v_type='video' THEN 'Online'
      WHEN v_type='call' THEN 'Phone'
      WHEN v_index % 2 = 0 THEN 'Sales lounge'
      ELSE 'CRM Demo Project'
    END;
    v_status := CASE
      WHEN v_ends_at < CURRENT_TIMESTAMP AND v_index % 5 = 0 THEN 'scheduled'
      WHEN v_ends_at < CURRENT_TIMESTAMP AND v_index % 7 = 0 THEN 'cancelled'
      WHEN v_ends_at < CURRENT_TIMESTAMP THEN 'completed'
      WHEN v_index % 4 = 0 THEN 'confirmed'
      WHEN v_index % 6 = 0 THEN 'rescheduled'
      ELSE 'scheduled'
    END;

    INSERT INTO appointments (
      company_id, project_id, lead_id, contact_id, appointment_type, title,
      description, location, meeting_url, starts_at, ends_at, timezone, status,
      organizer_user_id, assigned_to_user_id, created_by, updated_by,
      confirmed_at, confirmed_by, completed_at, completed_by, cancelled_at,
      cancelled_by, cancellation_reason, reschedule_reason
    ) VALUES (
      v_company_id,
      v_project_id,
      v_lead_ids[v_lead_index],
      v_contact_ids[v_lead_index],
      v_type,
      v_title,
      'Review the latest lead requirements, confirm the next action, and keep the opportunity moving.',
      v_location,
      CASE WHEN v_type='video' THEN
        'https://meet.google.com/sthyra-' || LPAD((v_index + 1)::TEXT, 3, '0')
      ELSE NULL END,
      v_starts_at,
      v_ends_at,
      'Asia/Kolkata',
      v_status,
      v_user_id,
      v_user_id,
      v_user_id,
      v_user_id,
      CASE WHEN v_status='confirmed' THEN CURRENT_TIMESTAMP ELSE NULL END,
      CASE WHEN v_status='confirmed' THEN v_user_id ELSE NULL END,
      CASE WHEN v_status='completed' THEN v_ends_at ELSE NULL END,
      CASE WHEN v_status='completed' THEN v_user_id ELSE NULL END,
      CASE WHEN v_status='cancelled' THEN CURRENT_TIMESTAMP ELSE NULL END,
      CASE WHEN v_status='cancelled' THEN v_user_id ELSE NULL END,
      CASE WHEN v_status='cancelled' THEN 'Lead requested a different follow-up path' ELSE NULL END,
      CASE WHEN v_status='rescheduled' THEN 'Adjusted to match lead availability' ELSE NULL END
    ) RETURNING * INTO v_appointment;

    INSERT INTO activities (
      company_id, project_id, lead_id, contact_id, activity_type, source_type,
      source_id, title, description, metadata, occurred_at, actor_user_id
    ) VALUES (
      v_company_id,
      v_project_id,
      v_appointment.lead_id,
      v_appointment.contact_id,
      CASE
        WHEN v_status='completed' THEN 'appointment_completed'
        WHEN v_status='cancelled' THEN 'appointment_cancelled'
        WHEN v_status='rescheduled' THEN 'appointment_rescheduled'
        ELSE 'appointment_created'
      END,
      'appointment',
      v_appointment.appointment_id,
      'Appointment ' || CASE WHEN v_status='completed' THEN 'completed: ' ELSE 'scheduled: ' END || v_title,
      v_appointment.description,
      JSONB_BUILD_OBJECT(
        'appointment_type', v_type,
        'starts_at', v_starts_at,
        'ends_at', v_ends_at,
        'status', v_status,
        'demo_seed', 'calendar-showcase-v1'
      ),
      LEAST(v_starts_at - INTERVAL '2 hours', CURRENT_TIMESTAMP),
      v_user_id
    );
  END LOOP;
END
$calendar_seed$;

COMMIT;
