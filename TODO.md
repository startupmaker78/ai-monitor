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

## Сессия 2026-07-08 (перенос в основные секции по мере разбора)

> **✅ СДЕЛАНО 2026-07-09** — реализовано, но ИНАЧЕ чем описано в этом
> пункте: НЕ через `Content-Encoding: gzip` + `req.text()` (этот
> заголовок ломает тело на YC-proxy — utf8-mangle), а через
> `application/octet-stream` + серверный детект по magic-байтам. См.
> секцию «Сессия 2026-07-09» ниже и DECISIONS 2026-07-09.

**[P1 — завтра] gzip тела снапшота на collect.** FullSnapshot academy.
nolim.cc = ~2.92 MB (93% cap 3 MiB). Изоляция snapshot'а в свой
packet (commit ca5f4e7) спасает СЕГОДНЯ, но при росте контента —
снова 413 от YC-платформы до контейнера. Долгосрочный фикс: gzip.
Скоуп: клиент — `CompressionStream('gzip')` перед fetch/beacon +
`Content-Encoding: gzip` header; collect route — детект по header,
разжатие в `req.text()`, fallback для старого tracker.js без gzip
(backward compat). Побочная выгода: минус трафик клиента + минус
байт в S3 (packet.json сохраняется уже разжатый — оставить как
сейчас, gzip только на transport). См. DECISIONS 2026-07-08 «Трекер
изоляция FullSnapshot».

**[P2] Overshoot sessionsCollected.** Инкремент `sessionsCollected`
в collect транзакции не гейтится статусом цели: при N параллельных
первых packet'ах на почти-полной цели каждый успевает пройти
инкремент через свою transaction, пока auto-transition ACTIVE→READY
срабатывает только у одного (гейт `status="ACTIVE"` в updateMany
защищает переход, но не инкремент). Итог: budget пробивается на
`N-1` сессий выше предела. Улика — target
`cmrbt0a4j00002w3cp4smnhcs`: `6/5`, архивирован для расследования.
Фикс на выбор:
  (а) инкремент через updateMany с `where: {id, status: "ACTIVE"}` —
      concurrent старты после transition пропустятся;
  (б) явная проверка `sessionsCollected < sessionsBudget` перед
      инкрементом внутри той же транзакции — race-safe при row-lock
      на update.
См. DECISIONS 2026-07-08 «Данные: архив overshoot-target».

**[P2] eventsCount не идемпотентен на retry — участилось.** Известно
с DECISIONS 2026-05-03 как acceptable (telemetry-поле, а не billing).
ВНИМАНИЕ: сегодняшний collect retry (commit 533e056, `withDbRetry`
вокруг `$transaction`) ПОВЫСИЛ частоту сценария: разрыв pg-соединения
между `COMMIT` и получением ACK клиентом Prisma → повтор попадает в
SUBSEQUENT-ветку (createMany count=0, session уже создана в БД) и
делает `update({eventsCount: {increment: len}})` поверх уже
установленного в create `eventsCount = len`. Двойной счёт для
этого packet'а. `sessionsCollected` при этом чист (гейт
`isFirstPacket && validatedTargetId`). Косметика в счётчике
дашборда, редкая, но при разборе учесть контекст retry.

**[P2] should-record: переключить на общий `withDbRetry`/
`isTransientDbError` из lib/prisma.ts.** Сейчас там локальный дубль
(~40 строк) — идентичная логика, взятая при выносе в общий helper
1-в-1. Маленький PR, чисто рефакторинг: `import { withDbRetry,
isTransientDbError } from "@/lib/prisma"`, удалить локальные
`TRANSIENT_MARKERS/TRANSIENT_CODES/isTransientDbError/withDbRetry` из
`app/api/tracking/should-record/route.ts`. Оставили дубль сегодня
потому что should-record уже работал — не хотели трогать зелёное.

**[P2] Финализация сессии стала полагаться только на pagehide + cron.**
Побочка фикса 1a (commit ca5f4e7): `handleVisibilityChange` больше не
финализирует (иначе tab-switching убивал сессию до FullSnapshot).
Теперь `endedAt` устанавливается либо через sendBeacon sentinel на
pagehide (ненадёжен: iOS Safari часто отбрасывает), либо через cron
`/api/cron/finalize-stale-sessions`. Проверить надёжность на реальном
трафике: если > X% сессий финализируются только через cron —
рассмотреть beacon-флаш без защёлки `finalSent` (позволить sentinel
уходить несколько раз через жизнь сессии, серверный upsert
идемпотентен). См. DECISIONS 2026-07-08 «Трекер изоляция FullSnapshot»,
пункт 1.

**[перед релизом MVP] Site tracking token e464... мелькал в curl/
логах.** Staging, не критично, но добавляем в общий список ротации
креды перед выходом в prod. Прочие уже известные утечки — см. секцию
«Безопасность» выше.

## Сессия 2026-07-09

- **[DONE] gzip тела пакетов** (client `application/octet-stream` +
  серверный magic-детект `1f8b`). Снял привязку к collect-cap 3 MiB
  навсегда, срезал трафик/S3. Закрывает [P1] из секции 2026-07-08
  (реализовано иначе — НЕ через Content-Encoding, тот ломает тело на
  YC-proxy). Схема, находка про utf8-mangle и урок two-phase deploy —
  см. DECISIONS 2026-07-09 «gzip сжатие тела пакетов».

- **[DONE 2026-07-09] should-record → общий `withDbRetry`** (commit
  `8bc35db`). Убран локальный дубль ~40 строк, используется общий
  `withDbRetry`/`isTransientDbError` из `lib/prisma.ts` (как collect).
- **[DONE 2026-07-09] overshoot sessionsCollected** — атомарный
  conditional increment через raw `UPDATE ... WHERE status='ACTIVE' AND
  sessionsCollected < sessionsBudget` (row-lock Postgres; commit
  `867170f`, revision `bba9uje...`). Параллельные первые пакеты больше
  не пробивают budget (проверено: 2 конкурентных → 2, не 3). См.
  DECISIONS 2026-07-09.
- **[DONE 2026-07-09] eventsCount идемпотентность** — вариант B, таблица
  `SessionPacketReceipt` (составной PK + `INSERT ON CONFLICT`, race-safe;
  commit `0ee9dab`, миграция `20260709224701`, revision `bbabm61m...`).
  Повтор пакета (retry / двойной beacon / гонка) не задваивает счётчик;
  финал-повтор сохраняет endedAt. FK cascade чистит receipts с сессией.
  См. DECISIONS 2026-07-09 «eventsCount идемпотентность».

**Незакрытое:**

> **↪ ПЕРЕНЕСЕНО/ЧАСТИЧНО ЗАКРЫТО 2026-07-12.** Раздутие длительности
> из-за cron исправлено (lastPacketAt, commit 813cd1e). Остаток —
> надёжность pagehide/beacon на реальном mobile — переведён в [watch]
> в секции «Сессия 2026-07-12» ниже.

- **[P2] финализация: `endedAt` только на pagehide + cron** — побочка
  фикса visibilitychange (ca5f4e7, 2026-07-08). `endedAt` ставится либо
  через sendBeacon-sentinel на pagehide (ненадёжен: iOS Safari часто
  отбрасывает), либо через cron `finalize-stale-sessions`. Проверить
  надёжность на реальном трафике; при >X% финализаций только через cron
  — рассмотреть beacon-флаш без защёлки `finalSent`.
- **[минор] buffer.ts: устаревший комментарий** `MAX_BODY_BYTES=3 MiB`
  ([buffer.ts:61](tracker-src/buffer.ts#L61)) — серверная константа
  переименована в `MAX_WIRE_BYTES`. Косметика в комментарии трекера.
- **[минор] изоляция FullSnapshot при gzip технически избыточна** —
  снапшот и так влезает сжатым. НО оставлена **намеренно**: уходит
  немедленно отдельным пакетом, короткие сессии воспроизводимы. Это
  **фича, не долг — НЕ удалять.**
- **[перед релизом MVP] ротация кредов:** site token `e464…` (staging,
  мелькал в curl/логах) — в общий список ротации перед prod. Прочие
  утечки — секция «Безопасность» выше.

## Сессия 2026-07-12

**academy.nolim.cc — БОЕВОЙ** (реальные посетители; согласие собрано,
чувствительных форм нет). Деплой = окно спотыкания записи, регрессии
стоят реальных сессий, ротация кредов актуальнее. См. DECISIONS
2026-07-12 «academy стал БОЕВЫМ».

- **[DONE 2026-07-12] фильтр ботов + чистка старых** — should-record
  отсекает краулеров по User-Agent (`record:false, reason:bot`, до БД);
  защита false-positive (CUBOT-бренд и живые mobile Safari/Chrome
  проходят). Удалено 5 бот-сессий из боевой БД (+3 receipts cascade
  +6 S3-ключей), `sessionsCollected` cmrcbpgcs 15→10. Commit `2f6c23c`,
  revision `bba161ref…`. См. DECISIONS 2026-07-12 «Фильтр ботов».
- **[DONE 2026-07-12] finalize-stale retry** — cron обёрнут в общий
  `withDbRetry`; теперь все 3 PG-роута (collect/should-record/finalize-
  stale) единообразны. Commit `e3a9023`, revision `bbarm258…`.
- **[DONE 2026-07-12] lastPacketAt — раздутие длительности** — cron
  ставит `endedAt = lastPacketAt` (реальная активность), не now-тика.
  Симптом 1 (72м вместо 3м) устранён. TZ-блокер receipts обойдён новым
  UTC-полем `Session.lastPacketAt`. Миграция `20260712231237` (руками,
  БД→код). Commit `813cd1e`, revision `bbaahh5m…`. Доказано
  `endedAt==lastPacketAt≠now`. См. DECISIONS 2026-07-12 «lastPacketAt».
- **[ЗАКРЫТО — ложная тревога] cron 15-часовой gap** — cron тикал 96/96
  за сутки, 0 пропусков; «16.5ч сессия» = clock-skew Googlebot, не gap.
  Backstop надёжен. См. DECISIONS 2026-07-12 «Диагнозы перевёрнуты».
- **[ЗАКРЫТО — ложная тревога] «мобильный снапшот сломан»** — обе
  сессии PRE-fix (старый 413-дроп, уже исправлен изоляцией+gzip);
  desktop той же эпохи ломался идентично; POST-fix desktop 90%. Баг
  эпохи/размера, не устройства.

**Незакрытое (watch / бэклог):**

- **[watch] mobile снапшот POST-fix** — замерить долю type2 на mobile,
  когда накопится органический mobile-трафик (сейчас n=0 post-fix). Если
  <90% как desktop → снапшот ~сотни KB не влезает в 64KB keepalive →
  in-session retry / чанкование. **Не чинить вслепую** — сначала данные.
- **[watch] финализация endedAt (beacon-фикс)** — отложено до
  органического трафика. lastPacketAt починил РАЗДУТИЕ длительности;
  надёжность pagehide/beacon на реальном mobile (сколько сессий
  финализируется только через cron) — замер преждевременен, backstop
  справляется. Заменяет прежний [P2] из секции 2026-07-09.
- **[SECURITY] token-из-URL + ротация e464** (средний приоритет, планово,
  не аврал). Находка 2026-07-13: платформенный access-лог YC пишет
  `GET /should-record?token=<полный>&url=… 200` на КАЖДОМ вызове →
  site-token течёт в логи массово (см. DECISIONS 2026-07-13 «Утечка
  site-token»). Порядок СТРОГИЙ (ротация без фикса бесполезна — новый
  токен снова утечёт):
  - [ ] **фаза 1:** should-record принимает `X-Site-Token` header
    (+ query fallback для старого tracker.js), + `X-Site-Token` в CORS
    `Access-Control-Allow-Headers`. Деплой сервера.
  - [ ] **фаза 2:** трекер шлёт `X-Site-Token` вместо query. Пересбор +
    деплой `tracker.js`.
  - [ ] **фаза 3:** обновить `<script>` на academy (координация с
    владельцем / Tilda), дождаться вымывания кешей старого tracker.js.
  - [ ] **фаза 4:** ротировать `e464` → новый токен (никогда не бывший
    в URL). Старые лог-значения выветрятся за 72ч retention.
  Тяжесть умеренная (write-only токен, retention 72ч, доступ внутренний),
  но до роста трафика academy стоит закрыть.
  - **[связанное]** pageUrl юзера с query течёт в тот же access-лог —
    фикс token-из-URL это НЕ чинит (`url` остаётся в query). Сейчас
    обычно `utm_*` (низкий риск); если query станет чувствительным —
    рассмотреть отправку нормализованного path вместо полного URL.
- **[B, лёгкий] аудит + запись `maskInputOptions` на academy** —
  согласие есть, чувствительных форм нет; задокументировать текущую
  маскировку (password/email/tel/number) как соответствие.
- **[минор] buffer.ts коммент `MAX_BODY_BYTES`**
  ([buffer.ts:61](tracker-src/buffer.ts#L61)) — константа переименована
  в `MAX_WIRE_BYTES`; косметика. *(СДЕЛАНО d77e053.)*
- **[✅ СДЕЛАНО 2026-07-14] Неверный punycode `xn--80aje0afkgi.xn--p1ai`**
  (декодируется в `естрноаж.рф` — мусор, НЕ вебмонитор.рф). Найден
  2026-07-13 при унификации сниппета. Исправлен на проверенный node
  `xn--90abjntggcss.xn--p1ai` в обоих живых местах (claude-client.ts:8,
  site-utils.ts). grep-аудит: только эти 2 живых места + описательные
  упоминания в TODO/DECISIONS (не трогаем — история/трекинг). Места:
  - `lib/claude-client.ts:8` `REFERER_URL` — шлётся как `Referer` к
    Claude/OpenRouter API. Функц. безвредно (Referer не валидируется),
    но неверно.
  - `lib/site-utils.ts:23` — комментарий-пример, вводит в заблуждение.
  Класс бага = **punycode из памяти без проверки node** — ровно
  предупреждение DECISIONS 2026-04-27 «Punycode всегда проверять через
  node». Верный: `xn--90abjntggcss.xn--p1ai` (= вебмонитор.рф, проверено
  node). Фикс: заменить в обоих местах. **ЗАОДНО:** grep-аудит всего
  репо на `xn--80aje0afkgi` — нет ли ещё. Низкий приоритет (Referer не
  критичен), но реальный баг. Запись, не фикс.

## Сессия 2026-07-13

**СРОЧНОЕ (ждёт входных данных):**

- **[🟡 SSL-инцидент academy]** пара посетителей: «небезопасный сайт /
  протух SSL». **Ждём скрины:** КАКОЙ домен в ошибке (наш
  `xn--90abjntggcss` / `academy.nolim.cc` / поддомен), точный текст
  ошибки (ERR_CERT_DATE_INVALID / AUTHORITY_INVALID / mixed content / …),
  браузер+устройство+ОС, и это предупреждение страницы (главный cert)
  или ошибка в консоли/Network (сабресурс). **Наша инфра доставки
  чиста** (cert валиден, цепочка полная leaf+YR2+ISRG Root YR→X1, TLS
  1.2/1.3, mixed content нет; сабресурс не может понизить замок сайта).
  Гипотезы до скринов: (а) cert academy/его поддомена протух — НЕ мы;
  (б) наш скрипт триггерит запрос к кривому поддомену — косвенно мы;
  (в) часы устройства / расширение / mixed content от чужого ресурса /
  HSTS+старый кеш. **Скрипт НЕ снят** (нет оснований). См. DECISIONS
  2026-07-13 «SSL-инцидент academy». По скринам — отработать точно.

**token-фикс — остаток (фазы 1-2 в проде, commit 6ebd0f7):**

- [ ] **фаза 3:** обновить `<script>` на academy → новый формат
  (punycode + `data-token`, без `?token=`) — сотрудник/владелец.
  **СВЯЗАНО с SSL-инцидентом** — при возврате/замене скрипта учесть.
- [ ] **фаза 4:** ротация `e464` — **ОТЛОЖЕНА/опциональна** (причина
  уточнена 2026-07-14: не «immutable-кеш держит бандл год», а «утечка
  уже остановлена + токен write-only малочувствителен + логи истекут за
  72ч → малоценно»). Делать только по сигналу компрометации. См.
  секцию «Сессия 2026-07-14» ниже + DECISIONS 2026-07-14.
- [ ] pageUrl в query should-record → header/тело (низкий приоритет).

**Проактивно (максимально безвредный скрипт):**

- [ ] пересмотреть HSTS `includeSubDomains` на staging-инфре,
  обслуживающей боевой трафик клиента — избыточно агрессивно, оценить
  смягчение.
- [ ] отложенный старт rrweb (load/idle) + `mousemove` 50→100-200ms —
  снизить нагрузку на слабых устройствах (проактивная безвредность).
- [ ] боевой прод-домен для доставки tracker.js вместо staging
  (staging-инфра обслуживает реального клиента — не идеально; +доверие).
  **Разведка 2026-07-14:** инфра ОДНА (staging = только имя), поэтому это
  вопрос ДОМЕНА, не переезда — объём часы (cert+DNS+`add-domain`+`<script>`).
  Apex `вебмонитор.рф` нельзя CNAME → нужен сабдомен (`t.`/`cdn.`).
  SSL-жалобы НЕ решит (тот же Gateway/LE). Приоритет низкий-средний. См.
  DECISIONS 2026-07-14 «Инфра: staging = единственный контур».

**Бэклог:**

- [✅ СДЕЛАНО 2026-07-14] неверный punycode `xn--80aje0afkgi` в
  `claude-client.ts:8` + `site-utils.ts` — исправлен на
  `xn--90abjntggcss.xn--p1ai` (см. выше).
- [watch] mobile-снапшот + pagehide-надёжность — ждут органического
  трафика (n≈0 post-fix).

## Сессия 2026-07-14

- **[ЗАКРЫТО — мнимый техдолг] «immutable-кеш /tracker.js без версии в
  имени».** Опровергнуто данными: tracker.js отдаётся `public, max-age=0`
  + ETag (дефолт Next.js для `/public`, не immutable), ревалидируется
  каждую загрузку (логи: 41×200 + 6×304). **Доставка фиксов трекера уже
  работает** — новый бандл долетает за 1 pageload. `content-hash` / тонкий
  loader / `?v=hash` **НЕ нужны**. Опционально короткий `max-age` (5-10м)
  срезал бы per-load 304 — микро-оптимизация, не приоритет. См. DECISIONS
  2026-07-14 «Кеш /tracker.js: НЕ immutable».
- **[низкий-средний] прод-домен доставки** — разведка сделана (инфра одна,
  объём часы, нужен сабдомен, SSL не решит). Детали — в секции «Проактивно»
  выше + DECISIONS 2026-07-14. Ждёт готовности владельца к смене `<script>`.
- **[опционально] ротация e464** — причина отложить исправлена (малоценно,
  не «immutable»). Только по сигналу компрометации. См. фазу 4 выше.
