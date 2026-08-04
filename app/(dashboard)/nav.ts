import {
  Home,
  PlaySquare,
  Target,
  Lightbulb,
  Settings,
  type LucideIcon,
} from "lucide-react"

export type NavItem = { title: string; url: string; icon: LucideIcon }

// Единый источник навигации — используется и сайдбаром (подсветка), и
// заголовком раздела (title по pathname). Не дублировать названия.
export const NAV_ITEMS: NavItem[] = [
  { title: "Главная", url: "/dashboard", icon: Home },
  { title: "Сессии", url: "/dashboard/sessions", icon: PlaySquare },
  { title: "Страницы", url: "/dashboard/targets", icon: Target },
  { title: "Рекомендации", url: "/dashboard/recommendations", icon: Lightbulb },
  { title: "Настройки", url: "/dashboard/settings", icon: Settings },
]

// Активен ли пункт для текущего пути. «/dashboard» — ТОЛЬКО точное
// совпадение (иначе подсветит все разделы, т.к. все начинаются с
// /dashboard); остальные — префиксом, чтобы /dashboard/sessions/[id]
// подсвечивал «Сессии».
export function isNavActive(itemUrl: string, pathname: string): boolean {
  if (itemUrl === "/dashboard") return pathname === "/dashboard"
  return pathname === itemUrl || pathname.startsWith(itemUrl + "/")
}

// Заголовок раздела для текущего пути (тот же источник, что сайдбар).
// Берём самый ДЛИННЫЙ совпавший url (страховка от вложенности). Фолбэк —
// «Дашборд». Для деталей (напр. /dashboard/sessions/[id]) показываем
// родительский раздел («Сессии») — конкретику несёт заголовок самой
// страницы (h2).
export function navTitleForPath(pathname: string): string {
  const match = [...NAV_ITEMS]
    .filter((i) => isNavActive(i.url, pathname))
    .sort((a, b) => b.url.length - a.url.length)[0]
  return match?.title ?? "Дашборд"
}
