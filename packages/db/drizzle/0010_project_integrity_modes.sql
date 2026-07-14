-- Reconciliation migration for development databases that applied the first
-- integrity draft. It is also safe after a fresh 0008 migration.
DO $$ BEGIN
  CREATE TYPE "project_integrity_mode" AS ENUM ('legacy', 'strict');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

ALTER TABLE "projects"
  ADD COLUMN IF NOT EXISTS "integrity_mode" "project_integrity_mode" NOT NULL DEFAULT 'legacy';

-- All projects that predate this rollout remain behaviorally unchanged.
UPDATE "projects" SET "integrity_mode" = 'legacy' WHERE "integrity_mode" IS NULL;
ALTER TABLE "projects" ALTER COLUMN "integrity_mode" SET DEFAULT 'strict';

ALTER TABLE "records"
  ADD COLUMN IF NOT EXISTS "strict_identity" boolean NOT NULL DEFAULT false;

DROP INDEX IF EXISTS "records_tenant_project_key_uq";
CREATE INDEX IF NOT EXISTS "records_tenant_project_key_idx"
  ON "records" ("tenant_id", "project_id", "key");
CREATE UNIQUE INDEX IF NOT EXISTS "records_strict_project_key_uq"
  ON "records" ("tenant_id", "project_id", "key")
  WHERE "strict_identity" = true;

CREATE OR REPLACE FUNCTION storeai_set_record_integrity()
RETURNS trigger AS $$
BEGIN
  SELECT ("integrity_mode" = 'strict')
    INTO NEW."strict_identity"
    FROM "projects"
    WHERE "id" = NEW."project_id" AND "tenant_id" = NEW."tenant_id";
  IF NEW."strict_identity" IS NULL THEN
    RAISE EXCEPTION 'Record project does not belong to tenant';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "records_set_integrity" ON "records";
CREATE TRIGGER "records_set_integrity"
BEFORE INSERT OR UPDATE OF "project_id", "tenant_id", "strict_identity"
ON "records"
FOR EACH ROW EXECUTE FUNCTION storeai_set_record_integrity();
