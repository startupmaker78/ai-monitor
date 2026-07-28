-- Целевое действие (Path M): опциональные поля цели анализа.
-- Аддитивно, всё nullable, без дефолтов/бэкфилла. Существующие цели
-- продолжают работать как прежний поведенческий анализ.
-- AlterTable
ALTER TABLE "AnalysisTarget" ADD COLUMN "goalAttachedAt" TIMESTAMP(3),
ADD COLUMN "metrikaGoalId" TEXT,
ADD COLUMN "metrikaGoalName" TEXT,
ADD COLUMN "metrikaGoalType" TEXT;
