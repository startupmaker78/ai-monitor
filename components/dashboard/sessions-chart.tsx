"use client"

import {
  Bar,
  CartesianGrid,
  ComposedChart,
  ResponsiveContainer,
  Scatter,
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

type Point = { date: string; sessions: number; analyses: number }

interface SessionsChartProps {
  data: Point[]
}

// Маркер запуска анализов под осью. ОДНА точка на день с числом (даже если
// анализов несколько) — поэтому 6 анализов в один день не превращаются в кашу
// из наложенных линий. Число рисуем над точкой при count>=2.
function AnalysisMarker(props: {
  cx?: number
  cy?: number
  payload?: Point
}) {
  const { cx, cy, payload } = props
  if (cx == null || cy == null || !payload || payload.analyses <= 0) return null
  return (
    <g>
      <circle cx={cx} cy={cy} r={4} className="fill-amber-500" />
      {payload.analyses >= 2 && (
        <text
          x={cx}
          y={cy - 7}
          textAnchor="middle"
          className="fill-amber-600 text-[10px] font-medium"
        >
          {payload.analyses}
        </text>
      )}
    </g>
  )
}

// Кастомный тултип: сессии за день + сколько анализов запущено (маркер-серию
// markerY не показываем). Типы recharts для content — свободные, поэтому any.
function ChartTooltip(props: {
  active?: boolean
  label?: string | number
  payload?: Array<{ payload: Point }>
}) {
  const { active, label, payload } = props
  if (!active || !payload || payload.length === 0) return null
  const p = payload[0].payload
  const d = new Date(label as string)
  return (
    <div className="rounded-md border bg-background px-3 py-2 text-xs shadow-sm">
      <div className="font-medium">
        {d.toLocaleDateString("ru-RU", { day: "numeric", month: "long" })}
      </div>
      <div className="text-muted-foreground">Сессии: {p.sessions}</div>
      {p.analyses > 0 && (
        <div className="text-amber-600">
          Анализов запущено: {p.analyses}
        </div>
      )}
    </div>
  )
}

export function SessionsChart({ data }: SessionsChartProps) {
  // markerY=0 → точка садится на нижнюю ось; null → нет маркера в этот день.
  const chartData = data.map((d) => ({
    ...d,
    markerY: d.analyses > 0 ? 0 : null,
  }))
  const anyAnalyses = data.some((d) => d.analyses > 0)

  return (
    <Card>
      <CardHeader>
        <CardTitle>Записанные сессии по дням</CardTitle>
        <CardDescription>
          Столбцы — сессии за день, последние 30 дней.
          {anyAnalyses && (
            <>
              {" "}
              <span className="text-amber-600">● </span>— запуск анализа
              (число = сколько за день).
            </>
          )}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={300}>
          <ComposedChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
            <XAxis
              dataKey="date"
              className="text-xs"
              tickFormatter={(value) => {
                const d = new Date(value)
                return `${d.getDate()}.${d.getMonth() + 1}`
              }}
            />
            <YAxis className="text-xs" allowDecimals={false} />
            {/* Скрытая ось маркеров: домен [0,1], точка при y=0 у нижней оси. */}
            <YAxis yAxisId="marker" hide domain={[0, 1]} />
            <Tooltip
              cursor={{ fill: "hsl(var(--muted))", opacity: 0.3 }}
              content={<ChartTooltip />}
            />
            <Bar
              dataKey="sessions"
              fill="hsl(var(--primary))"
              radius={[3, 3, 0, 0]}
              name="Сессии"
            />
            <Scatter
              yAxisId="marker"
              dataKey="markerY"
              shape={<AnalysisMarker />}
              isAnimationActive={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  )
}
