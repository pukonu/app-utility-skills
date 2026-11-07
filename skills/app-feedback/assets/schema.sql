-- In-app feedback: table, indexes, tenant isolation and the three triage functions.
-- Postgres. Adapt: `tenant_id` to your tenant column (drop it and the policy in a
-- single-tenant app), `current_tenant_id()` to however your sessions expose the tenant,
-- `app_role` to the role your server connects as, and the joined tables in admin_feedback.

CREATE TABLE feedback_entries (
  id                  uuid PRIMARY KEY,                -- time-ordered (uuidv7) from the server
  tenant_id           uuid NOT NULL,
  sender_id           uuid,                             -- the signed-in user, if any
  screen              text,                             -- concrete path: /jobs/42
  route               text,                             -- pattern: (app)/jobs/[id]
  kind                text,                             -- problem | change | idea; null reads as 'note'
  screenshot_file_id  uuid,                             -- your files table
  rating              integer CHECK (rating BETWEEN 1 AND 5),
  comment             text,
  source              text NOT NULL DEFAULT 'app',      -- app | notes | ...
  status              text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'planned', 'done', 'wont_do')),
  app_version         text,
  platform            text,                             -- ios | android | web
  created_at          timestamptz NOT NULL DEFAULT now(),
  -- Optional, for scripted test journeys:
  journey             text,
  step                integer,
  step_title          text,
  as_described        text CHECK (as_described IN ('yes', 'partly', 'no'))
);

CREATE INDEX feedback_entries_tenant_idx ON feedback_entries (tenant_id, created_at);
CREATE INDEX feedback_entries_status_idx ON feedback_entries (status, created_at);
CREATE INDEX feedback_entries_journey_idx ON feedback_entries (journey, step);

-- Tenant isolation (multi-tenant apps).
ALTER TABLE feedback_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE feedback_entries FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON feedback_entries
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());
GRANT SELECT, INSERT, UPDATE ON feedback_entries TO app_role;

-- Triage: narrow cross-tenant reads for the internal portal. SECURITY DEFINER so the
-- app role can call them without the table being opened; granted to that role only.

CREATE OR REPLACE FUNCTION admin_feedback(p_status text, p_kind text, p_limit integer, p_offset integer)
  RETURNS TABLE (
    id uuid, tenant_id uuid, tenant_name text, sender_id uuid, sender_name text, sender_contact text,
    screen text, route text, kind text, rating integer, comment text, app_version text, platform text,
    status text, created_at timestamptz, screenshot_key text, total bigint
  )
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS
$$
  SELECT f.id, f.tenant_id, t.name, f.sender_id,
         nullif(trim(coalesce(u.first_name, '') || ' ' || coalesce(u.last_name, '')), ''), u.phone,
         f.screen, f.route, f.kind, f.rating, f.comment, f.app_version, f.platform, f.status, f.created_at,
         fl.key, count(*) OVER ()
  FROM feedback_entries f
  LEFT JOIN tenants t ON t.id = f.tenant_id
  LEFT JOIN users u ON u.id = f.sender_id AND u.tenant_id = f.tenant_id
  LEFT JOIN files fl ON fl.id = f.screenshot_file_id AND fl.tenant_id = f.tenant_id AND fl.status = 'uploaded'
  WHERE (p_status IS NULL OR f.status = p_status)
    AND (p_kind IS NULL OR coalesce(f.kind, 'note') = p_kind)
  ORDER BY f.created_at DESC, f.id DESC
  LIMIT least(greatest(p_limit, 1), 200) OFFSET greatest(p_offset, 0)
$$;

CREATE OR REPLACE FUNCTION admin_feedback_counts()
  RETURNS TABLE (status text, kind text, n bigint)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS
$$ SELECT status, coalesce(kind, 'note'), count(*) FROM feedback_entries GROUP BY 1, 2 $$;

CREATE OR REPLACE FUNCTION admin_feedback_lookup(p_id uuid)
  RETURNS TABLE (tenant_id uuid)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS
$$ SELECT tenant_id FROM feedback_entries WHERE id = p_id $$;

DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY['admin_feedback(text, text, integer, integer)', 'admin_feedback_counts()', 'admin_feedback_lookup(uuid)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO app_role', f);
  END LOOP;
END $$;
