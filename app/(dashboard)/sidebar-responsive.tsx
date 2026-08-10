"use client"

import { useEffect, useRef } from "react"
import { useSidebar } from "@/components/ui/sidebar"

// Адаптив ДЕФОЛТА сайдбара: ниже lg (1024px) — icon-rail, на lg+ —
// развёрнутый. Сайдбар уже collapsible="icon"; здесь только выставляем
// состояние по ширине. Ниже md (768) сайдбар уходит в Sheet (isMobile) и
// управляется openMobile — setOpen там безвреден.
//
// Ручной клик ПЕРЕБИВАЕТ дефолт и держится до следующего пересечения порога
// 1024 (окно реально сменило категорию — тогда дефолт применяется заново).
// Схема как у trackerActive/codeOpen в карточке сайта.
//
// Тонкость, из-за которой была регрессия: setOpen из useSidebar пересоздаётся
// на КАЖДОЕ изменение open — его useCallback держит open в зависимостях. Если
// подписать эффект на [setOpen], собственный клик пользователя перезапустит
// эффект, тот повторно применит дефолт по ширине и вернёт состояние обратно:
// кнопка сворачивания перестаёт работать, хотя matchMedia ни разу не сработал.
// Поэтому setOpen живёт в ref, а эффект монтируется один раз.
//
// Почему не чиним корень: чище было бы стабилизировать setOpen в самом
// components/ui/sidebar.tsx (убрать open из зависимостей useCallback через
// функциональный апдейт _setOpen). Но это вендорный компонент shadcn — правка
// превращает его в форк и создаёт боль при каждом обновлении. Хак осознанно
// локализован в нашем файле.
export function SidebarResponsiveCollapse() {
  const { setOpen } = useSidebar()
  const setOpenRef = useRef(setOpen)
  useEffect(() => {
    setOpenRef.current = setOpen
  }, [setOpen])

  useEffect(() => {
    const mql = window.matchMedia("(min-width: 1024px)")
    // Дефолт — на монтировании и дальше только при смене категории окна.
    setOpenRef.current(mql.matches)
    const onChange = (e: MediaQueryListEvent) => setOpenRef.current(e.matches)
    mql.addEventListener("change", onChange)
    return () => mql.removeEventListener("change", onChange)
  }, [])

  return null
}
