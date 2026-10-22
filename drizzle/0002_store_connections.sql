CREATE TYPE "public"."connection_provider" AS ENUM('salla');--> statement-breakpoint
CREATE TYPE "public"."connection_status" AS ENUM('authorizing', 'connected', 'refreshing', 'reauth_required', 'revoked', 'error', 'disconnected');--> statement-breakpoint
CREATE TABLE "store_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"provider" "connection_provider" DEFAULT 'salla' NOT NULL,
	"status" "connection_status" DEFAULT 'authorizing' NOT NULL,
	"external_store_id" text,
	"external_user_id" text,
	"external_store_name" text,
	"scopes" text[] DEFAULT '{}'::text[] NOT NULL,
	"access_token_ciphertext" text,
	"refresh_token_ciphertext" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"token_version" integer DEFAULT 0 NOT NULL,
	"connected_at" timestamp with time zone,
	"last_refresh_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"last_error_code" text,
	"refresh_lock_id" text,
	"refresh_lock_expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "oauth_states" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"state_hash" text NOT NULL,
	"user_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"provider" "connection_provider" DEFAULT 'salla' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP INDEX "stores_platform_external_unique";--> statement-breakpoint
ALTER TABLE "store_connections" ADD CONSTRAINT "store_connections_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_connections" ADD CONSTRAINT "store_connections_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_states" ADD CONSTRAINT "oauth_states_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_states" ADD CONSTRAINT "oauth_states_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_states" ADD CONSTRAINT "oauth_states_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "store_connections_store_provider_unique" ON "store_connections" USING btree ("store_id","provider");--> statement-breakpoint
CREATE UNIQUE INDEX "store_connections_provider_external_unique" ON "store_connections" USING btree ("provider","external_store_id") WHERE "store_connections"."external_store_id" is not null;--> statement-breakpoint
CREATE INDEX "store_connections_org_status_idx" ON "store_connections" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "store_connections_expiry_idx" ON "store_connections" USING btree ("access_token_expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "oauth_states_hash_unique" ON "oauth_states" USING btree ("state_hash");--> statement-breakpoint
CREATE INDEX "oauth_states_store_idx" ON "oauth_states" USING btree ("store_id","provider");--> statement-breakpoint
CREATE INDEX "oauth_states_expiry_idx" ON "oauth_states" USING btree ("expires_at");--> statement-breakpoint
ALTER TABLE "stores" DROP COLUMN "external_store_id";