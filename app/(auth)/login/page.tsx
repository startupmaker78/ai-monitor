import Link from "next/link"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { LoginForm } from "./login-form"

export const metadata = {
  title: "Вход — Вебмонитор",
}

type SearchParams = {
  registered?: string
}

export default function LoginPage({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  const justRegistered = searchParams.registered === "1"

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-12">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Вход в Вебмонитор</CardTitle>
          <CardDescription>
            Войдите в свой аккаунт для доступа к дашборду
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {justRegistered && (
            <div className="rounded-md bg-primary/10 p-3 text-sm text-primary">
              Аккаунт успешно создан. Войдите, чтобы продолжить.
            </div>
          )}
          <LoginForm />
        </CardContent>
        <CardFooter className="flex justify-center text-sm text-muted-foreground">
          Нет аккаунта?{" "}
          <Link
            href="/signup"
            className="ml-1 font-medium text-primary hover:underline"
          >
            Зарегистрироваться
          </Link>
        </CardFooter>
      </Card>
    </div>
  )
}
