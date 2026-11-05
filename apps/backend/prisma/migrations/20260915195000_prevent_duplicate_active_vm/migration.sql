-- Одна VM может принадлежать только одной незавершённой сессии. Полная
-- уникальность vmName невозможна: после удаления VM её имя остаётся в истории.
-- До появления этого ограничения разные backend-инстансы могли записать одну
-- VM в несколько активных сессий. При первом применении ограничения считаем
-- все прежние VM-сессии устаревшими: незавершённые сессии завершаем как FAILED,
-- а runtime-данные VM, Guacamole и агента очищаем. История самих сессий и метрики
-- при этом сохраняются.
BEGIN;

-- Не даём старым backend-инстансам записать новый дубликат между очисткой
-- данных и созданием индекса. Чтение Session при этом остаётся доступным.
LOCK TABLE "Session" IN SHARE ROW EXCLUSIVE MODE;

UPDATE "Session"
SET
  "status" = CASE
    WHEN "status" IN ('COMPLETED', 'FAILED') THEN "status"
    ELSE 'FAILED'::"SessionStatus"
  END,
  "connectArgs" = NULL,
  "guacAuthToken" = NULL,
  "guacTunnelId" = NULL,
  "vmName" = NULL,
  "guacId" = NULL,
  "agentTaskUuid" = NULL,
  "agentJobId" = NULL,
  "sharingProfileId" = NULL,
  "updatedAt" = NOW()
WHERE "status" NOT IN ('COMPLETED', 'FAILED')
   OR "connectArgs" IS NOT NULL
   OR "guacAuthToken" IS NOT NULL
   OR "guacTunnelId" IS NOT NULL
   OR "vmName" IS NOT NULL
   OR "guacId" IS NOT NULL
   OR "agentTaskUuid" IS NOT NULL
   OR "agentJobId" IS NOT NULL
   OR "sharingProfileId" IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "Session_active_vmName_key"
ON "Session"("vmName")
WHERE "vmName" IS NOT NULL
  AND "status" NOT IN ('COMPLETED', 'FAILED');

COMMIT;
