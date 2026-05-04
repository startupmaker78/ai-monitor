import Link from "next/link"
import { BarChart3, User } from "lucide-react"
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

export const metadata = {
  title: "Настройки — Вебмонитор",
}

const SETTINGS_SECTIONS = [
  {
    title: "Профиль",
    description: "Имя, пароль, email",
    href: "/dashboard/settings/profile",
    icon: User,
  },
  {
    title: "Яндекс.Метрика",
    description: "ID счётчика и API-токен для каждого сайта",
    href: "/dashboard/settings/metrika",
    icon: BarChart3,
  },
]

export default function SettingsPage() {
  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight">Настройки</h2>
        <p className="mt-1 text-muted-foreground">
          Управление аккаунтом и интеграциями
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {SETTINGS_SECTIONS.map((section) => (
          <Link key={section.href} href={section.href}>
            <Card className="cursor-pointer transition-colors hover:bg-accent">
              <CardHeader>
                <div className="flex items-center gap-3">
                  <section.icon className="h-5 w-5 text-muted-foreground" />
                  <CardTitle>{section.title}</CardTitle>
                </div>
                <CardDescription>{section.description}</CardDescription>
              </CardHeader>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  )
}
