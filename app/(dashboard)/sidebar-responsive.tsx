"use client"

import { useEffect } from "react"
import { useSidebar } from "@/components/ui/sidebar"

// Адаптив дефолта сайдбара: ниже lg (1024px) — icon-rail, на lg+ —
// развёрнутый. Сайдбар уже collapsible="icon"; здесь только выставляем
// состояние по ширине. Ниже md (768) сайдбар и так уходит в Sheet (isMobile),
// setOpen там безвреден. matchMedia срабатывает только при пересечении
// брейкпоинта → между пересечениями ручной тоггл пользователя живёт.
export function SidebarResponsiveCollapse() {
  const { setOpen } = useSidebar()

  useEffect(() => {
    const mql = window.matchMedia("(min-width: 1024px)")
    const apply = () => setOpen(mql.matches)
    apply()
    mql.addEventListener("change", apply)
    return () => mql.removeEventListener("change", apply)
  }, [setOpen])

  return null
}
