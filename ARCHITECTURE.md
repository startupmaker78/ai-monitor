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
| Frontend         | Next.js 14 (App Router)             | SSR, App Router, хорошая экосистема                              |
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
| Хостинг compute  | Yandex Cloud                        | ru-central1, 152-ФЗ, конкретный сервис уточняется на этапе деплоя |

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
│   │   ├── targets/page.tsx    # Управление целями анализа
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
│       ├── targets/route.ts            # CRUD целей анализа
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
  id, email, passwordHash, name, role (ADMIN | CONTRACTOR | OWNER)
  createdAt, updatedAt
  # role по умолчанию OWNER. Смена на CONTRACTOR — после APPROVED
  # PartnerApplication, смена на ADMIN — вручную.

ContractorProfile
  id, userId, balance, totalEarned
  # Создаётся ТОЛЬКО при APPROVED PartnerApplication.

OwnerProfile
  id, userId, contractorId (FK, nullable), siteUrl, tildaSiteId
  metrikaCounterId, metrikaToken
  # contractorId NULL для самостоятельно зарегистрированных владельцев.
  # Задним числом проставить нельзя (защита от фрода).

Subscription
  id, ownerId, plan (BASIC | STANDARD | PROFESSIONAL | CORPORATE)
  billingPeriod (MONTHLY | ANNUAL)
  status (ACTIVE | CANCELLED | TRIAL)
  currentPeriodStart, currentPeriodEnd
  analysesUsedThisMonth, yookassaSubscriptionId
  customLimits (JSON, nullable)
  # customLimits — для Enterprise-клиентов (индивидуальная цена,
  # обрабатывается админом вручную). Поле не null означает
  # "кастомные лимиты переопределяют plan".
  # Кастомные лимиты могут переопределять любые поля плана:
  # количество целей анализа, анализов в месяц, сессий в месяц,
  # длительность кулдауна между анализами одной цели.
  # Имена тарифов в UI (русские) маппятся из enum:
  #   BASIC → «Базовый»
  #   STANDARD → «Стандартный»
  #   PROFESSIONAL → «Профессиональный»
  #   CORPORATE → «Корпоративный»

Site
  id, ownerId, domain, trackingToken (уникальный токен для скрипта)
  isDemo (Boolean, default false)
  # isDemo=true для демо-стендов, которые создаются автоматически
  # при регистрации подрядчиков и self-service владельцев.
  # В демо подгружаются фиксированные seed-данные, реальный
  # трекинг не собирается.

AnalysisTarget (страницы сайта, по которым можно запускать AI-анализ)
  id, siteId (FK Site), url, name (string, nullable)
  createdAt, archivedAt (datetime, nullable)
  # url — конкретный URL страницы (например, "https://site.ru/pricing").
  # На MVP только конкретные URL, без паттернов и масок.
  # name — человекочитаемое имя цели для UI ("Страница цен"); опционально.
  # archivedAt — soft delete вместо физического удаления, потому что
  # Analysis ссылается на AnalysisTarget через targetId, и история
  # анализов должна сохраняться. При archivedAt != NULL цель скрыта
  # из UI выбора при запуске нового анализа, но прошлые анализы
  # доступны в истории.
  # Лимит активных целей (archivedAt IS NULL) на сайт зависит от
  # Subscription.plan и проверяется при создании новой цели:
  #   BASIC — 2, STANDARD — 6, PROFESSIONAL — 12, CORPORATE — 24,
  #   Enterprise — из customLimits.

Session (сессии посетителей, хранятся 30 дней)
  id, siteId, sessionToken, ipHash, userAgent
  startedAt, endedAt, eventsCount
  storageKey (ключ в Object Storage для rrweb-данных)
  # Метаданные в PostgreSQL удаляются cron-задачей через 30 дней,
  # параллельно с lifecycle policy Object Storage на префикс sessions/.
  # Сессии собираются со ВСЕХ страниц сайта, не только с тех, что
  # добавлены как AnalysisTarget. Лимит сессий в месяц по тарифу
  # считается суммарно по всем страницам сайта.

MetricsSnapshot (ежедневный снапшот всех метрик сайта)
  id, siteId, date (unique per site per day)
  visits, uniqueVisitors, conversions, bounceRate, avgSessionDuration
  goals (JSON)                     # цели Метрики: {name, count, conversionRate}
  source (METRIKA | MANUAL)        # откуда данные
  # Хранится БЕЗ удаления (для долгосрочной аналитики "год назад").

Analysis (результаты AI-анализа)
  id, siteId, targetId (FK AnalysisTarget, NOT NULL)
  requestedBy, status (PENDING | RUNNING | DONE | FAILED)
  prompt, createdAt, completedAt
  sessionsAnalyzed, tokensUsed
  recommendationsCount             # сколько рекомендаций вернул AI
  # Хранится без удаления. createdAt используется для проверки
  # кулдауна на пару (siteId, targetId) — длительность кулдауна
  # зависит от Subscription.plan (7 или 3 дня).
  # targetId NOT NULL — каждый анализ привязан к конкретной цели;
  # legacy-данных нет, модель вводится одновременно с
  # AnalysisTarget на этапе 0.c.5.

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
  # Хранится без удаления. metricsBefore снимается при переходе в
  # IN_PROGRESS, metricsAfter — через 7 дней после DONE.

InviteToken
  id, contractorId, email, token, expiresAt, usedAt
  # Раньше хранил companyName/phone/metrikaCounterId — эти данные
  # владелец теперь вводит сам при регистрации. Токен — только
  # для привязки к подрядчику.

PaymentEvent (история платежей)
  id, subscriptionId, amount, commissionAmount
  yookassaPaymentId, status, createdAt
  billingPeriod (MONTHLY | ANNUAL)

PartnerApplication (заявка на партнёрство)
  id, userId (FK User), companyName, experience
  portfolioUrl (nullable), telegram (nullable), phone (nullable)
  status (PENDING | APPROVED | REJECTED)
  rejectionReason (nullable)
  reviewedBy (FK User, nullable, role=ADMIN), reviewedAt (nullable)
  createdAt, updatedAt
  # Заявка пользователя OWNER на получение роли CONTRACTOR.
  # При APPROVED — админ меняет User.role на CONTRACTOR и
  # создаёт ContractorProfile.
```

### Лимиты по тарифам

Лимиты определяются на уровне приложения (не в схеме БД), исходя из `Subscription.plan`:

| Plan          | Целей анализа | Анализов/мес | Сессий/мес | Кулдаун между анализами одной цели |
|---------------|---------------|--------------|------------|------------------------------------|
| BASIC         | 2             | 4            | 1 000      | 7 дней                             |
| STANDARD      | 6             | 12           | 2 500      | 7 дней                             |
| PROFESSIONAL  | 12            | 24           | 5 000      | 3 дня                              |
| CORPORATE     | 24            | 48           | 10 000     | 3 дня                              |
| Enterprise    | из customLimits | из customLimits | из customLimits | из customLimits |

Для Enterprise значения берутся из `Subscription.customLimits` (JSON с ключами `targetsLimit`, `analysesPerMonth`, `sessionsPerMonth`, `cooldownDays`).

---

## Трекинг-скрипт

### Принцип работы
1. Владелец вставляет в Тильду одну строку (в «Код сайта» → HTML в начале HEAD):
```html
   <script src="https://cdn.вебмонитор.рф/tracker.js?token=SITE_TOKEN"></script>
```
   Для Тильды и других платформ, не поддерживающих IDN в атрибутах, используется Punycode-форма URL.

2. Скрипт загружает rrweb, начинает запись сессии **на всех страницах сайта** (не ограничивается списком AnalysisTarget — цели касаются только AI-анализа, не трекинга)
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
1. Пользователь выбирает одну из настроенных `AnalysisTarget` (URL страницы) и нажимает «Запустить анализ»; API проверяет все условия запуска (см. ниже)
2. API создаёт запись `Analysis` со статусом `PENDING` и привязкой к выбранной `targetId`
3. Фоновая задача (Yandex Cloud Functions или очередь — конкретный сервис уточняется на этапе деплоя):
   - Загружает последние N сессий из Yandex Object Storage, **отфильтрованных по URL цели** (только сессии, в которых посетитель был на странице цели)
   - Загружает последние 30 снапшотов из `MetricsSnapshot`
   - Формирует промпт для Claude
   - Вызывает `claude-sonnet-4-6` со streaming
4. Результат парсится → массив рекомендаций **любой длины** (обычно 10–20)
5. Все рекомендации сохраняются в БД с полем `sortOrder` (AI возвращает их уже в нужном порядке приоритета)
6. Статус `Analysis` → `DONE`, фронт обновляется
7. В интерфейсе по умолчанию отображаются записи с `sortOrder <= 10`; кнопка «Показать ещё N» подгружает остальные

### Условия запуска нового анализа

Для запуска нового анализа должны выполняться ВСЕ четыре условия одновременно (см. DECISIONS.md):

1. **Цель добавлена в список целей сайта** — нельзя запустить анализ по случайному URL, только по заранее настроенному `AnalysisTarget` с `archivedAt IS NULL` и `siteId` соответствующего сайта.

2. **Все топ-10 рекомендаций предыдущего анализа этой же цели обработаны** — в статусе DONE или REJECTED. Рекомендации в статусе NEW или IN_PROGRESS блокируют запуск нового анализа этой цели. Анализы других целей не блокируют.

   Технически: `COUNT(Recommendation WHERE analysisId = previous_for_this_target AND sortOrder <= 10 AND status IN ('NEW', 'IN_PROGRESS')) == 0`, где `previous_for_this_target` — последний `Analysis` с этим `targetId`.

   Рекомендации с `sortOrder > 10` (скрытые под «Показать ещё») на блокировку не влияют.

3. **Прошло минимум N дней с момента предыдущего анализа этой же цели** — для накопления метрик и проявления эффекта от внедрённых изменений. Длительность кулдауна зависит от тарифа:
   - BASIC, STANDARD: N = 7 дней
   - PROFESSIONAL, CORPORATE: N = 3 дня
   - Enterprise: N из `Subscription.customLimits.cooldownDays`

   Технически: `NOW() - previousAnalysisForThisTarget.createdAt >= N days`. Кулдаун считается на пару (siteId, targetId), не глобально по сайту.

4. **Не превышен месячный лимит анализов по сайту**:
   - BASIC: максимум 4 анализа в месяц
   - STANDARD: максимум 12 анализов в месяц
   - PROFESSIONAL: максимум 24 анализа в месяц
   - CORPORATE: максимум 48 анализов в месяц
   - Enterprise: кастомные лимиты из `Subscription.customLimits.analysesPerMonth`

   Лимит общий по всему сайту в любой комбинации целей. Счётчик `Subscription.analysesUsedThisMonth` сбрасывается в начале каждого платёжного периода.

Если хотя бы одно условие не выполнено — кнопка «Запустить анализ» на фронте заблокирована с пояснением, какое именно условие не выполнено и для какой цели.

---

## Онбординг

В системе два параллельных флоу регистрации владельцев сайтов (см. PRODUCT.md).

### Флоу 1 — Self-service регистрация

1. Владелец заходит на вебмонитор.рф, нажимает «Зарегистрироваться»
2. Заполняет форму: email, пароль, имя
3. Создаётся `User` с `role=OWNER`, `OwnerProfile` с `contractorId=NULL`
4. Автоматически создаётся `Site` с `isDemo=true` — демо-стенд с заполненными данными для быстрого знакомства с продуктом
5. Владелец попадает в дашборд, видит демо-стенд в списке сайтов
6. Выбирает тариф, оплачивает через ЮКасса
7. Добавляет свой реальный сайт (`isDemo=false`), устанавливает трекинг-скрипт и настраивает первые цели анализа (`AnalysisTarget`)

### Флоу 2 — Регистрация по приглашению подрядчика

1. Подрядчик заполняет форму «Пригласить клиента»: URL сайта, email владельца, ID Яндекс.Метрики
2. Создаётся `InviteToken` с привязкой к `contractorId`
3. На email владельца уходит письмо со ссылкой вида `https://вебмонитор.рф/invite/<token>` и временным паролем
4. Владелец переходит по ссылке, логинится с временным паролем
5. При первом входе требуется смена пароля
6. Создаётся `User` с `role=OWNER`, `OwnerProfile` с `contractorId` = подрядчик из `InviteToken`
7. Данные сайта (URL, ID Метрики) предзаполнены из формы подрядчика — владельцу остаётся только установить скрипт и настроить цели анализа
8. Демо-стенд (`Site` с `isDemo=true`) НЕ создаётся — подрядчик уже показал продукт через свой демо перед отправкой приглашения
9. Подрядчик видит нового клиента в своём кабинете со статусом «Активен»

### Защита от фрода

Самостоятельно зарегистрированного владельца НЕЛЬЗЯ привязать к подрядчику задним числом. Даже если подрядчик утверждает «это мой клиент, я его привёл по другому каналу» — система это не учитывает. Это защита от абьюза партнёрской программы.

Привязка к подрядчику фиксируется только в момент создания `OwnerProfile` на основе использованного `InviteToken`.

---

## Партнёрская программа

Подрядчики (дизайнеры, верстальщики, маркетологи) не могут сами создать себе кабинет с ролью CONTRACTOR — они проходят валидацию админом (см. PRODUCT.md).

### Флоу заявки на партнёрство

1. Пользователь с `role=OWNER` заходит в настройки, жмёт «Стать партнёром»
2. Заполняет форму: название компании, описание опыта, ссылка на портфолио (опционально), telegram или телефон для связи
3. Создаётся `PartnerApplication` со статусом `PENDING`
4. Админ получает уведомление о новой заявке в служебной панели
5. Админ просматривает заявку и принимает решение:
   - **APPROVED**:
     * Статус `PartnerApplication` → `APPROVED`, фиксируется `reviewedBy` и `reviewedAt`
     * `User.role` меняется с `OWNER` на `CONTRACTOR`
     * Создаётся `ContractorProfile` для этого `userId`
     * Автоматически создаётся `Site` с `isDemo=true` (демо-стенд для показа клиентам)
     * На email подрядчика отправляется письмо с уведомлением об одобрении
   - **REJECTED**:
     * Статус `PartnerApplication` → `REJECTED`
     * Заполняется `rejectionReason`
     * `User.role` остаётся `OWNER` — пользователь продолжает пользоваться сервисом как владелец
     * На email отправляется письмо с причиной отклонения
6. Подрядчик после APPROVED получает доступ к своему кабинету, может приглашать клиентов и видеть свой заработок

### Начисление комиссий

Комиссия 50% начисляется подрядчику при успешной оплате клиента, приведённого по `InviteToken` (см. секцию «Платежи»).

Комиссия с самостоятельно зарегистрированных владельцев (`OwnerProfile.contractorId = NULL`) НЕ начисляется никому — идёт в полном объёме компании.

---

## Интеграция с Яндекс.Метрикой

- Пользователь вводит API-ключ и ID счётчика вручную (в MVP, OAuth — позже)
- Ежедневный cron (Yandex Cloud — конкретный сервис уточняется на этапе деплоя) вызывает `/api/metrika/sync`
- Данные за последние 30 дней сохраняются в `MetricsSnapshot`

---

## Платежи (ЮКасса)

- Юрлицо: ООО «Супер Просто»
- Рекуррентные платежи через ЮКасса Subscriptions API
- Webhook `POST /api/webhooks/yookassa` получает события оплаты
- При успешной оплате: обновляем `Subscription`, проверяем `OwnerProfile.contractorId`:
  - если не NULL — начисляем 50% комиссию соответствующему подрядчику (в `ContractorProfile.balance`)
  - если NULL (self-service владелец) — комиссия никому не начисляется, доход идёт компании в полном объёме
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
