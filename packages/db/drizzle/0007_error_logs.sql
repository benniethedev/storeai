CREATE TABLE IF NOT EXISTS "error_logs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid,
  "actor_user_id" uuid,
  "actor_api_key_id" uuid,
  "route" varchar(255) NOT NULL,
  "method" varchar(10) NOT NULL,
  "status_code" integer NOT NULL,
  "code" varchar(80) NOT NULL,
  "message" text NOT NULL,
  "request_id" varchar(40),
  "stack" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

DO $$ BEGIN
 ALTER TABLE "error_logs" ADD CONSTRAINT "error_logs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
 ALTER TABLE "error_logs" ADD CONSTRAINT "error_logs_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
 ALTER TABLE "error_logs" ADD CONSTRAINT "error_logs_actor_api_key_id_api_keys_id_fk" FOREIGN KEY ("actor_api_key_id") REFERENCES "api_keys"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

CREATE INDEX IF NOT EXISTS "error_logs_tenant_created_idx" ON "error_logs" ("tenant_id","created_at");
CREATE INDEX IF NOT EXISTS "error_logs_route_created_idx" ON "error_logs" ("route","created_at");
