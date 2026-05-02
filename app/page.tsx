import Link from "next/link"
import { Button } from "@/components/ui/button"

export default function LandingPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-4 py-12">
      <div className="w-full max-w-2xl text-center">
        <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">
          Вебмонитор
        </h1>
        <p className="mt-4 text-lg text-muted-foreground">
          AI-анализ поведения посетителей вашего сайта.
          Понимайте, что мешает конверсии — и получайте конкретные
          рекомендации от Claude.
        </p>

        <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Button asChild size="lg">
            <Link href="/signup">Зарегистрироваться</Link>
          </Button>
          <Button asChild size="lg" variant="outline">
            <Link href="/login">Войти</Link>
          </Button>
        </div>

        <p className="mt-12 text-sm text-muted-foreground">
          Сервис в активной разработке. Полный лендинг и описание тарифов — скоро.
        </p>
      </div>
    </main>
  )
}
