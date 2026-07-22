"use client"

import { usePathname } from "next/navigation"
import { navTitleForPath } from "./nav"

// Заголовок текущего раздела в шапке (был статичный «Дашборд»).
export function HeaderTitle() {
  const pathname = usePathname()
  return <h1 className="font-semibold">{navTitleForPath(pathname)}</h1>
}
