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
// накопленных сессий для запуска анализа. Продакшн-дефолт 100 (см.
// PRODUCT.md); на dev/staging можно понизить до 5-10 для быстрого
// smoke-теста без реального трафика.
export function getMinSessionsBudget(): number {
  const raw = process.env.MIN_SESSIONS_BUDGET
  const parsed = raw ? parseInt(raw, 10) : NaN
  if (Number.isFinite(parsed) && parsed > 0) return parsed
  return 100
}
