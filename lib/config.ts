// Server-only runtime config. Читается из process.env при каждом
// вызове, чтобы значение можно было менять без пересборки образа —
// достаточно обновить Lockbox + передеплоить revision (env var
// подхватится процессом при старте контейнера).
//
// НЕ ставить NEXT_PUBLIC_ префикс: такой env var зашивается в build
// bundle на этапе сборки, и его изменение требует нового image.
// Значение прокидываем в client component через props из server
// component.

// Минимальный sessionsBudget при создании AnalysisTarget И минимум
// накопленных сессий для запуска анализа (Модель B «полная свобода»:
// budget — это КАП сбора, а запуск доступен при collected >= этого
// минимума). Дефолт 5 — продуктовое решение «свобода, но минимум от 5
// сессий». Переопределяется через MIN_SESSIONS_BUDGET (Lockbox).
export function getMinSessionsBudget(): number {
  const raw = process.env.MIN_SESSIONS_BUDGET
  const parsed = raw ? parseInt(raw, 10) : NaN
  if (Number.isFinite(parsed) && parsed > 0) return parsed
  return 5
}

// Минимум визитов Метрики по странице, ниже которого конверсия считается
// НЕДОСТОВЕРНОЙ (флаг lowConfidence — UI подпишет как «мало данных», по
// аналогии с бейджем рекомендаций). НЕ скрываем число и НЕ подменяем 0 —
// просто помечаем шум. Дефолт 30 — ГИПОТЕЗА, взят с потолка, эмпирикой не
// проверен (см. DECISIONS 2026-07-28 «Порог достаточности данных»).
// Переопределяется через MIN_PAGE_VISITS_FOR_CONVERSION (Lockbox).
export function getMinPageVisitsForConversion(): number {
  const raw = process.env.MIN_PAGE_VISITS_FOR_CONVERSION
  const parsed = raw ? parseInt(raw, 10) : NaN
  if (Number.isFinite(parsed) && parsed > 0) return parsed
  return 30
}
