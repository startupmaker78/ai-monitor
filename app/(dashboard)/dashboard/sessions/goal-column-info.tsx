"use client"

import { HelpCircle } from "lucide-react"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"

// Явная страховка от неправильного прочтения колонки «Целевое действие
// страницы»: значение — атрибут СТРАНИЦЫ, а не факт о конкретной сессии.
// Достижение цели в отдельной записи мы не определяем (DECISIONS: btn-цели
// отдают хеши, Logs API отложен) — конверсия считается по Метрике целиком.
export function GoalColumnInfo() {
  return (
    <Popover>
      <PopoverTrigger
        aria-label="Что означает целевое действие страницы"
        className="ml-1 inline-flex align-middle text-muted-foreground hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <HelpCircle className="h-3.5 w-3.5" />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 text-sm font-normal normal-case tracking-normal text-foreground">
        Это целевое действие, заданное для страницы. Совершил ли его конкретный
        посетитель — мы не определяем: конверсия считается по данным
        Яндекс.Метрики целиком, а не по отдельным записям.
      </PopoverContent>
    </Popover>
  )
}
