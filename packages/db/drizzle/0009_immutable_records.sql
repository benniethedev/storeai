ALTER TABLE "records"
  ADD COLUMN IF NOT EXISTS "immutable" boolean NOT NULL DEFAULT false;
