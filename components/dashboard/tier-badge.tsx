import Link from "next/link"
import { Sparkles } from "lucide-react"
import { Badge } from "@/components/ui/badge"

interface TierBadgeProps {
  name: string
  price?: number
  // Если задан — бейдж кликабельный (ведёт на страницу тарифа): курсор + ховер.
  href?: string
}

export function TierBadge({ name, price, href }: TierBadgeProps) {
  const badge = (
    <Badge variant="default" className="font-semibold">
      {name}
    </Badge>
  )

  return (
    <div className="flex items-center gap-2 text-sm">
      <Sparkles className="h-4 w-4 text-primary" />
      <span className="text-muted-foreground">Тариф:</span>
      {href ? (
        <Link
          href={href}
          title="Открыть тарифы"
          className="rounded-full transition-opacity hover:opacity-80"
        >
          {badge}
        </Link>
      ) : (
        badge
      )}
      {price !== undefined && (
        <span className="text-xs text-muted-foreground">
          · {price.toLocaleString("ru-RU")} ₽/мес
        </span>
      )}
    </div>
  )
}
