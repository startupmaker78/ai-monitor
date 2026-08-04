import { YandexMetrika } from "@/components/yandex-metrika"
import { WebmonitorTracker } from "@/components/webmonitor-tracker"

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      {/* TEST: счётчик Метрики + наш трекер на публичных /login, /signup.
          Цели на /login,/signup НЕ заводим (ввод учётных данных) — трекер тут
          писать не будет (no_target), но пусть висит единообразно. */}
      <YandexMetrika />
      <WebmonitorTracker />
    </>
  )
}
