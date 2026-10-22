-- Tenant isolation for the Phase 05 tables: customers, orders, order_items,
-- inventory_levels.
--
-- Same defence-in-depth model as 0001, 0003, and 0005: authorization is
-- enforced in the application, and row-level security is the second layer.
-- Every table carries `organization_id`, so policies never need a join.
--
-- The application role is not the table owner; FORCE ROW LEVEL SECURITY also
-- covers the owner by accident, not by design.

ALTER TABLE "customers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "customers" FORCE ROW LEVEL SECURITY;--> statement-breakpoint

CREATE POLICY "customers_select" ON "customers"
  FOR SELECT
  USING ("organization_id" = app.current_organization_id());--> statement-breakpoint

CREATE POLICY "customers_insert" ON "customers"
  FOR INSERT
  WITH CHECK ("organization_id" = app.current_organization_id());--> statement-breakpoint

CREATE POLICY "customers_update" ON "customers"
  FOR UPDATE
  USING ("organization_id" = app.current_organization_id())
  WITH CHECK ("organization_id" = app.current_organization_id());--> statement-breakpoint

CREATE POLICY "customers_delete" ON "customers"
  FOR DELETE
  USING ("organization_id" = app.current_organization_id());--> statement-breakpoint

ALTER TABLE "orders" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "orders" FORCE ROW LEVEL SECURITY;--> statement-breakpoint

CREATE POLICY "orders_select" ON "orders"
  FOR SELECT
  USING ("organization_id" = app.current_organization_id());--> statement-breakpoint

CREATE POLICY "orders_insert" ON "orders"
  FOR INSERT
  WITH CHECK ("organization_id" = app.current_organization_id());--> statement-breakpoint

CREATE POLICY "orders_update" ON "orders"
  FOR UPDATE
  USING ("organization_id" = app.current_organization_id())
  WITH CHECK ("organization_id" = app.current_organization_id());--> statement-breakpoint

CREATE POLICY "orders_delete" ON "orders"
  FOR DELETE
  USING ("organization_id" = app.current_organization_id());--> statement-breakpoint

ALTER TABLE "order_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "order_items" FORCE ROW LEVEL SECURITY;--> statement-breakpoint

CREATE POLICY "order_items_select" ON "order_items"
  FOR SELECT
  USING ("organization_id" = app.current_organization_id());--> statement-breakpoint

CREATE POLICY "order_items_insert" ON "order_items"
  FOR INSERT
  WITH CHECK ("organization_id" = app.current_organization_id());--> statement-breakpoint

CREATE POLICY "order_items_update" ON "order_items"
  FOR UPDATE
  USING ("organization_id" = app.current_organization_id())
  WITH CHECK ("organization_id" = app.current_organization_id());--> statement-breakpoint

CREATE POLICY "order_items_delete" ON "order_items"
  FOR DELETE
  USING ("organization_id" = app.current_organization_id());--> statement-breakpoint

ALTER TABLE "inventory_levels" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "inventory_levels" FORCE ROW LEVEL SECURITY;--> statement-breakpoint

CREATE POLICY "inventory_levels_select" ON "inventory_levels"
  FOR SELECT
  USING ("organization_id" = app.current_organization_id());--> statement-breakpoint

CREATE POLICY "inventory_levels_insert" ON "inventory_levels"
  FOR INSERT
  WITH CHECK ("organization_id" = app.current_organization_id());--> statement-breakpoint

CREATE POLICY "inventory_levels_update" ON "inventory_levels"
  FOR UPDATE
  USING ("organization_id" = app.current_organization_id())
  WITH CHECK ("organization_id" = app.current_organization_id());--> statement-breakpoint

CREATE POLICY "inventory_levels_delete" ON "inventory_levels"
  FOR DELETE
  USING ("organization_id" = app.current_organization_id());
