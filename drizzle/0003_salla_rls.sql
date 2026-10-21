-- Tenant isolation for Salla connection and OAuth state tables.
--
-- Same defence-in-depth model as 0001_rls.sql: application authorization is the
-- primary control, RLS is the second layer. The OAuth callback has exactly one
-- pre-organization lookup: it resolves a state by its HMAC, and only that single
-- row is visible for the transaction that sets `app.oauth_state_hash`.

CREATE OR REPLACE FUNCTION app.current_oauth_state_hash() RETURNS text
  LANGUAGE sql STABLE
  AS $$ SELECT nullif(current_setting('app.oauth_state_hash', true), '') $$;--> statement-breakpoint

ALTER TABLE "store_connections" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "store_connections" FORCE ROW LEVEL SECURITY;--> statement-breakpoint

CREATE POLICY "store_connections_select" ON "store_connections"
  FOR SELECT
  USING ("organization_id" = app.current_organization_id());--> statement-breakpoint

CREATE POLICY "store_connections_insert" ON "store_connections"
  FOR INSERT
  WITH CHECK ("organization_id" = app.current_organization_id());--> statement-breakpoint

CREATE POLICY "store_connections_update" ON "store_connections"
  FOR UPDATE
  USING ("organization_id" = app.current_organization_id())
  WITH CHECK ("organization_id" = app.current_organization_id());--> statement-breakpoint

CREATE POLICY "store_connections_delete" ON "store_connections"
  FOR DELETE
  USING ("organization_id" = app.current_organization_id());--> statement-breakpoint

ALTER TABLE "oauth_states" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "oauth_states" FORCE ROW LEVEL SECURITY;--> statement-breakpoint

CREATE POLICY "oauth_states_select" ON "oauth_states"
  FOR SELECT
  USING (
    "organization_id" = app.current_organization_id()
    OR "state_hash" = app.current_oauth_state_hash()
  );--> statement-breakpoint

CREATE POLICY "oauth_states_insert" ON "oauth_states"
  FOR INSERT
  WITH CHECK ("organization_id" = app.current_organization_id());--> statement-breakpoint

CREATE POLICY "oauth_states_update" ON "oauth_states"
  FOR UPDATE
  USING (
    "organization_id" = app.current_organization_id()
    OR "state_hash" = app.current_oauth_state_hash()
  )
  WITH CHECK ("organization_id" = app.current_organization_id());--> statement-breakpoint

CREATE POLICY "oauth_states_delete" ON "oauth_states"
  FOR DELETE
  USING ("organization_id" = app.current_organization_id());
