// Единый источник правды по ретеншну видеозаписей сессий. Крон
// app/api/cron/cleanup-old-sessions удаляет S3-запись rrweb + строку Session,
// когда сессия закончилась больше SESSION_RETENTION_DAYS дней назад (или
// зависла незакрытой дольше N+1 дня). Анализы, рекомендации и метрики лежат в
// ОТДЕЛЬНЫХ таблицах и ретеншном НЕ затрагиваются — удаляется только запись.
// UI берёт правило и подпись отсюда, чтобы формулировка совпадала с кроном.
export const SESSION_RETENTION_DAYS = 30

const DAY_MS = 24 * 60 * 60 * 1000

// Сколько дней осталось до удаления записи. Закрытая (endedAt задан) → отсчёт
// от endedAt + N (как cutoff в кроне). Незакрытая (endedAt=null) → крон удалит
// по startedAt + (N+1) (stuckCutoff), повторяем ту же формулу. Возвращает целое
// (ceil, минимум 0). now параметризуем для детерминированного рендера/тестов.
export function sessionRetentionDaysLeft(
  startedAt: Date,
  endedAt: Date | null,
  now: number = Date.now(),
): number {
  const deleteAt = endedAt
    ? endedAt.getTime() + SESSION_RETENTION_DAYS * DAY_MS
    : startedAt.getTime() + (SESSION_RETENTION_DAYS + 1) * DAY_MS
  const left = Math.ceil((deleteAt - now) / DAY_MS)
  return left < 0 ? 0 : left
}
