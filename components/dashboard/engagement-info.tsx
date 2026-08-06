"use client"

import { HelpCircle } from "lucide-react"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"

// Поповер-подсказка к «Вовлечённость страниц». Инструкция, а не словарь:
// что делать с числами. Popover (клик), не hover-тултип — текста абзац и
// hover не работает на мобиле. Формулировки сверены с session-classification.ts
// (passive vs bounce делит ЧИСЛО событий >5 vs ≤5, не время).
export function EngagementInfo() {
  return (
    <Popover>
      <PopoverTrigger
        aria-label="Как читать вовлечённость"
        className="text-muted-foreground hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <HelpCircle className="h-4 w-4" />
      </PopoverTrigger>
      {/* max-h по доступной высоте, которую Radix считает от триггера до края
          вьюпорта (с учётом коллизий) → поповер никогда не вылезает за экран
          на 390, длинный текст скроллится внутри. */}
      <PopoverContent
        align="end"
        className="max-h-[var(--radix-popover-content-available-height)] w-80 overflow-y-auto text-sm"
      >
        <p className="font-medium">Вовлечённость страниц</p>
        <p className="mt-1 text-muted-foreground">
          Сколько посетителей сделали на странице хоть одно действие — клик,
          скролл или ввод. Считается по записанным сессиям; боты и уходы до
          загрузки исключены.
        </p>
        <ul className="mt-3 space-y-1.5">
          <li>
            <span className="font-medium">Действие</span> — кликнул,
            проскроллил или что-то ввёл. Страница удержала внимание.
          </li>
          <li>
            <span className="font-medium">Пассивно</span> — был на странице,
            но не кликал, не скроллил и ничего не вводил. Контент видят, но он
            не побуждает действовать.
          </li>
          <li>
            <span className="font-medium">Отскок</span> — открыл и почти
            ничего не сделал: в записи меньше пяти событий.
          </li>
          <li>
            <span className="font-medium">Неполное</span> — сессия не
            записалась целиком (ушёл в первую секунду / бот). В процент не
            входит, чтобы его не искажать.
          </li>
        </ul>
        <p className="mt-3 font-medium">На что смотреть</p>
        <p className="mt-1 text-muted-foreground">
          Важно не само число, а разброс между страницами. Низкая
          вовлечённость на странице входа дороже, чем на глубокой — людей
          теряют на старте. Высокий отскок → смотрите первый экран страницы.
          Высокое «пассивно» — самый ценный сигнал: контент дошёл, но призыв к
          действию не сработал; ищите, что мешает сделать шаг.
        </p>
      </PopoverContent>
    </Popover>
  )
}
