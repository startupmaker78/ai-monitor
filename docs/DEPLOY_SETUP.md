# Deploy Setup — Yandex Cloud

> Документация процесса создания инфраструктуры для деплоя Вебмонитора
> в Yandex Cloud Serverless Containers.
>
> Генерируется один раз. Используется для воспроизведения окружения
> (например, для создания второго staging) или для аудита прав.

## Заметки по yc CLI (gotchas)

> Эти gotchas найдены опытным путём при настройке. Сохраняем чтобы
> при пересоздании окружения через год не споткнуться.

- Команда WIF: правильная форма — `yc iam workload-identity oidc federation create`
  (через ПРОБЕЛ между `oidc` и `federation`). Вариант `oidc-federation` через дефис,
  который встречается в части документации, в yc CLI 1.6 не работает.
- `--format value(id)` не поддерживается. Используй `--format json | jq -r '.id'`
  или просто визуально извлекай из вывода.

## Окружение

- Cloud: `webmonitor` (id: `b1g9kfq92s3sivmv08gq`)
- Folder: `production` (id: `b1gldbqt279ed94nrnpt`)
- Default zone: `ru-central1-a`
- Domain: `вебмонитор.рф` → Punycode: `xn--90abjntggcss.xn--p1ai`

## Container Registry

- Name: `webmonitor`
- ID: `crps6cjjiemm3isfdt50`
- Full path: `cr.yandex/crps6cjjiemm3isfdt50/`

## Service Accounts

### github-actions-sa
- ID: `ajek4rhn7uhdpoolkeku`
- Назначение: CI/CD из GitHub Actions
- Роли (на folder production):
  - container-registry.images.pusher
  - serverless.containers.editor
  - iam.serviceAccounts.user
  - lockbox.viewer (read metadata of secrets — needed by yc-sls-container-deploy
    to validate revision-secrets format. Does NOT grant access to secret values
    — это `lockbox.payloadViewer`, который выдан только runtime-sa.)

### webmonitor-runtime-sa
- ID: `aje8vk01bgb0ij6rfgan`
- Назначение: Runtime Serverless Container
- Роли (на folder production):
  - lockbox.payloadViewer
  - storage.editor

### webmonitor-storage-sa (предсуществующий, с этапа 0.a)
- ID: `ajegj2633ojqf2iggh1r`
- Назначение: Object Storage клиент в локальной dev-среде

## Workload Identity Federation

- Federation: `github-actions-federation`
- Federation ID: `aje35kcl9vlfglua5kj8`
- Issuer: `https://token.actions.githubusercontent.com`
- Audience: `https://github.com/startupmaker78`
- JWKS URL: `https://token.actions.githubusercontent.com/.well-known/jwks`
- Federated Credential:
  - ID: `ajetr75l15urgm3t82lt`
  - Subject: `repo:startupmaker78/ai-monitor:ref:refs/heads/main`
  - Linked SA: `github-actions-sa` (`ajek4rhn7uhdpoolkeku`)

## DNS

### Yandex DNS Zone

- Name: webmonitor-rf
- ID: dnsa0s229tdrk67c0kga
- Domain (Punycode): xn--90abjntggcss.xn--p1ai.
- Domain (Cyrillic): вебмонитор.рф.
- Visibility: public

### Punycode преобразование

Кириллические домены передаются в DNS системе только в ASCII-форме
через стандарт Punycode. Преобразование одностороннее:

вебмонитор.рф → xn--90abjntggcss.xn--p1ai

Везде где речь о DNS-записях, теге script src, URL в коде, конфиге
Resend — используем Punycode. В UI и текстах — кириллицу.

Команда для проверки преобразования:

  node -e "console.log(require('punycode').toASCII('вебмонитор.рф'))"

ВАЖНО: всегда проверяй Punycode через эту команду перед созданием
DNS-ресурсов. Stale значения из памяти/документации — частая причина
багов.

### NS-серверы Yandex (для регистратора REG.RU)

Yandex Cloud DNS использует общий пул NS для всех публичных зон:

  ns1.yandexcloud.net.
  ns2.yandexcloud.net.

### Делегирование домена в REG.RU (ручной шаг)

После смены NS в REG.RU пропагация занимает 24-48 часов.
Этот шаг выполняется ОДИН РАЗ при первичной настройке.

1. Зайти в личный кабинет REG.RU: https://www.reg.ru/user/account/
2. Открыть управление доменом вебмонитор.рф
3. Найти раздел "DNS-серверы" / "Управление DNS / именными серверами"
4. Выбрать опцию "Использовать собственные DNS-серверы"
5. Ввести NS-серверы Yandex из секции выше
6. Сохранить изменения

Проверка пропагации (через сутки после смены NS):

  dig +short NS xn--90abjntggcss.xn--p1ai

Должен вернуть NS-серверы Yandex (ns*.yandexcloud.net), не REG.RU.

## Lockbox Secret

- Name: `webmonitor-staging-secrets`
- ID: `e6q7u31vmglihgr4658s`
- Current version ID: `e6q680j6arhj54teabec`
- Description: Runtime secrets for webmonitor-staging Serverless Container
- Access: webmonitor-runtime-sa (`aje8vk01bgb0ij6rfgan`), role `lockbox.payloadViewer`
- Payload keys (16): DATABASE_URL, AUTH_SECRET, AUTH_URL, YOS_BUCKET_NAME,
  YOS_ENDPOINT, YOS_REGION, YOS_ACCESS_KEY_ID, YOS_SECRET_ACCESS_KEY,
  YOS_PUBLIC_URL, ANTHROPIC_API_KEY, METRIKA_CLIENT_ID,
  METRIKA_CLIENT_SECRET, YOOKASSA_SHOP_ID, YOOKASSA_SECRET_KEY,
  RESEND_API_KEY, IP_HASH_SALT

⚠️ `SHADOW_DATABASE_URL` не залит — он только для локальных миграций.

⚠️ Ключи которые сейчас имеют значение `__NOT_SET__` (placeholder, явно
нерабочий — никакая API-валидация его не примет):

- `ANTHROPIC_API_KEY` (заполнить когда дойдём до этапа 6 — AI-анализ)
- `METRIKA_CLIENT_ID`, `METRIKA_CLIENT_SECRET` (этап 5 — Метрика)
- `YOOKASSA_SHOP_ID`, `YOOKASSA_SECRET_KEY` (этап 10 — платежи)
- `RESEND_API_KEY` (этап 11 — email)
- `YOS_PUBLIC_URL` (этап 4 — трекинг-скрипт)

При добавлении реального значения:

  yc lockbox secret add-version <secret-id> \
    --payload '[{"key": "<KEY>", "text_value": "<value>"}]'

(yc создаст новую версию секрета. ВАЖНО: add-version полностью заменяет
payload, поэтому при подмене одного ключа надо передать ВСЕ ключи —
иначе остальные потеряются. Альтернатива: заранее `yc lockbox secret
get` → собрать полный payload → подменить нужный ключ → передать всё.)

## Serverless Container

- Name: `webmonitor-staging`
- ID: `bbarn8gnskqll4cjnkhm`
- Description: Webmonitor staging environment (frontend + API)
- Default URL: `https://bbarn8gnskqll4cjnkhm.containers.yandexcloud.net/`
- Revisions: пусто (создаст GitHub Actions в коммите 3)

## Что ещё будет создано

- Let's Encrypt certificate для `staging.xn--90abjntggcss.xn--p1ai` (коммит 4)
