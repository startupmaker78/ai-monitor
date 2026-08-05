// Единый предикат «страница ЗАВЕРШЕНА» — общий для экрана «Страницы»
// (вкладка «Завершённые») и блока на главной, чтобы бейджи/группировка не
// разъезжались. Завершена = проанализирована И собран полный бюджет: сбор
// закрыт обоими гейтами, повтор блокирует already_completed. АКТИВНАЯ = не
// завершена и не архив (собирает / готова к запуску / анализируется).
//
// Чистая функция без server-only импортов — можно звать и из клиентского
// компонента, и из серверного data-слоя.
export function isTargetCompleted(t: {
  analyzed: boolean
  sessionsCollected: number
  sessionsBudget: number
}): boolean {
  return t.analyzed && t.sessionsCollected >= t.sessionsBudget
}
