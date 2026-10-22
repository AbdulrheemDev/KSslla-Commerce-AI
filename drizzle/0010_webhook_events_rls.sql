-- Webhook inbox: state constraints, tenant isolation, and worker context.
--
-- Two contexts exist for this table (ADR-046):
--   * tenant context  — `app.current_org` set from the session;
--   * worker context  — `app.webhook_worker = 'on'`, set **only** by the
--     webhook worker when it claims rows. No HTTP request path sets it.
--
-- Ingestion itself needs neither: a resolved event is inserted inside the
-- tenant transaction of the store it belongs to, and an unresolved one is
-- inserted with `organization_id IS NULL`, which no tenant can ever read.

ALTER TABLE "webhook_events"
  ADD CONSTRAINT "webhook_events_status_check"
  CHECK ("status" IN ('received', 'processing', 'processed', 'failed', 'dead_letter', 'unmatched', 'ignored'));--> statement-breakpoint

ALTER TABLE "webhook_events"
  ADD CONSTRAINT "webhook_events_attempts_check"
  CHECK ("attempt_count" >= 0);--> statement-breakpoint

CREATE OR REPLACE FUNCTION app.is_webhook_worker() RETURNS boolean
  LANGUAGE sql STABLE
  AS $$ SELECT current_setting('app.webhook_worker', true) = 'on' $$;--> statement-breakpoint

-- Narrower than the worker: it only reaches rows that belong to no tenant, and
-- only so the public endpoint can insert and re-read an unresolved delivery.
CREATE OR REPLACE FUNCTION app.is_webhook_ingest() RETURNS boolean
  LANGUAGE sql STABLE
  AS $$ SELECT current_setting('app.webhook_ingest', true) = 'on' $$;--> statement-breakpoint

ALTER TABLE "webhook_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "webhook_events" FORCE ROW LEVEL SECURITY;--> statement-breakpoint

CREATE POLICY "webhook_events_select" ON "webhook_events"
  FOR SELECT
  USING (
    "organization_id" = app.current_organization_id()
    OR app.is_webhook_worker()
    -- `INSERT … RETURNING` is checked against this policy too, so the ingestion
    -- path needs to see the ownerless row it just wrote. Tenants never do.
    OR ("organization_id" IS NULL AND app.is_webhook_ingest())
  );--> statement-breakpoint

-- An unresolved event (`organization_id IS NULL`) has no tenant owner; it can
-- be written by the public ingestion path but is readable only by the worker.
CREATE POLICY "webhook_events_insert" ON "webhook_events"
  FOR INSERT
  WITH CHECK (
    "organization_id" IS NULL
    OR "organization_id" = app.current_organization_id()
    OR app.is_webhook_worker()
  );--> statement-breakpoint

CREATE POLICY "webhook_events_update" ON "webhook_events"
  FOR UPDATE
  USING (
    "organization_id" = app.current_organization_id()
    OR app.is_webhook_worker()
  )
  WITH CHECK (
    "organization_id" = app.current_organization_id()
    OR app.is_webhook_worker()
  );--> statement-breakpoint

-- No DELETE policy: the inbox is append-mostly history. Rows are removed only
-- by the organization cascade, never by application traffic.

-- ─────────────────────────────────────────────────────────────────────────────
-- Store resolution for the public ingestion path.
--
-- The webhook endpoint runs without a tenant, so it cannot read
-- `store_connections` (RLS). This function is the narrow, read-only bridge: it
-- maps a provider store id to its internal ids and nothing else — no tokens, no
-- names, no scopes. `SECURITY DEFINER` lets it run with the owner's rights; the
-- result contains no credential, so exposure is limited to the mapping itself.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION app.resolve_salla_store(p_external_store_id text)
RETURNS TABLE (organization_id uuid, store_id uuid, connection_status text)
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $$
    SELECT c.organization_id, c.store_id, c.status::text
      FROM store_connections c
     WHERE c.provider = 'salla'
       AND c.external_store_id = p_external_store_id
     LIMIT 1
  $$;--> statement-breakpoint
