# TODO перед релизом MVP

## Архитектура трекера (приоритет 1)
- [ ] Реализовать "запись только на target URLs" — архитектурный
  pivot (DECISIONS.md 2026-05-08): меняет workflow,
  computeDominantUrl теряет смысл (matcher → simple filter),
  privacy 152-ФЗ, S3 cost -5-7x. Implementation 2-3 дня.
  Реализовать ПОСЛЕ подтверждения что финализация работает
  стабильно (cron + tracker pagehide).
- [ ] Tracker pagehide финализация — проверить работает ли на
  реальных юзерах. Сейчас финализация спасается через cron, но
  если pagehide не работает — Matched=0 на новых сессиях (matcher
  триггерится только при isFinal=true в /api/tracking/collect).
  Дебажить через DevTools Network с фильтром collect и Preserve
  log при закрытии вкладки.
- [ ] Sampling.mousemove (сейчас 50ms) — проверить при реальных
  нагрузках; если low FPS / много events — увеличить до 100-200ms.
- [ ] Hard limit ~50k events per session — после cap'а start new
  session (а не drop overflow), защита от длинных юзер-сессий
  100k+ events.
- [ ] Замерить реальный размер сессий в S3
  (sessions/{siteId}/{token}/), средний MB на сессию. Через 1-2
  недели работы на nolim.cc.

## Наблюдаемость трекера
- [ ] Chunking пакетов >3 MiB — pending до появления
  outlier-кейсов. Первая замерённая сессия nolim.cc после деплоя
  a3291bc: FullSnapshot 1.40 MiB, packet 0 total 1.42 MiB (~47%
  cap 3 MiB). Trigger для реализации chunking: любые логи
  `[webmonitor] PACKET DROPPED` с reason=http_413 или замеры
  packet bytes > 3 * 1024 * 1024. Проверять раз в неделю или при
  жалобах на пробелы в плеере.
- [ ] Мониторинг droppedPackets: если увидим
  `session ended with droppedPackets>0` — приоритизировать
  chunking. Structured log добавлен в трекере (deploy a3291bc):
  `[webmonitor] PACKET DROPPED idx=X reason=... bytes=... events=...`
  греппится в DevTools Console и в YC container logs.
- [ ] После реализации DECISIONS 2026-05-08 (target URLs pivot)
  — перезамерить FullSnapshot + incremental размеры.
  FullSnapshot не изменится (это snapshot DOM), но incremental
  events уменьшатся → общее тело пакета упадёт. Ожидание: cap
  3 MiB станет ещё более комфортным.
- [ ] Outlier cases для будущей chunking-задачи (для памяти при
  анализе): страницы с очень большим DOM (длинные списки
  товаров, бесконечный feed), inline data attributes /
  комментариями, SPA-навигация с повторными FullSnapshot через
  checkoutEveryNms.

## Трекер / сессии (post-pivot 2026-07-07)
- [ ] Пустые сессии жрут бюджет. После pivot'а сессия с events=0
  (юзер зашёл на target и сразу закрыл) всё равно создаётся,
  получает targetId и инкрементит sessionsCollected. Из 5
  тестовых сессий academy только 1 имела 593 events, остальные
  0-7. Предложить минимальный порог events (например, не
  инкрементить sessionsCollected / не финализировать сессию если
  events < N), чтобы AI-анализ не тратил бюджет на пустышки.
  Требует продуктового решения по порогу.
- [ ] sessionsCollected семантика изменена (pivot 2026-07-07):
  теперь считает STARTED сессии (инкремент на первом пакете), а
  не COMPLETED (раньше на isFinal). Существующие targets не
  пересчитывались. Задокументировать в DECISIONS.md если ещё не.
- [ ] Пре-pivot orphan сессии (без targetId) остаются в БД до
  lifecycle-expire (30 дней). Не критично, само вычистится.

## Инфра / recovery
- [ ] Post-suspend recovery runbook в DEPLOY_SETUP.md. После
  неоплаты Yandex Cloud суспендит ресурсы и НЕ восстанавливает
  автоматически при оплате. Вручную поднимать (в порядке):
  1. PostgreSQL cluster: `yc managed-postgresql cluster start
     <id>` (~5 мин)
  2. API Gateway: `yc serverless api-gateway resume <id>`
  3. Cron trigger: `yc serverless trigger resume <id>`
  Проверить: домен резолвится, /api/health отвечает, login
  работает.
- [ ] Bucket CORS настроен вручную через одноразовый скрипт
  (PutBucketCorsCommand). Нужно вынести в инфра-as-code или в
  setup-скрипт репозитория. Текущие allowed origins:
  staging.вебмонитор.рф, вебмонитор.рф, localhost:3000/3001.
  Bucket: webmonitor-prod-storage. Правило: GET, AllowedHeaders
  *, MaxAge 3600.
- [ ] Gateway CORS настроен вручную. В openapi-спеке API Gateway
  был блок `x-yc-apigateway.cors` с `origin:'*'`, который
  перехватывал preflight и глушил CORS из контейнера (ломал
  sendBeacon с credentials). Убрали блок вручную через
  `api-gateway update --spec`. Нужно: (а) вынести спеку gateway в
  инфра-as-code / репозиторий, чтобы не потерять при
  пересоздании; (б) задокументировать что CORS живёт в
  контейнере (route.ts), gateway не должен лезть.
- [ ] YC Logging read quota исчерпывается (ResourceExhausted).
  Проверить настройки квоты logging group, при необходимости
  увеличить или reduce log verbosity в container.
- [ ] MIN_SESSIONS_BUDGET сейчас =5 на staging (для тестов
  academy). Перед релизом MVP вернуть 100 (сменой значения в
  Lockbox + redeploy revision, без rebuild).

## Pre-processor (этап 6.3, приоритет 2)
- [ ] Cherry-pick 6.3a scaffold из ветки backup/6.3a-scaffold
  (origin, commit c65b202). Реализация pre-processor этапов 6.3
  b/c/d.
- [ ] Smoke test extractSessionSummary на реальной сессии nolim.cc
- [ ] 6.3b: clicks + rage/dead heuristics (DOM-id-map + tagName + 
  significant attrs)
- [ ] 6.3c: form interactions
- [ ] 6.3d: интеграция в analysis-runner (replace mock-session-data)

## Безопасность
- [ ] CRON_SECRET ротировать. Засветился в чате 4 раза за
  2026-05-08: при `yc trigger create` (старое значение
  ec9fa9...), при `yc trigger get`, при `yc trigger delete` (то
  же значение), и при ручной проверке Lockbox (новое значение
  9c1f..., первые 4 символа). Старое значение уже не
  используется (заменено в Lockbox версия e6qv1lflqjl8qbe7js2l).
  Перед релизом MVP — ротировать новое значение тоже.
- [ ] Ротировать trackingToken для nolim.cc
  (a5b9a7d99e614c86bb2304e2cf9dcde9) — засветился в чате 7 мая
  2026.
- [ ] Пересоздать удалённые YC cron triggers (parameters в
  DECISIONS 2026-05-07).
- [ ] Audit всех утечек secrets в чатах через transcripts/.
  Составить финальный список перед массовой ротацией. Известные:
  PG password 2x, CRON_SECRET 4x за 2026-05-08, trackingToken
  nolim.cc 7 мая.
- [ ] yc CLI команды (trigger create/get/delete) выводят payload
  в plaintext stdout. На будущее — для всех таких команд
  использовать `> /dev/null 2>&1` для подавления вывода.
- [ ] IAM-токен пользователя засветился 2026-05-08 в выводе
  `yc config list` (первые 4 символа: y0__). Принято решение
  ротировать вместе с остальными секретами перед релизом MVP.
- [ ] Lesson learned: `yc config list` всегда выводит token в
  первой строке. На будущее использовать `yc config get
  <field>` (например `yc config get folder-id`) либо
  фильтровать `yc config list 2>&1 | grep -v '^token:'`.
  Никогда не пайпать `yc config list` через простой `head`.

## UI / UX
- [ ] Timezone в UI: дашборд сессий показывает дату/время в UTC,
  нужно показывать timezone юзера (Intl.DateTimeFormat без явного
  timeZone использует браузерный TZ — может уже работает
  "случайно", проверить SSR vs CSR).
- [ ] Воспроизведение активных сессий (endedAt: null) — сейчас
  плеер показывает "Сессия ещё активна" без проверки eventsCount.
  Если events уже есть в S3 — можно играть partial-запись с
  баннером "обновите страницу для свежих событий". Возможный баг
  в client logic в session-player.tsx.
- [ ] Решить судьбу директории `plans/` — оставить как
  постоянная директория для архитектурных планов фич, или
  удалять после реализации? Сейчас там лежит
  rrweb-player-plan.md (untracked).

## Плеер сессий (оптимизации, не срочно)
- [ ] Presigned URL approach работает, но при 20+ packets
  браузер делает 20+ parallel fetch. Для очень длинных сессий
  (сотни packets) — рассмотреть pagination или single
  pre-merged blob. Замерить UX на сессии с 100+ packets.
- [ ] rrweb checkoutEveryNms=300s даёт FullSnapshot ~1.2MB
  каждые 5 минут. Длинная сессия (час) = 12 snapshots = 14+ MB
  total download. Приемлемо для MVP, но мониторить.

## Документация
- [ ] DECISIONS.md полная запись за 2026-05-07 (длинный день: 
  ротация secrets, OpenRouter migration, demo cleanup, sites 
  onboarding, ASCII validation).
- [ ] DEPLOY_SETUP.md обновить: lockbox version-id хардкоден в
  `.github/workflows/deploy.yml` (строка `version-id=...`). При
  добавлении новых ключей в Lockbox нужно вручную обновить эту
  переменную в workflow и сделать commit. Решить как
  автоматизировать — например, через GHA secret
  `LOCKBOX_VERSION_ID` обновляемый при каждом изменении Lockbox,
  или через `yc lockbox payload get --latest` при деплое.

## Минор
- [ ] npm audit: vulnerabilities после установки rrweb-player +
  @aws-sdk/s3-request-presigner. Изначально 11 (7 moderate,
  4 high). Проверить — наши пакеты или transitive deps. Скорее
  всего false-positive в dev deps, но запланировать audit fix.
- [ ] Node.js engine warning: `@prisma/streams-local@0.1.2`
  требует bun >=1.3.6 / node >=22.0.0, у нас node 20.20.2.
  Игнорируем (это transitive), но проверить — не используется ли
  где-то.
