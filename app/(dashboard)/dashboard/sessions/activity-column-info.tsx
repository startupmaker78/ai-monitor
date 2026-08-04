"use client"

import { HelpCircle } from "lucide-react"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"

// Подсказка к колонке «Активность» — про ОДНУ сессию (не доля по странице, как
// в поповере вовлечённости). Формулировки сверены с session-classification.ts:
//   useful    — interactionCount>0 (клик src2·type2 / скролл src3 / ввод src5)
//   passive   — FullSnapshot + eventsCount>5 + 0 действий
//   bounce    — FullSnapshot + eventsCount<=5 + 0 действий (≤5 = «пять или
//               меньше», НЕ «меньше пяти»)
//   incomplete— нет FullSnapshot (DOM не восстановить)
export function ActivityColumnInfo() {
  return (
    <Popover>
      <PopoverTrigger
        aria-label="Что означают значения активности"
        className="ml-1 inline-flex align-middle text-muted-foreground hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <HelpCircle className="h-3.5 w-3.5" />
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-72 text-sm font-normal normal-case tracking-normal text-foreground"
      >
        <p className="text-muted-foreground">
          Что посетитель сделал в этой записи:
        </p>
        <ul className="mt-2 space-y-1.5">
          <li>
            <span className="font-medium">N действий</span> — сколько кликов,
            скроллов и вводов в этой записи.
          </li>
          <li>
            <span className="font-medium">пассивно</span> — посетитель был на
            странице, но не кликал, не скроллил и ничего не вводил.
          </li>
          <li>
            <span className="font-medium">отскок</span> — почти ничего не
            сделал: пять или меньше событий в записи.
          </li>
          <li>
            <span className="font-medium">неполная</span> — запись оборвалась,
            восстановить страницу нельзя (ушёл в первую секунду или бот).
          </li>
        </ul>
      </PopoverContent>
    </Popover>
  )
}
