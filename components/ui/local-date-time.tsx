"use client"

import { useEffect, useState } from "react"

// Единый формат — совпадает с прежним серверным (ru-RU, medium+short),
// меняется только ЗОНА (не вид).
const FMT: Intl.DateTimeFormatOptions = {
  dateStyle: "medium",
  timeStyle: "short",
}

// Клиентское форматирование timestamp'ов в ЛОКАЛЬНОЙ зоне браузера юзера.
// Серверные компоненты форматировали без timeZone → дефолт рантайма
// (контейнер в UTC) → юзер видел UTC вместо своей зоны.
//
// Hydration: первый рендер (SSR + гидратация) детерминированно в UTC —
// initializer useState выполняется одинаково на сервере и клиенте →
// разметка совпадает, mismatch нет. После mount useEffect переформатирует
// в зону браузера. suppressHydrationWarning — страховка от расхождений
// ICU между Node и браузером. Дашборд за логином (SEO не важен) → краткий
// флик UTC→local приемлем; placeholder/скелет не нужен (сразу валидная
// дата, без layout shift).
export function LocalDateTime({ value }: { value: Date | string }) {
  const iso = (typeof value === "string" ? new Date(value) : value).toISOString()
  const [text, setText] = useState(() =>
    new Intl.DateTimeFormat("ru-RU", { ...FMT, timeZone: "UTC" }).format(
      new Date(iso),
    ),
  )
  useEffect(() => {
    setText(new Intl.DateTimeFormat("ru-RU", FMT).format(new Date(iso)))
  }, [iso])
  return (
    <time dateTime={iso} suppressHydrationWarning>
      {text}
    </time>
  )
}
