-- Корректировка предыдущей data migration в
-- 20260505223845_add_budget_spent_to_analysis_target.
--
-- Первая миграция использовала false proxy: WHERE sessionsCollected > 0.
-- Это охватило ACTIVE/READY цели у которых были собранные сессии,
-- но анализ ещё не запускался (например, seed-данные с "Блог"
-- ACTIVE collected=71). Для таких целей budgetSpent должен быть false
-- — юзер ещё не запустил анализ, имеет право архивировать и
-- получить бюджет обратно.
--
-- Семантика budgetSpent: "AI-анализ был запущен и потратил бюджет".
-- Прокси по статусу: ANALYZING/COMPLETED означает анализ был
-- запущен. ACTIVE/READY — нет.
-- ARCHIVED цели с sessionsCollected > 0 оставляем budgetSpent=true
-- (они были COMPLETED до архивации — анализ был).

UPDATE "AnalysisTarget"
SET "budgetSpent" = false
WHERE "status" IN ('ACTIVE', 'READY')
  AND "budgetSpent" = true;
