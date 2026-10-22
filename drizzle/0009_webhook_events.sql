CREATE TABLE "webhook_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid,
	"store_id" uuid,
	"provider" text DEFAULT 'salla' NOT NULL,
	"event_name" text NOT NULL,
	"event_version" integer,
	"external_event_id" text,
	"external_store_id" text NOT NULL,
	"signature_strategy" text NOT NULL,
	"payload_hash" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" text DEFAULT 'received' NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processing_started_at" timestamp with time zone,
	"processed_at" timestamp with time zone,
	"failed_at" timestamp with time zone,
	"last_error_code" text,
	"last_error_message" text,
	"result" jsonb,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "webhook_events" ADD CONSTRAINT "webhook_events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_events" ADD CONSTRAINT "webhook_events_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "webhook_events_provider_hash_unique" ON "webhook_events" USING btree ("provider","payload_hash");--> statement-breakpoint
CREATE INDEX "webhook_events_status_available_idx" ON "webhook_events" USING btree ("status","available_at");--> statement-breakpoint
CREATE INDEX "webhook_events_org_received_idx" ON "webhook_events" USING btree ("organization_id","received_at");--> statement-breakpoint
CREATE INDEX "webhook_events_store_received_idx" ON "webhook_events" USING btree ("store_id","received_at");--> statement-breakpoint
CREATE INDEX "webhook_events_event_name_idx" ON "webhook_events" USING btree ("event_name");--> statement-breakpoint
CREATE INDEX "webhook_events_external_store_idx" ON "webhook_events" USING btree ("external_store_id");