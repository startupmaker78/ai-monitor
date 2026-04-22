# Вебмонитор — Architecture

> Архитектурные решения для MVP. Приоритет: простота развёртывания, минимум расходов, возможность масштабирования позже.

---

## Домен

Основной домен: **вебмонитор.рф** (IDN / кириллический).

**Важно про Punycode**: кириллические домены в браузере выглядят как вебмонитор.рф, но технически передаются в ASCII-форме. Получить точный Punycode:
```bash
node -e "const { toASCII } = require('punycode'); console.log(toASCII('вебмонитор.рф'))"
```
Punycode-форму обязательно использовать:
- в теге `<script src="...">` трекинг-скрипта (Тильда может не поддерживать IDN в атрибутах)
- в настройках DNS-записей
- в конфиге Resend для отправки email с домена @вебмонитор.рф

---

## Стек технологий

| Слой             | Технология                          | Причина выбора                                                    |
|------------------|-------------------------------------|-------------------------------------------------------------------|
| Frontend         | Next.js 14 (App Router)             | Быстрый деплой на Vercel, SSR, хорошая экосистема                |
| UI-компоненты    | shadcn/ui + Tailwind CSS            | Готовые компоненты, легко кастомизировать под #185FA5            |
| Backend          | Next.js API Routes                  | Один репозиторий, меньше деплоев, достаточно для MVP             |
| База данных      | Yandex Cloud Managed PostgreSQL     | 152-ФЗ (регион ru-central1), managed-сервис с автобэкапами       |
| ORM              | Prisma                              | Типизированные запросы, удобные миграции                         |
| Аутентификация   | NextAuth.js v5                      | Email+пароль, сессии, просто настраивается                       |
| Трекинг-скрипт   | rrweb                               | Проверенная библиотека записи сессий, не изобретаем велосипед    |
| AI-анализ        | Anthropic Claude API                | claude-sonnet-4-6 — баланс цена/качество                        |
| Хранение событий | Yandex Object Storage               | 152-ФЗ, S3-совместимый API, регион ru-central1                  |
| Email            | Resend                              | Простой API, бесплатный тир 3 000 писем/мес                     |
| Платежи          | ЮКасса (YooKassa)                  | Российский эквайринг, рекуррентные платежи                       |
| Хостинг compute  | Vercel                              | Serverless Next.js, личные данные не хранит — 152-ФЗ допустимо  |

> **152-ФЗ и Vercel**: Vercel выполняет только вычисления (обрабатывает запросы и передаёт данные в российское хранилище). Персональные данные посетителей хранятся исключительно в Yandex Cloud (ru-central1, Москва). Compute-платформа по 152-ФЗ не регулируется — регулируется только место хранения. Связка Vercel (compute) + Yandex Cloud (data) полностью соответствует требованиям.

---

## Структура репозитория

```
webmonitor/  (папка проекта, англ. транслитерация домена)
├── app/                        # Next.js App Router
│   ├── (auth)/                 # Группа: страницы аутентификации
│   │   ├── login/page.tsx
│   │   └── invite/[token]/page.tsx
│   ├── (dashboard)/            # Группа: защищённые страницы
│   │   ├── layout.tsx          # Общий layout с навигацией
│   │   ├── overview/page.tsx   # Дашборд владельца
│   │   ├── recommendations/page.tsx
│   │   ├── history/page.tsx
│   │   └── settings/page.tsx
│   ├── (contractor)/           # Группа: кабинет подрядчика
│   │   ├── clients/page.tsx
│   │   ├── earnings/page.tsx
│   │   └── invite/page.tsx
│   └── api/                    # API Routes (бэкенд)
│       ├── auth/[...nextauth]/route.ts
│       ├── tracking/collect/route.ts   # Приём данных от скрипта
│       ├── metrika/sync/route.ts       # Синхронизация с Я.Метрикой
│       ├── analysis/run/route.ts       # Запуск AI-анализа
│       ├── clients/route.ts
│       └── webhooks/yookassa/route.ts
├── components/                 # Переиспользуемые компоненты
│   ├── ui/                     # shadcn/ui компоненты
│   ├── charts/                 # Графики (recharts)
│   ├── recommendations/
│   └── sessions/
├── lib/                        # Утилиты и интеграции
│   ├── prisma.ts               # Prisma client singleton
│   ├── claude.ts               # Anthropic API клиент
│   ├── metrika.ts              # Яндекс.Метрика API
│   ├── yookassa.ts             # ЮКасса клиент
│   ├── resend.ts               # Email клиент
│   ├── storage.ts              # Клиент Yandex Object Storage (S3-совместимый)
│   └── crypto.ts               # Хэширование IP и токенов
├── prisma/
│   ├── schema.prisma           # Схема базы данных
│   └── migrations/
├── public/
│   └── tracker.js              # Собранный трекинг-скрипт (rrweb)
├── tracker-src/                # Исходник трекинг-скрипта
│   └── index.ts
├── PRODUCT.md
├── ARCHITECTURE.md
├── ROADMAP.md
└── DECISIONS.md
```

---

## Схема базы данных (Prisma)

### Основные сущности

```
User (пользователи)
  id, email, passwordHash, role (CONTRACTOR | OWNER), createdAt

ContractorProfile
  id, userId, balance, totalEarned

OwnerProfile  
  id, userId, contractorId (FK), siteUrl, tildaSiteId
  metrikaCounterId, metrikaToken

Subscription
  id, ownerId, plan (BASIC | PRO | BUSINESS | ENTERPRISE)
  billingPeriod (MONTHLY | ANNUAL)
  status (ACTIVE | CANCELLED | TRIAL)
  currentPeriodStart, currentPeriodEnd
  analysesUsedThisMonth, yookassaSubscriptionId

Site
  id, ownerId, domain, trackingToken (уникальный токен для скрипта)

Session (сессии посетителей, хранятся 30 дней)
  id, siteId, sessionToken, ipHash, userAgent
  startedAt, endedAt, eventsCount
  storageKey (ключ в Object Storage для rrweb-данных)

MetricsSnapshot (ежедневный снапшот всех метрик сайта)
  id, siteId, date (unique per site per day)
  visits, uniqueVisitors, conversions, bounceRate, avgSessionDuration
  goals (JSON)                     # цели Метрики: {name, count, conversionRate}
  source (METRIKA | MANUAL)        # откуда данные

Analysis (результаты AI-анализа)
  id, siteId, requestedBy, status (PENDING | RUNNING | DONE | FAILED)
  prompt, createdAt, completedAt
  sessionsAnalyzed, tokensUsed
  recommendationsCount             # сколько рекомендаций вернул AI

Recommendation (отдельные рекомендации из анализа)
  id, analysisId, priority (CRITICAL | IMPORTANT | GOOD)
  title, description, metric
  status (NEW | IN_PROGRESS | DONE | REJECTED)
  sortOrder                        # порядок от AI (топ-10 = 1..10, остальные > 10)
  rejectionReason (string, nullable)
  acceptedAt (datetime, nullable)  # когда перевели в IN_PROGRESS
  appliedAt (datetime, nullable)   # когда перевели в DONE
  metricsBefore (JSON, nullable)   # снапшот MetricsSnapshot на момент IN_PROGRESS
  metricsAfter (JSON, nullable)    # снапшот MetricsSnapshot через 7 дней после DONE

InviteToken
  id, contractorId, email, token, expiresAt, usedAt
  companyName, phone, metrikaCounterId  # данные из формы подрядчика

PaymentEvent (история платежей)
  id, subscriptionId, amount, commissionAmount
  yookassaPaymentId, status, createdAt
  billingPeriod (MONTHLY | ANNUAL)
```

---

## Трекинг-скрипт

### Принцип работы
1. Владелец вставляет в Тильду одну строку (в «Код сайта» → HTML в начале HEAD):
   ```html
   <script src="https://cdn.вебмонитор.рф/tracker.js?token=SITE_TOKEN"></script>
   ```
   Для Тильды и других платформ, не поддерживающих IDN в атрибутах, используется Punycode-форма URL.

2. Скрипт загружает rrweb, начинает запись сессии
3. Каждые 30 секунд или при закрытии страницы отправляет пакет событий на `POST /api/tracking/collect`
4. **Маскировка PII** — перед отправкой заменяет значения полей `input[type=password]`, `input[type=email]`, `input[type=tel]` на `***`
5. IP хэшируется на сервере (SHA-256 + соль из env) перед записью в БД

### Хранение
- Метаданные сессии → Yandex Cloud Managed PostgreSQL (таблица `Session`)
- Сырые rrweb-события → Yandex Object Storage (JSON, до 30 дней, регион ru-central1)
- Cron-задача раз в сутки удаляет сессии старше 30 дней

---

## AI-анализ

### Поток данных
1. Пользователь нажимает «Запустить анализ»; API проверяет `analysesUsedThisMonth < plan.limit`
2. API создаёт запись `Analysis` со статусом `PENDING`
3. Фоновая задача (Vercel Background Functions или очередь):
   - Загружает последние N сессий из Yandex Object Storage
   - Загружает последние 30 снапшотов из `MetricsSnapshot`
   - Формирует промпт для Claude
   - Вызывает `claude-sonnet-4-6` со streaming
4. Результат парсится → массив рекомендаций **любой длины** (обычно 10–20)
5. Все рекомендации сохраняются в БД с полем `sortOrder` (AI возвращает их уже в нужном порядке приоритета)
6. Статус `Analysis` → `DONE`, фронт обновляется
7. В интерфейсе по умолчанию отображаются записи с `sortOrder <= 10`; кнопка «Показать ещё N» подгружает остальные

### Ограничения по тарифам
- Проверяется `analysesUsedThisMonth < plan.maxAnalyses` перед запуском
- Счётчик сбрасывается в начале каждого платёжного периода

---

## Интеграция с Яндекс.Метрикой

- Пользователь вводит API-ключ и ID счётчика вручную (в MVP, OAuth — позже)
- Ежедневный cron (Vercel Cron Jobs) вызывает `/api/metrika/sync`
- Данные за последние 30 дней сохраняются в `MetrikaSnapshot`

---

## Платежи (ЮКасса)

- Юрлицо: ООО «Супер Просто»
- Рекуррентные платежи через ЮКасса Subscriptions API
- Webhook `POST /api/webhooks/yookassa` получает события оплаты
- При успешной оплате: обновляем `Subscription`, начисляем 50% комиссию подрядчику
- Вывод средств — ручной процесс на MVP (подрядчик отправляет запрос, выплата вручную)

---

## Дизайн

- Основа: shadcn/ui + Tailwind CSS
- Цветовая схема: сине-белая, главный акцентный цвет `#185FA5`
- Референсные HTML-прототипы предоставит Лёша — используем их для кастомизации shadcn-тем
- В `tailwind.config.ts` задаём `primary: '#185FA5'` как кастомный цвет

---

## Окружение (Environment Variables)

```
# База данных
DATABASE_URL              # Yandex Cloud Managed PostgreSQL connection string

# Аутентификация
NEXTAUTH_SECRET           # Секрет для сессий
NEXTAUTH_URL              # URL приложения (https://вебмонитор.рф или Punycode)

# AI
ANTHROPIC_API_KEY         # Claude API

# Яндекс
METRIKA_CLIENT_ID         # Яндекс OAuth app (для будущего OAuth)
METRIKA_CLIENT_SECRET

# Платежи
YOOKASSA_SHOP_ID          # ЮКасса (ООО «Супер Просто»)
YOOKASSA_SECRET_KEY

# Email
RESEND_API_KEY            # Resend

# Yandex Object Storage (S3-совместимый, регион ru-central1)
YOS_ACCESS_KEY_ID
YOS_SECRET_ACCESS_KEY
YOS_BUCKET_NAME
YOS_ENDPOINT               # https://storage.yandexcloud.net
YOS_PUBLIC_URL             # Публичный URL бакета для отдачи tracker.js

# Безопасность
IP_HASH_SALT              # Соль для хэширования IP (SHA-256)
```
