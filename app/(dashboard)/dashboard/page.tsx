import { auth } from "@/auth"

export const metadata = {
  title: "Дашборд — Вебмонитор",
}

export default async function DashboardPage() {
  const session = await auth()

  return (
    <div className="space-y-4">
      <h2 className="text-2xl font-semibold tracking-tight">
        Привет, {session?.user?.name ?? "Пользователь"}!
      </h2>
      <p className="text-muted-foreground">
        Это твой дашборд. В коммите 2.4 добавим KPI и графики.
      </p>
    </div>
  )
}
