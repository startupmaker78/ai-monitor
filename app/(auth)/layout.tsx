import { YandexMetrika } from "@/components/yandex-metrika"

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      {/* TEST: счётчик Метрики на публичных /login, /signup (разведка btn). */}
      <YandexMetrika />
    </>
  )
}
