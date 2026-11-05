-- Добавляем поля для Guacamole-подключения и агент-менеджера
ALTER TABLE "Session"
  ADD COLUMN IF NOT EXISTS "connectArgs"        TEXT,
  ADD COLUMN IF NOT EXISTS "connectArgsLeft"    TEXT,
  ADD COLUMN IF NOT EXISTS "connectArgsRight"   TEXT,
  ADD COLUMN IF NOT EXISTS "vmName"             TEXT,
  ADD COLUMN IF NOT EXISTS "guacId"             TEXT,
  ADD COLUMN IF NOT EXISTS "sharingProfileId"   TEXT,
  ADD COLUMN IF NOT EXISTS "sharingProfileIdLeft"  TEXT,
  ADD COLUMN IF NOT EXISTS "sharingProfileIdRight" TEXT,
  ADD COLUMN IF NOT EXISTS "guacAuthToken"      TEXT;

-- Удаляем устаревшее поле streamUrl
ALTER TABLE "Session" DROP COLUMN IF EXISTS "streamUrl";
