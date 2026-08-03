import Link from "next/link"
import { AlertTriangle } from "lucide-react"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

type FreshRec = {
  id: string
  title: string
  targetId: string
  targetName: string
}

// Свежие критичные находки на главной: число «81» — это не польза, а вот
// последние 🔴 с целью и ссылкой — прямой повод действовать. Скрыт, если
// критичных нет (не выдумываем).
export function FreshRecommendations({ items }: { items: FreshRec[] }) {
  if (items.length === 0) return null

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-red-600" />
            Свежие критичные находки
          </CardTitle>
          <Link
            href="/dashboard/recommendations"
            className="shrink-0 text-sm text-primary hover:underline"
          >
            Все рекомендации →
          </Link>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {items.map((r) => (
          <Link
            key={r.id}
            href={`/dashboard/recommendations?targetId=${r.targetId}`}
            className="block rounded-md border p-3 transition-colors hover:bg-muted/50"
          >
            <p className="font-medium">{r.title}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Цель: {r.targetName}
            </p>
          </Link>
        ))}
      </CardContent>
    </Card>
  )
}
