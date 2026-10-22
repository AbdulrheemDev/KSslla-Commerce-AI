CREATE TABLE "customers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"external_customer_id" text NOT NULL,
	"first_name" text,
	"last_name" text,
	"email" text,
	"mobile" text,
	"mobile_code" text,
	"gender" text,
	"birthday" timestamp,
	"city" text,
	"country" text,
	"country_code" text,
	"currency" text,
	"language" text,
	"customer_type" text,
	"source_created_at" timestamp with time zone,
	"source_updated_at" timestamp with time zone,
	"last_seen_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "order_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"line_number" integer NOT NULL,
	"external_product_id" text,
	"external_sku_id" text,
	"product_id" uuid,
	"product_name" text NOT NULL,
	"sku" text,
	"quantity" integer NOT NULL,
	"unit_price" numeric(14, 2),
	"total_price" numeric(14, 2),
	"thumbnail_url" text,
	"link_status" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"external_order_id" text NOT NULL,
	"external_reference_id" text,
	"reference_id" text,
	"status_id" text,
	"status_name" text,
	"status_slug" text,
	"source" text,
	"total_amount" numeric(14, 2),
	"currency" text,
	"payment_method" text,
	"is_pending_payment" boolean DEFAULT false NOT NULL,
	"draft" boolean DEFAULT false NOT NULL,
	"order_date" timestamp with time zone,
	"order_timezone" text,
	"customer_id" uuid,
	"customer_external_id" text,
	"items_count" integer DEFAULT 0 NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inventory_levels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"quantity_key" text NOT NULL,
	"external_product_id" text NOT NULL,
	"external_sku_id" text,
	"product_id" uuid,
	"product_name" text NOT NULL,
	"sku" text,
	"variant" text,
	"image_url" text,
	"quantity" integer NOT NULL,
	"sold_quantity" integer NOT NULL,
	"unlimited_quantity" boolean DEFAULT false NOT NULL,
	"price_amount" numeric(14, 2),
	"price_currency" text,
	"last_synced_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_levels" ADD CONSTRAINT "inventory_levels_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_levels" ADD CONSTRAINT "inventory_levels_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_levels" ADD CONSTRAINT "inventory_levels_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "customers_store_external_unique" ON "customers" USING btree ("store_id","external_customer_id");--> statement-breakpoint
CREATE INDEX "customers_org_store_idx" ON "customers" USING btree ("organization_id","store_id");--> statement-breakpoint
CREATE INDEX "customers_store_updated_idx" ON "customers" USING btree ("store_id","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "order_items_order_line_unique" ON "order_items" USING btree ("order_id","line_number");--> statement-breakpoint
CREATE INDEX "order_items_store_product_idx" ON "order_items" USING btree ("store_id","external_product_id");--> statement-breakpoint
CREATE INDEX "order_items_org_idx" ON "order_items" USING btree ("organization_id","store_id");--> statement-breakpoint
CREATE UNIQUE INDEX "orders_store_external_unique" ON "orders" USING btree ("store_id","external_order_id");--> statement-breakpoint
CREATE INDEX "orders_store_date_idx" ON "orders" USING btree ("store_id","order_date");--> statement-breakpoint
CREATE INDEX "orders_store_status_idx" ON "orders" USING btree ("store_id","status_slug");--> statement-breakpoint
CREATE INDEX "orders_customer_idx" ON "orders" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "orders_org_store_idx" ON "orders" USING btree ("organization_id","store_id");--> statement-breakpoint
CREATE UNIQUE INDEX "inventory_levels_store_key_unique" ON "inventory_levels" USING btree ("store_id","quantity_key");--> statement-breakpoint
CREATE INDEX "inventory_levels_store_product_idx" ON "inventory_levels" USING btree ("store_id","external_product_id");--> statement-breakpoint
CREATE INDEX "inventory_levels_org_store_idx" ON "inventory_levels" USING btree ("organization_id","store_id");