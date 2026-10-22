-- Tenant isolation for the commerce-data tables (Phase 04).
--
-- Same defence-in-depth model as 0001 and 0003: authorization is enforced in
-- the application, and row-level security is the second layer. Every table
-- carries `organization_id`, so policies never need a join.
--
-- The application role is not the table owner; FORCE ROW LEVEL SECURITY also
-- covers the owner by accident, not by design.

ALTER TABLE "products" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "products" FORCE ROW LEVEL SECURITY;--> statement-breakpoint

CREATE POLICY "products_select" ON "products"
  FOR SELECT
  USING ("organization_id" = app.current_organization_id());--> statement-breakpoint

CREATE POLICY "products_insert" ON "products"
  FOR INSERT
  WITH CHECK ("organization_id" = app.current_organization_id());--> statement-breakpoint

CREATE POLICY "products_update" ON "products"
  FOR UPDATE
  USING ("organization_id" = app.current_organization_id())
  WITH CHECK ("organization_id" = app.current_organization_id());--> statement-breakpoint

CREATE POLICY "products_delete" ON "products"
  FOR DELETE
  USING ("organization_id" = app.current_organization_id());--> statement-breakpoint

ALTER TABLE "categories" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "categories" FORCE ROW LEVEL SECURITY;--> statement-breakpoint

CREATE POLICY "categories_select" ON "categories"
  FOR SELECT
  USING ("organization_id" = app.current_organization_id());--> statement-breakpoint

CREATE POLICY "categories_insert" ON "categories"
  FOR INSERT
  WITH CHECK ("organization_id" = app.current_organization_id());--> statement-breakpoint

CREATE POLICY "categories_update" ON "categories"
  FOR UPDATE
  USING ("organization_id" = app.current_organization_id())
  WITH CHECK ("organization_id" = app.current_organization_id());--> statement-breakpoint

CREATE POLICY "categories_delete" ON "categories"
  FOR DELETE
  USING ("organization_id" = app.current_organization_id());--> statement-breakpoint

ALTER TABLE "product_categories" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "product_categories" FORCE ROW LEVEL SECURITY;--> statement-breakpoint

CREATE POLICY "product_categories_select" ON "product_categories"
  FOR SELECT
  USING ("organization_id" = app.current_organization_id());--> statement-breakpoint

CREATE POLICY "product_categories_insert" ON "product_categories"
  FOR INSERT
  WITH CHECK ("organization_id" = app.current_organization_id());--> statement-breakpoint

CREATE POLICY "product_categories_update" ON "product_categories"
  FOR UPDATE
  USING ("organization_id" = app.current_organization_id())
  WITH CHECK ("organization_id" = app.current_organization_id());--> statement-breakpoint

CREATE POLICY "product_categories_delete" ON "product_categories"
  FOR DELETE
  USING ("organization_id" = app.current_organization_id());--> statement-breakpoint

ALTER TABLE "sync_runs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "sync_runs" FORCE ROW LEVEL SECURITY;--> statement-breakpoint

CREATE POLICY "sync_runs_select" ON "sync_runs"
  FOR SELECT
  USING ("organization_id" = app.current_organization_id());--> statement-breakpoint

CREATE POLICY "sync_runs_insert" ON "sync_runs"
  FOR INSERT
  WITH CHECK ("organization_id" = app.current_organization_id());--> statement-breakpoint

CREATE POLICY "sync_runs_update" ON "sync_runs"
  FOR UPDATE
  USING ("organization_id" = app.current_organization_id())
  WITH CHECK ("organization_id" = app.current_organization_id());--> statement-breakpoint

CREATE POLICY "sync_runs_delete" ON "sync_runs"
  FOR DELETE
  USING ("organization_id" = app.current_organization_id());--> statement-breakpoint

ALTER TABLE "sync_locks" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "sync_locks" FORCE ROW LEVEL SECURITY;--> statement-breakpoint

CREATE POLICY "sync_locks_select" ON "sync_locks"
  FOR SELECT
  USING ("organization_id" = app.current_organization_id());--> statement-breakpoint

CREATE POLICY "sync_locks_insert" ON "sync_locks"
  FOR INSERT
  WITH CHECK ("organization_id" = app.current_organization_id());--> statement-breakpoint

CREATE POLICY "sync_locks_update" ON "sync_locks"
  FOR UPDATE
  USING ("organization_id" = app.current_organization_id())
  WITH CHECK ("organization_id" = app.current_organization_id());--> statement-breakpoint

CREATE POLICY "sync_locks_delete" ON "sync_locks"
  FOR DELETE
  USING ("organization_id" = app.current_organization_id());
