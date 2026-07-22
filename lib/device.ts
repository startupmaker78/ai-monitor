export type DeviceType = "mobile" | "tablet" | "desktop"

// Тип устройства по User-Agent. ЕДИНЫЙ источник — используется и в
// пре-процессоре (стратификация сэмпла по устройствам), и в списке сессий
// (иконка устройства). НЕ разводить второе определение (урок дубль-логики).
// Приближение по UA (без viewport) — достаточно для иконки/стратификации.
export function classifyDeviceByUA(userAgent: string | null): DeviceType {
  if (!userAgent) return "desktop"
  if (/iPad/i.test(userAgent)) return "tablet"
  if (/iPhone|Android.*Mobile|Mobile/i.test(userAgent)) return "mobile"
  return "desktop"
}
