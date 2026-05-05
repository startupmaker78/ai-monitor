-- Удаление поля budgetSpent. Семантика "бюджет потрачен" теперь
-- живёт в простой формуле без флагов:
--   - active (archivedAt IS NULL): резерв = sessionsBudget
--   - archived: фиксируется sessionsCollected в момент архивации
-- Архивация ACTIVE/READY с collected>0 запрещена, поэтому seed-баг
-- "анализ→архив→повтор" закрыт без флагов.
-- См. DECISIONS.md "2026-05-05 (поздно вечером) — Hotfix 5".
ALTER TABLE "AnalysisTarget" DROP COLUMN "budgetSpent";
