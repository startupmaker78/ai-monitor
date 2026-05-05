-- Add budgetSpent column to AnalysisTarget.
-- DECISIONS.md "2026-05-05 — Hotfix 4: AnalysisTarget.budgetSpent —
-- правильная модель бюджета".
ALTER TABLE "AnalysisTarget" ADD COLUMN "budgetSpent" BOOLEAN NOT NULL DEFAULT false;

-- Data migration: для существующих записей где анализ уже проводился
-- (sessionsCollected > 0), помечаем бюджет как потраченный. Это
-- закрывает баг где архивированные COMPLETED цели возвращали бюджет.
UPDATE "AnalysisTarget"
SET "budgetSpent" = true
WHERE "sessionsCollected" > 0;
