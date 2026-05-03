import { Sparkles } from "lucide-react"
import { Badge } from "@/components/ui/badge"

interface TierBadgeProps {
  name: string
  price?: number
}

export function TierBadge({ name, price }: TierBadgeProps) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <Sparkles className="h-4 w-4 text-primary" />
      <span className="text-muted-foreground">Тариф:</span>
      <Badge variant="default" className="font-semibold">
        {name}
      </Badge>
      {price !== undefined && (
        <span className="text-xs text-muted-foreground">
          · {price.toLocaleString("ru-RU")} ₽/мес
        </span>
      )}
    </div>
  )
}
