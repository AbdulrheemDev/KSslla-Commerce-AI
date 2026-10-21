-- Tenant isolation policies.
--
-- The application authorization layer is the primary control; these policies are
-- defence in depth for the tables that hold tenant-owned rows. `users` and
-- `sessions` are intentionally excluded until Phase 24 (see docs/decisions.md).
--
-- Context is supplied per transaction by `withTenantTransaction` in
-- src/db/tenant.ts using `set_config(name, value, true)`, so pooled connections
-- cannot leak a previous request's tenant.

CREATE SCHEMA IF NOT EXISTS app;--> statement-breakpoint

CREATE OR REPLACE FUNCTION app.current_organization_id() RETURNS uuid
  LANGUAGE sql STABLE
  AS $$ SELECT nullif(current_setting('app.current_org', true), '')::uuid $$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION app.current_user_id() RETURNS uuid
  LANGUAGE sql STABLE
  AS $$ SELECT nullif(current_setting('app.current_user', true), '')::uuid $$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION app.current_invitation_token_hash() RETURNS text
  LANGUAGE sql STABLE
  AS $$ SELECT nullif(current_setting('app.invitation_token_hash', true), '') $$;--> statement-breakpoint

ALTER TABLE "organization_members" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "organization_members" FORCE ROW LEVEL SECURITY;--> statement-breakpoint

CREATE POLICY "organization_members_select" ON "organization_members"
  FOR SELECT
  USING (
    "organization_id" = app.current_organization_id()
    OR "user_id" = app.current_user_id()
  );--> statement-breakpoint

CREATE POLICY "organization_members_insert" ON "organization_members"
  FOR INSERT
  WITH CHECK ("organization_id" = app.current_organization_id());--> statement-breakpoint

CREATE POLICY "organization_members_update" ON "organization_members"
  FOR UPDATE
  USING ("organization_id" = app.current_organization_id())
  WITH CHECK ("organization_id" = app.current_organization_id());--> statement-breakpoint

CREATE POLICY "organization_members_delete" ON "organization_members"
  FOR DELETE
  USING ("organization_id" = app.current_organization_id());--> statement-breakpoint

ALTER TABLE "stores" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "stores" FORCE ROW LEVEL SECURITY;--> statement-breakpoint

CREATE POLICY "stores_select" ON "stores"
  FOR SELECT
  USING ("organization_id" = app.current_organization_id());--> statement-breakpoint

CREATE POLICY "stores_insert" ON "stores"
  FOR INSERT
  WITH CHECK ("organization_id" = app.current_organization_id());--> statement-breakpoint

CREATE POLICY "stores_update" ON "stores"
  FOR UPDATE
  USING ("organization_id" = app.current_organization_id())
  WITH CHECK ("organization_id" = app.current_organization_id());--> statement-breakpoint

CREATE POLICY "stores_delete" ON "stores"
  FOR DELETE
  USING ("organization_id" = app.current_organization_id());--> statement-breakpoint

ALTER TABLE "invitations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "invitations" FORCE ROW LEVEL SECURITY;--> statement-breakpoint

-- Org members see the invitations of their active organization. The second
-- clause allows an invitee holding the raw token to resolve exactly one row,
-- and nothing else, before any organization context exists.
CREATE POLICY "invitations_select" ON "invitations"
  FOR SELECT
  USING (
    "organization_id" = app.current_organization_id()
    OR "token_hash" = app.current_invitation_token_hash()
  );--> statement-breakpoint

CREATE POLICY "invitations_insert" ON "invitations"
  FOR INSERT
  WITH CHECK ("organization_id" = app.current_organization_id());--> statement-breakpoint

CREATE POLICY "invitations_update" ON "invitations"
  FOR UPDATE
  USING (
    "organization_id" = app.current_organization_id()
    OR "token_hash" = app.current_invitation_token_hash()
  )
  WITH CHECK ("organization_id" = app.current_organization_id());--> statement-breakpoint

CREATE POLICY "invitations_delete" ON "invitations"
  FOR DELETE
  USING ("organization_id" = app.current_organization_id());--> statement-breakpoint

ALTER TABLE "audit_logs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "audit_logs" FORCE ROW LEVEL SECURITY;--> statement-breakpoint

-- Append-only: SELECT and INSERT only. There is deliberately no UPDATE or
-- DELETE policy, so application traffic cannot rewrite history.
CREATE POLICY "audit_logs_select" ON "audit_logs"
  FOR SELECT
  USING ("organization_id" = app.current_organization_id());--> statement-breakpoint

CREATE POLICY "audit_logs_insert" ON "audit_logs"
  FOR INSERT
  WITH CHECK (
    "organization_id" IS NULL
    OR "organization_id" = app.current_organization_id()
  );
