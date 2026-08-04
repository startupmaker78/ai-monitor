import type { LucideIcon } from "lucide-react"
import { MousePointerClick, Target, Zap } from "lucide-react"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import type { DemoTierUsage } from "@/lib/demo-tier-info"

interface UsageWidgetProps {
  usage: DemoTierUsage
  tierName: string
  tierLimits: {
    targetsLimit: number
    analysesPerMonth: number
    sessionsLimit: number
  }
}

interface UsageItemProps {
  icon: LucideIcon
  label: string
  used: number
  limit: number
  remaining: number
}

function UsageItem({ icon: Icon, label, used, limit, remaining }: UsageItemProps) {
  const percent = (used / limit) * 100

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-sm">
        <div className="flex items-center gap-2">
          <Icon className="h-4 w-4 text-muted-foreground" />
          <span>{label}</span>
        </div>
        <span className="text-muted-foreground">
          <span className="font-medium text-foreground">
            {used.toLocaleString("ru-RU")}
          </span>
          {" / "}
          {limit.toLocaleString("ru-RU")}
        </span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div
          className="h-full bg-primary transition-all"
          style={{ width: `${Math.min(percent, 100)}%` }}
        />
      </div>
      <p className="text-xs text-muted-foreground">
        Осталось: {remaining.toLocaleString("ru-RU")}
      </p>
    </div>
  )
}

export function UsageWidget({ usage, tierName, tierLimits }: UsageWidgetProps) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">
          Использование тарифа {tierName}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <UsageItem
          icon={Target}
          label="Страницы"
          used={usage.targetsUsed}
          limit={tierLimits.targetsLimit}
          remaining={usage.targetsRemaining}
        />
        <UsageItem
          icon={Zap}
          label="AI-анализы в этом месяце"
          used={usage.analysesUsedThisMonth}
          limit={tierLimits.analysesPerMonth}
          remaining={usage.analysesRemaining}
        />
        <UsageItem
          icon={MousePointerClick}
          label="Сессий распределено"
          used={usage.sessionsAllocated}
          limit={tierLimits.sessionsLimit}
          remaining={usage.sessionsRemaining}
        />
      </CardContent>
    </Card>
  )
}
