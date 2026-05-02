import { auth } from "@/auth"
import { redirect } from "next/navigation"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { logout } from "@/app/(auth)/logout/actions"

export const metadata = {
  title: "Дашборд — Вебмонитор",
}

export default async function DashboardPage() {
  const session = await auth()
  if (!session?.user) {
    redirect("/login")
  }

  return (
    <div className="container mx-auto max-w-4xl px-4 py-12">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">
            Привет, {session.user.name}!
          </h1>
          <p className="mt-1 text-muted-foreground">
            Здесь будет ваш дашборд
          </p>
        </div>
        <form action={logout}>
          <Button type="submit" variant="outline">
            Выйти
          </Button>
        </form>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Дашборд в разработке</CardTitle>
          <CardDescription>
            Аутентификация работает. Полный дашборд с метриками и AI-рекомендациями
            появится в следующих обновлениях.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>
            <span className="font-medium text-foreground">Email:</span> {session.user.email}
          </p>
          <p>
            <span className="font-medium text-foreground">Роль:</span> {session.user.role}
          </p>
          <p>
            <span className="font-medium text-foreground">User ID:</span> {session.user.id}
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
