"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import {
  Check,
  Copy,
  CheckCircle2,
  Circle,
  ChevronDown,
  ChevronRight,
  Plus,
} from "lucide-react"
import type { ConnectionStatus } from "@/lib/connection-status"
import { setSelectedSite } from "@/app/(dashboard)/site-actions"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { buildTrackerSnippet } from "@/lib/site-utils"

type Site = {
  id: string
  domain: string
  displayDomain: string // Punycode декодирован (для показа)
  name: string | null
  trackingToken: string
  isDemo: boolean
  createdAt: Date
}

type Props = {
  initialSites: Site[]
  statuses: Record<string, ConnectionStatus>
  selectedId: string | null
}

export function SitesClient({ initialSites, statuses, selectedId }: Props) {
  const router = useRouter()
  const [domain, setDomain] = useState("")
  const [name, setName] = useState("")
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [showOthers, setShowOthers] = useState(false)
  const [switching, startSwitch] = useTransition()

  // Переключить выбранный сайт (как хедер-селектор): пишет cookie + refresh →
  // сервер отдаёт карточку нового выбранного сайта.
  function switchSite(id: string) {
    startSwitch(async () => {
      await setSelectedSite(id)
      router.refresh()
    })
  }
  // Форма добавления свёрнута в кнопку. Исключение — ноль сайтов: это первый
  // шаг онбординга, прятать нельзя.
  const hasSites = initialSites.filter((s) => !s.isDemo).length > 0
  const [formOpen, setFormOpen] = useState(!hasSites)

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    if (!domain.trim()) return
    setCreating(true)
    setCreateError(null)
    try {
      const res = await fetch("/api/sites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          domain: domain.trim(),
          name: name.trim() || null,
        }),
      })
      const data = (await res.json().catch(() => ({}))) as { message?: string }
      if (!res.ok) {
        setCreateError(data.message ?? `Ошибка ${res.status}`)
        setCreating(false)
        return
      }
      setDomain("")
      setName("")
      setFormOpen(false) // добавили — сворачиваем форму, показываем список
      router.refresh()
      setCreating(false)
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "Ошибка сети")
      setCreating(false)
    }
  }

  async function handleDelete(site: Site) {
    if (
      !confirm(
        `Удалить сайт «${site.displayDomain}»? Все собранные сессии и записи будут удалены безвозвратно.`,
      )
    ) {
      return
    }
    setDeleteError(null)
    try {
      const res = await fetch(`/api/sites/${site.id}`, { method: "DELETE" })
      if (res.ok) {
        router.refresh()
        return
      }
      const data = (await res.json().catch(() => ({}))) as { message?: string }
      setDeleteError(data.message ?? `Ошибка ${res.status}`)
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : "Ошибка сети")
    }
  }

  async function handleCopy(site: Site) {
    const snippet = buildTrackerSnippet(site.trackingToken)
    try {
      await navigator.clipboard.writeText(snippet)
      setCopiedId(site.id)
      setTimeout(() => setCopiedId(null), 2000)
    } catch {
      // navigator.clipboard может быть недоступен в HTTP-контекстах
      // (только https/localhost). Fallback не делаем — copy редко
      // ломается на проде.
    }
  }

  // Defensive filter: демо-сайтов больше не должно быть, но если что-то
  // останется — не рендерим.
  const visibleSites = initialSites.filter((s) => !s.isDemo)
  // Карточка = выбранный сайт (селектор в хедере). Остальные — под ссылкой.
  const selectedSite =
    visibleSites.find((s) => s.id === selectedId) ?? visibleSites[0]
  const others = selectedSite
    ? visibleSites.filter((s) => s.id !== selectedSite.id)
    : []

  return (
    <div className="max-w-3xl space-y-6">
      {/* Кнопка «Добавить сайт» — вверху рядом с заголовком справа (добавляют
          редко, но действие должно быть на виду). Форма раскрывается по клику;
          при нуле сайтов formOpen=true (первый шаг онбординга — не прячем). */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Сайты</h2>
          <p className="mt-1 text-muted-foreground">
            Подключите свой сайт чтобы Вебмонитор начал собирать сессии и
            анализировать их с помощью AI.
          </p>
        </div>
        {!formOpen && (
          <Button
            variant="outline"
            className="shrink-0"
            onClick={() => setFormOpen(true)}
          >
            <Plus className="mr-1 h-4 w-4" /> Добавить сайт
          </Button>
        )}
      </div>

      {formOpen && (
        <Card>
          <CardHeader>
            <CardTitle>Добавить сайт</CardTitle>
            <CardDescription>
              Введите домен — мы автоматически очистим протокол, www и
              параметры.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleCreate} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="domain">Адрес сайта</Label>
                <Input
                  id="domain"
                  name="domain"
                  type="text"
                  placeholder="nolim.cc"
                  value={domain}
                  onChange={(e) => setDomain(e.target.value)}
                  required
                  disabled={creating}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="name">Название (необязательно)</Label>
                <Input
                  id="name"
                  name="name"
                  type="text"
                  placeholder="Главный сайт"
                  maxLength={100}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  disabled={creating}
                />
              </div>
              {createError && (
                <p className="text-sm text-destructive">{createError}</p>
              )}
              <div className="flex gap-2">
                <Button type="submit" disabled={creating || !domain.trim()}>
                  {creating ? "Добавление..." : "Добавить сайт"}
                </Button>
                {hasSites && (
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => {
                      setFormOpen(false)
                      setCreateError(null)
                    }}
                    disabled={creating}
                  >
                    Отмена
                  </Button>
                )}
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {deleteError && (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
          {deleteError}
        </div>
      )}

      {/* Карточка ВЫБРАННОГО сайта (селектор в хедере переключает). */}
      {selectedSite && (
        <SiteCard
          key={selectedSite.id}
          site={selectedSite}
          status={statuses[selectedSite.id]}
          copied={copiedId === selectedSite.id}
          onCopy={() => handleCopy(selectedSite)}
          onDelete={() => handleDelete(selectedSite)}
        />
      )}

      {/* Ссылка на остальные сайты — только если их больше одного. Не отдельный
          роут: прячем список, чтобы тут же дать на него ссылку — раскрываем
          прямо здесь. Клик по строке переключает выбранный сайт. */}
      {others.length > 0 && (
        <div>
          <button
            type="button"
            onClick={() => setShowOthers((v) => !v)}
            className="flex items-center gap-1 text-sm text-primary hover:underline"
          >
            {showOthers ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronRight className="h-4 w-4" />
            )}
            Посмотреть все подключённые сайты ({visibleSites.length})
          </button>

          {showOthers && (
            <div className="mt-2 divide-y rounded-md border">
              {others.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  disabled={switching}
                  onClick={() => switchSite(s.id)}
                  className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left hover:bg-muted/50 disabled:opacity-60"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">
                      {s.displayDomain}
                    </span>
                    {s.name && (
                      <span className="block truncate text-xs text-muted-foreground">
                        {s.name}
                      </span>
                    )}
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {statusPhrase(statuses[s.id])}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// Статус подключения сайта одной фразой (для компактного списка остальных).
function statusPhrase(status?: ConnectionStatus): string {
  if (!status) return ""
  if (status.trackerActive && status.metrikaConfigured && status.syncHasData) {
    return "Всё подключено"
  }
  if (!status.trackerActive) return "Трекер не подключён"
  if (!status.metrikaConfigured) return "Метрика не подключена"
  return "Ждём данные Метрики"
}

function StatusRow({
  done,
  doneText,
  children,
}: {
  done: boolean
  doneText: string
  children?: React.ReactNode
}) {
  return (
    <div className="flex items-start gap-2 text-sm">
      {done ? (
        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-green-600" />
      ) : (
        <Circle className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
      )}
      {done ? (
        <span className="text-muted-foreground">{doneText}</span>
      ) : (
        <span>{children}</span>
      )}
    </div>
  )
}

// Виджет статуса подключения. Только DB-сигналы (getConnectionStatus).
// ВСЕГДА три строки (включая зелёные) — статус виден постоянно, не
// сворачивается. Незакрытые пункты ведут к действию. Цели/«живость» не тащим.
function ConnectionStatusWidget({ status }: { status: ConnectionStatus }) {
  return (
    <div className="space-y-2 rounded-md border bg-muted/40 p-3">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Статус подключения
      </p>

      {/* Трекер — ФАКТ (записей нет) отделён от ПРИЧИНЫ. Три состояния:
          0 страниц → без страницы should-record вернёт no_target и запись не
          создастся никогда (это важнее кода); страницы есть, сессий нет →
          не утверждаем «кода нет», ждём первый визит; сессии есть → зелёное. */}
      <StatusRow done={status.trackerActive} doneText="Трекер шлёт сессии">
        {status.activeTargets === 0 ? (
          <>
            Добавьте{" "}
            <Link
              href="/dashboard/targets"
              className="font-medium text-primary underline underline-offset-2"
            >
              страницу для анализа
            </Link>{" "}
            — без неё трекер не записывает сессии
          </>
        ) : (
          <>Код вставлен? Сессии появятся после первого визита на страницу</>
        )}
      </StatusRow>

      <StatusRow
        done={status.metrikaConfigured}
        doneText="Яндекс.Метрика подключена"
      >
        Метрика не подключена —{" "}
        <Link
          href="/dashboard/settings/metrika"
          className="font-medium text-primary underline underline-offset-2"
        >
          подключить
        </Link>
      </StatusRow>

      {/* Синк зависит от Метрики. Без Метрики — нейтральное ожидание; с
          Метрикой без данных — «после закрытия суток» (это НЕ ошибка). */}
      {!status.metrikaConfigured ? (
        <div className="flex items-start gap-2 text-sm">
          <Circle className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="text-muted-foreground">
            Данные Метрики — после подключения счётчика
          </span>
        </div>
      ) : (
        <StatusRow
          done={status.syncHasData}
          doneText="Метрика присылает данные"
        >
          Данные Метрики появятся после закрытия суток — обычно на следующий
          день
        </StatusRow>
      )}
    </div>
  )
}

function SiteCard({
  site,
  status,
  copied,
  onCopy,
  onDelete,
}: {
  site: Site
  status?: ConnectionStatus
  copied: boolean
  onCopy: () => void
  onDelete: () => void
}) {
  const allGreen = Boolean(
    status &&
      status.trackerActive &&
      status.metrikaConfigured &&
      status.syncHasData,
  )
  // Статус ВСЕГДА виден. Сворачивается только КОД трекера: он нужен один раз
  // при настройке, а места занимает много. Всё подключено → код свёрнут (по
  // клику разворачивается). Не всё → код показан (трекер ещё не стоит).
  const [codeOpen, setCodeOpen] = useState(false)
  const showCode = !allGreen || codeOpen
  const snippet = buildTrackerSnippet(site.trackingToken)

  return (
    <Card>
      <CardContent className="space-y-4 p-4">
        <div className="min-w-0">
          <h3 className="truncate text-lg font-semibold">
            {site.displayDomain}
          </h3>
          {site.name && (
            <p className="truncate text-sm text-muted-foreground">
              {site.name}
            </p>
          )}
        </div>

        {status && <ConnectionStatusWidget status={status} />}

        {showCode ? (
          <>
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-medium">Код для вставки на сайт</p>
                {allGreen && (
                  <button
                    type="button"
                    onClick={() => setCodeOpen(false)}
                    className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                  >
                    <ChevronDown className="h-3.5 w-3.5" /> Скрыть
                  </button>
                )}
              </div>
              {/* whitespace-pre-wrap+break-all: длинный сниппет переносится
                  целиком, не обрезается справа. Копируется всегда полностью. */}
              <pre className="whitespace-pre-wrap break-all rounded-md bg-muted p-3 text-xs">
                <code>{snippet}</code>
              </pre>
              <Button type="button" variant="outline" size="sm" onClick={onCopy}>
                {copied ? (
                  <>
                    <Check className="mr-1 h-3 w-3" /> Скопировано
                  </>
                ) : (
                  <>
                    <Copy className="mr-1 h-3 w-3" /> Копировать
                  </>
                )}
              </Button>
              <p className="text-xs text-muted-foreground">
                Вставьте этот код в раздел «Шапка» или «Подвал» настроек
                сайта. Для Tilda: Настройки сайта → Дополнительно → HTML код
                для вставки внутрь HEAD.
              </p>
            </div>

            {/* Удаление — неакцентное, в развороте (опасное и редкое). */}
            <div className="flex justify-end border-t pt-3">
              <button
                type="button"
                onClick={onDelete}
                className="text-xs text-muted-foreground underline-offset-2 hover:text-destructive hover:underline"
              >
                Удалить сайт
              </button>
            </div>
          </>
        ) : (
          <button
            type="button"
            onClick={() => setCodeOpen(true)}
            className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <ChevronRight className="h-4 w-4" /> Показать код трекера
          </button>
        )}
      </CardContent>
    </Card>
  )
}
