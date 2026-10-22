CREATE TABLE "categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"external_category_id" text NOT NULL,
	"name" text NOT NULL,
	"parent_external_id" text,
	"parent_category_id" uuid,
	"status" text NOT NULL,
	"sort_order" integer,
	"image_url" text,
	"source_updated_at" timestamp with time zone,
	"last_seen_at" timestamp with time zone NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_categories" (
	"organization_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_categories_product_id_category_id_pk" PRIMARY KEY("product_id","category_id")
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"external_product_id" text NOT NULL,
	"name" text NOT NULL,
	"sku" text,
	"product_type" text,
	"status" text NOT NULL,
	"price_amount" numeric(14, 2),
	"currency" text,
	"regular_price_amount" numeric(14, 2),
	"sale_price_amount" numeric(14, 2),
	"quantity" integer,
	"is_available" boolean DEFAULT false NOT NULL,
	"url" text,
	"image_url" text,
	"description" text,
	"brand_name" text,
	"source_updated_at" timestamp with time zone,
	"last_seen_at" timestamp with time zone NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sync_locks" (
	"organization_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"resource" text NOT NULL,
	"lock_id" uuid NOT NULL,
	"acquired_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"owner_run_id" uuid
);
--> statement-breakpoint
CREATE TABLE "sync_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"resource" text NOT NULL,
	"status" text NOT NULL,
	"correlation_id" uuid NOT NULL,
	"trigger" text DEFAULT 'manual' NOT NULL,
	"initiated_by_user_id" uuid,
	"pages_processed" integer DEFAULT 0 NOT NULL,
	"items_processed" integer DEFAULT 0 NOT NULL,
	"items_created" integer DEFAULT 0 NOT NULL,
	"items_updated" integer DEFAULT 0 NOT NULL,
	"relations_linked" integer DEFAULT 0 NOT NULL,
	"items_skipped" integer DEFAULT 0 NOT NULL,
	"error_code" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_parent_category_id_categories_id_fk" FOREIGN KEY ("parent_category_id") REFERENCES "public"."categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_categories" ADD CONSTRAINT "product_categories_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_categories" ADD CONSTRAINT "product_categories_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_categories" ADD CONSTRAINT "product_categories_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_categories" ADD CONSTRAINT "product_categories_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_locks" ADD CONSTRAINT "sync_locks_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_locks" ADD CONSTRAINT "sync_locks_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_locks" ADD CONSTRAINT "sync_locks_owner_run_id_sync_runs_id_fk" FOREIGN KEY ("owner_run_id") REFERENCES "public"."sync_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_runs" ADD CONSTRAINT "sync_runs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_runs" ADD CONSTRAINT "sync_runs_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_runs" ADD CONSTRAINT "sync_runs_initiated_by_user_id_users_id_fk" FOREIGN KEY ("initiated_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "categories_store_external_unique" ON "categories" USING btree ("store_id","external_category_id");--> statement-breakpoint
CREATE INDEX "categories_store_parent_idx" ON "categories" USING btree ("store_id","parent_category_id");--> statement-breakpoint
CREATE INDEX "categories_org_store_idx" ON "categories" USING btree ("organization_id","store_id");--> statement-breakpoint
CREATE INDEX "product_categories_store_category_idx" ON "product_categories" USING btree ("store_id","category_id");--> statement-breakpoint
CREATE INDEX "product_categories_org_idx" ON "product_categories" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "products_store_external_unique" ON "products" USING btree ("store_id","external_product_id");--> statement-breakpoint
CREATE INDEX "products_store_status_idx" ON "products" USING btree ("store_id","status");--> statement-breakpoint
CREATE INDEX "products_store_updated_idx" ON "products" USING btree ("store_id","updated_at");--> statement-breakpoint
CREATE INDEX "products_org_store_idx" ON "products" USING btree ("organization_id","store_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sync_locks_store_resource_unique" ON "sync_locks" USING btree ("store_id","resource");--> statement-breakpoint
CREATE INDEX "sync_locks_expiry_idx" ON "sync_locks" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "sync_runs_store_resource_started_idx" ON "sync_runs" USING btree ("store_id","resource","started_at");--> statement-breakpoint
CREATE INDEX "sync_runs_org_idx" ON "sync_runs" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "sync_runs_correlation_idx" ON "sync_runs" USING btree ("correlation_id");