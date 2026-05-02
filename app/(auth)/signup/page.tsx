import Link from "next/link"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { SignupForm } from "./signup-form"

export const metadata = {
  title: "Регистрация — Вебмонитор",
}

export default function SignupPage() {
  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-12">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Создать аккаунт</CardTitle>
          <CardDescription>
            Начните анализировать поведение посетителей и получать AI-рекомендации
          </CardDescription>
        </CardHeader>
        <CardContent>
          <SignupForm />
        </CardContent>
        <CardFooter className="flex justify-center text-sm text-muted-foreground">
          Уже есть аккаунт?{" "}
          <Link href="/login" className="ml-1 font-medium text-primary hover:underline">
            Войти
          </Link>
        </CardFooter>
      </Card>
    </div>
  )
}
