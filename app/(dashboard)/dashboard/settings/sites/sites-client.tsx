"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { Check, Copy, Trash2, CheckCircle2, Circle } from "lucide-react"
import type { ConnectionStatus } from "@/lib/connection-status"
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
  name: string | null
  trackingToken: string
  isDemo: boolean
  createdAt: Date
}

type Props = {
  initialSites: Site[]
  statuses: Record<string, ConnectionStatus>
}

export function SitesClient({ initialSites, statuses }: Props) {
  const router = useRouter()
  const [domain, setDomain] = useState("")
  const [name, setName] = useState("")
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)

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
        `Удалить сайт «${site.domain}»? Все собранные сессии и записи будут удалены безвозвратно.`,
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

  // Defensive filter: демо-сайтов больше не должно быть (cleanup в этом
  // же коммите), но если что-то останется — не рендерим.
  const visibleSites = initialSites.filter((s) => !s.isDemo)
  const showEmptyHint =
    visibleSites.length === 0 && !domain && !name && !creating

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight">Сайты</h2>
        <p className="mt-1 text-muted-foreground">
          Подключите свой сайт чтобы Вебмонитор начал собирать сессии и
          анализировать их с помощью AI.
        </p>
      </div>

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
            <Button type="submit" disabled={creating || !domain.trim()}>
              {creating ? "Добавление..." : "Добавить сайт"}
            </Button>
          </form>
        </CardContent>
      </Card>

      {deleteError && (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
          {deleteError}
        </div>
      )}

      {showEmptyHint && (
        <p className="text-sm text-muted-foreground">
          У вас пока нет подключённых сайтов. Добавьте первый сайт чтобы
          начать сбор данных.
        </p>
      )}

      <div className="space-y-3">
        {visibleSites.map((site) => (
          <SiteCard
            key={site.id}
            site={site}
            status={statuses[site.id]}
            copied={copiedId === site.id}
            onCopy={() => handleCopy(site)}
            onDelete={() => handleDelete(site)}
          />
        ))}
      </div>
    </div>
  )
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
// Незакрытые пункты ведут к действию. Всё зелёное → сворачивается в одну
// зелёную строку. Цели/«живость» не тащим (стоят вызовов Метрики).
function ConnectionStatusWidget({ status }: { status: ConnectionStatus }) {
  const allGreen =
    status.trackerActive && status.metrikaConfigured && status.syncHasData

  if (allGreen) {
    return (
      <div className="flex items-center gap-2 rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">
        <CheckCircle2 className="h-4 w-4 shrink-0" />
        Всё подключено — данные собираются.
      </div>
    )
  }

  return (
    <div className="space-y-2 rounded-md border bg-muted/40 p-3">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Статус подключения
      </p>

      {/* Трекер. count===0 неоднозначен (ещё не поставили ИЛИ поставили и
          сломалось — по нулю сессий дёшево не различить, сессий-то нет),
          поэтому формулировка НЕЙТРАЛЬНАЯ, без обвинения. */}
      <StatusRow done={status.trackerActive} doneText="Трекер шлёт сессии">
        Трекер ещё не прислал ни одной сессии — вставьте код ниже ↓
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
  const snippet = buildTrackerSnippet(site.trackingToken)
  return (
    <Card>
      <CardContent className="space-y-4 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h3 className="truncate text-lg font-semibold">{site.domain}</h3>
              {site.isDemo && (
                <span className="rounded bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                  Демо-стенд
                </span>
              )}
            </div>
            {site.name && (
              <p className="truncate text-sm text-muted-foreground">
                {site.name}
              </p>
            )}
          </div>
          {!site.isDemo && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onDelete}
            >
              <Trash2 className="mr-1 h-4 w-4" /> Удалить
            </Button>
          )}
        </div>

        {!site.isDemo && status && <ConnectionStatusWidget status={status} />}

        <div className="space-y-2">
          <p className="text-sm font-medium">Код для вставки на сайт</p>
          <pre className="overflow-x-auto rounded-md bg-muted p-3 text-xs">
            <code>{snippet}</code>
          </pre>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onCopy}
          >
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
      </CardContent>
    </Card>
  )
}
