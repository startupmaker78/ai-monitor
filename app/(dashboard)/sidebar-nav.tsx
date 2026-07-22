"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"
import { NAV_ITEMS, isNavActive } from "./nav"

// Клиентский — usePathname для подсветки активного раздела. Рендерится
// внутри SidebarContent (server layout), работает и в desktop-сайдбаре, и
// в мобильном sheet (Sidebar сам портирует контент в Sheet).
export function SidebarNav() {
  const pathname = usePathname()
  return (
    <SidebarMenu>
      {NAV_ITEMS.map((item) => {
        const active = isNavActive(item.url, pathname)
        return (
          <SidebarMenuItem key={item.url}>
            <SidebarMenuButton asChild isActive={active} tooltip={item.title}>
              <Link
                href={item.url}
                aria-current={active ? "page" : undefined}
              >
                <item.icon />
                <span>{item.title}</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        )
      })}
    </SidebarMenu>
  )
}
