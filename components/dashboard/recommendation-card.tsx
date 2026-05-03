import type { Analysis, AnalysisTarget, Recommendation } from "@prisma/client"
import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

const PRIORITY_LABELS: Record<
  string,
  { label: string; variant: "destructive" | "default" | "secondary" }
> = {
  CRITICAL: { label: "🔴 Критично", variant: "destructive" },
  IMPORTANT: { label: "🟡 Важно", variant: "default" },
  GOOD: { label: "🟢 Хорошо", variant: "secondary" },
}

const STATUS_LABELS: Record<string, string> = {
  NEW: "Новая",
  IN_PROGRESS: "В работе",
  DONE: "Реализована",
  REJECTED: "Отклонена",
}

interface RecommendationCardProps {
  recommendation: Recommendation & {
    analysis: Analysis & {
      target: AnalysisTarget
    }
  }
}

export function RecommendationCard({
  recommendation: rec,
}: RecommendationCardProps) {
  const priority =
    PRIORITY_LABELS[rec.priority] ?? {
      label: rec.priority,
      variant: "secondary" as const,
    }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="text-base leading-tight">{rec.title}</CardTitle>
          <Badge variant={priority.variant} className="shrink-0">
            {priority.label}
          </Badge>
        </div>
        <CardDescription className="flex flex-wrap items-center gap-x-2 text-xs">
          <span>{rec.analysis.target.name ?? rec.analysis.target.url}</span>
          <span>·</span>
          <span>{STATUS_LABELS[rec.status] ?? rec.status}</span>
          {rec.metric && (
            <>
              <span>·</span>
              <span>Влияет на: {rec.metric}</span>
            </>
          )}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <p className="text-sm leading-relaxed text-muted-foreground">
          {rec.description}
        </p>
      </CardContent>
    </Card>
  )
}
