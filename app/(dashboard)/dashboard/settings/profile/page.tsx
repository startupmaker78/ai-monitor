import { auth } from "@/auth"
import { redirect } from "next/navigation"
import { prisma } from "@/lib/prisma"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { ProfileForm } from "./profile-form"
import { PasswordForm } from "./password-form"

export const metadata = {
  title: "Профиль — Вебмонитор",
}

export default async function ProfilePage() {
  const session = await auth()
  if (!session?.user?.id) redirect("/login")

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { email: true, name: true },
  })

  if (!user) redirect("/login")

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight">Профиль</h2>
        <p className="mt-1 text-muted-foreground">
          Управление личной информацией и безопасностью
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Личная информация</CardTitle>
          <CardDescription>
            Email: {user.email} (не изменяется)
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ProfileForm initialName={user.name ?? ""} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Безопасность</CardTitle>
          <CardDescription>Смена пароля</CardDescription>
        </CardHeader>
        <CardContent>
          <PasswordForm />
        </CardContent>
      </Card>
    </div>
  )
}
