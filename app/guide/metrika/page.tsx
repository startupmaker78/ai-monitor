import Link from "next/link"
import type { Metadata } from "next"
import ReactMarkdown from "react-markdown"
import rehypeSlug from "rehype-slug"
import guideMd from "@/docs/metrika-goals-guide.md"
import { WebmonitorTracker } from "@/components/webmonitor-tracker"

export const metadata: Metadata = {
  title: "Настройка целей Метрики — Вебмонитор",
  description:
    "Что настроить в Яндекс.Метрике, чтобы получить от Вебмонитора максимум: типы целей, получение API-токена, частые ошибки.",
}

// Публичная страница (вне (dashboard), вне middleware-гейта): открывается без
// логина — ссылку можно переслать владельцу счётчика, как советует сам гайд.
// Статическая, поэтому рендерится на сборке — тогда же прогоняется и
// prebuild-проверка якорей (scripts/check-guide-anchors.ts).

// Ручные стили markdown (без @tailwindcss/typography — одна страница не стоит
// плагина, и его типографика могла бы разойтись со стилем дашборда). pre в
// overflow-x-auto: длинная ссылка authorize не разъезжается на мобиле.
const mdComponents = {
  h1: (p: React.HTMLAttributes<HTMLHeadingElement>) => (
    <h1 className="mt-8 mb-4 text-2xl font-semibold tracking-tight" {...p} />
  ),
  h2: (p: React.HTMLAttributes<HTMLHeadingElement>) => (
    <h2
      className="mt-10 mb-3 scroll-mt-20 border-t pt-6 text-xl font-semibold tracking-tight"
      {...p}
    />
  ),
  h3: (p: React.HTMLAttributes<HTMLHeadingElement>) => (
    <h3 className="mt-6 mb-2 scroll-mt-20 text-base font-semibold" {...p} />
  ),
  p: (p: React.HTMLAttributes<HTMLParagraphElement>) => (
    <p className="my-3 leading-relaxed text-foreground/90" {...p} />
  ),
  ul: (p: React.HTMLAttributes<HTMLUListElement>) => (
    <ul className="my-3 list-disc space-y-1.5 pl-5 text-foreground/90" {...p} />
  ),
  ol: (p: React.HTMLAttributes<HTMLOListElement>) => (
    <ol
      className="my-3 list-decimal space-y-1.5 pl-5 text-foreground/90"
      {...p}
    />
  ),
  li: (p: React.HTMLAttributes<HTMLLIElement>) => (
    <li className="leading-relaxed" {...p} />
  ),
  a: (p: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a className="font-medium text-primary underline underline-offset-2" {...p} />
  ),
  strong: (p: React.HTMLAttributes<HTMLElement>) => (
    <strong className="font-semibold text-foreground" {...p} />
  ),
  hr: () => <hr className="my-8 border-border" />,
  code: (p: React.HTMLAttributes<HTMLElement>) => (
    <code
      className="rounded bg-muted px-1.5 py-0.5 text-sm font-mono text-foreground"
      {...p}
    />
  ),
  pre: (p: React.HTMLAttributes<HTMLPreElement>) => (
    <pre
      className="my-4 overflow-x-auto rounded-lg bg-muted p-4 text-sm [&>code]:bg-transparent [&>code]:p-0"
      {...p}
    />
  ),
  em: (p: React.HTMLAttributes<HTMLElement>) => (
    <em className="text-muted-foreground" {...p} />
  ),
}

export default function GuideMetrikaPage() {
  return (
    <div className="min-h-screen bg-background">
      {/* TEST: наш трекер на публичном /guide/metrika. */}
      <WebmonitorTracker />
      <header className="border-b">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-4">
          <Link href="/" className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary font-semibold text-primary-foreground">
              В
            </div>
            <span className="font-semibold">Вебмонитор</span>
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-8">
        <article className="break-words">
          <ReactMarkdown rehypePlugins={[rehypeSlug]} components={mdComponents}>
            {guideMd}
          </ReactMarkdown>
        </article>
      </main>
    </div>
  )
}
