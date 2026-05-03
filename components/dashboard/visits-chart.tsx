"use client"

import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

interface VisitsChartProps {
  data: Array<{ date: string; visits: number; conversions: number }>
}

export function VisitsChart({ data }: VisitsChartProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Динамика трафика</CardTitle>
        <CardDescription>Визиты и конверсии за последние 30 дней</CardDescription>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={data}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
            <XAxis
              dataKey="date"
              className="text-xs"
              tickFormatter={(value) => {
                const d = new Date(value)
                return `${d.getDate()}.${d.getMonth() + 1}`
              }}
            />
            <YAxis className="text-xs" />
            <Tooltip
              contentStyle={{
                backgroundColor: "hsl(var(--background))",
                border: "1px solid hsl(var(--border))",
                borderRadius: "8px",
              }}
              labelFormatter={(value) => {
                const d = new Date(value as string)
                return d.toLocaleDateString("ru-RU", {
                  day: "numeric",
                  month: "long",
                })
              }}
            />
            <Line
              type="monotone"
              dataKey="visits"
              stroke="hsl(var(--primary))"
              strokeWidth={2}
              dot={false}
              name="Визиты"
            />
            <Line
              type="monotone"
              dataKey="conversions"
              stroke="hsl(var(--chart-2, 220 60% 50%))"
              strokeWidth={2}
              dot={false}
              name="Конверсии"
            />
          </LineChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  )
}
