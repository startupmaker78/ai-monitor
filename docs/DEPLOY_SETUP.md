# Deploy Setup — Yandex Cloud

> Документация процесса создания инфраструктуры для деплоя Вебмонитора
> в Yandex Cloud Serverless Containers.
>
> Финальное состояние после этапа 3 (CI/CD pipeline live). Используется
> для воспроизведения окружения (создание staging-2 / prod в будущем)
> или для аудита прав.

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

### github-actions-sa (CI/CD)

- ID: `ajek4rhn7uhdpoolkeku`
- Назначение: CI/CD из GitHub Actions

**Роли на folder production (6):**

- `editor` — **PRIMITIVE, КРИТИЧНАЯ.** Без неё DeployRevision возвращает
  PERMISSION_DENIED. Implicit permission, не покрываемый никакими
  service-specific ролями. См. Gotchas.
- `container-registry.images.pusher` — push образов в Container Registry
- `serverless.containers.admin` (через ТОЧКУ) — service-specific, kept after
  debug. Возможно избыточна с editor — minimization is future work.
- `serverless-containers.admin` (через ДЕФИС) — service-specific, kept after
  debug. См. gotcha про два namespace.
- `iam.serviceAccounts.user` — folder-level разрешение использовать SA как
  identity (но недостаточно — см. дополнительные binding'и).
- `lockbox.viewer` — read metadata of secrets для validate revision-secrets.

**Дополнительные binding'и (на конкретные ресурсы):**

- `iam.serviceAccounts.user` → ON runtime-SA `aje8vk01bgb0ij6rfgan`
  — explicit binding для использования runtime-SA как identity revision.
  Folder-level binding оказался недостаточен.
- `iam.serviceAccounts.tokenCreator` → ON runtime-SA `aje8vk01bgb0ij6rfgan`
  — kept after debug, may not be required.
- `lockbox.payloadViewer` → ON secret `e6q7u31vmglihgr4658s`
  — kept after debug, may not be required (CI-SA по идее должен иметь только
  metadata access; payload access нужен только runtime-SA).

### webmonitor-runtime-sa (Runtime)

- ID: `aje8vk01bgb0ij6rfgan`
- Назначение: identity для Serverless Container revision

**Роли на folder production (3):**

- `lockbox.payloadViewer` — runtime читает значения секретов из Lockbox
  и подставляет в env-переменные контейнера.
- `storage.editor` — runtime пишет/читает Object Storage
  (rrweb-сессии, tracker.js).
- `container-registry.images.puller` — runtime pull-ит образ из Container
  Registry при старте revision. **Без этой роли DeployRevision проходит,
  но revision не может стартовать — Yandex проверяет это server-side.**

### webmonitor-storage-sa (предсуществующий, с этапа 0.a)

- ID: `ajegj2633ojqf2iggh1r`
- Назначение: Object Storage клиент в локальной dev-среде (`scripts/test-connections.ts`)

## Authentication: WIF → JSON-credentials

Изначально планировалось использовать **Workload Identity Federation (WIF)**
для keyless authentication GitHub Actions → Yandex Cloud (без long-lived
credentials в репо).

WIF работает корректно для read операций (Lockbox List/Get,
ContainerService/Get) и image push в Container Registry, но **систематически
возвращает PERMISSION_DENIED на ContainerService/DeployRevision** вне
зависимости от ролей CI-SA. Возможно ограничение реализации WIF в Yandex
Cloud для serverless-containers v1 mutate API. Не документировано.

После 7 итераций debug было принято решение использовать **JSON-credentials
SA как working pattern**.

**Текущее состояние:**

- SA authorized key ID: `ajep6mvaugdof1577h0n` (создан для github-actions-sa)
- GitHub Secret: `YC_SA_JSON_CREDENTIALS` (хранит JSON-key SA)

**WIF infrastructure сохранена для возможного возврата в будущем:**

- Federation: `github-actions-federation` (id: `aje35kcl9vlfglua5kj8`)
- Federated Credential: `ajetr75l15urgm3t82lt`
- Subject: `repo:startupmaker78/ai-monitor:ref:refs/heads/main`

**Ротация ключа SA (раз в 90 дней рекомендуется):**

```
yc iam key delete <old-key-id>
yc iam key create --service-account-id ajek4rhn7uhdpoolkeku \
  --output /tmp/new-key.json
gh secret set YC_SA_JSON_CREDENTIALS \
  --repo startupmaker78/ai-monitor < /tmp/new-key.json
rm -f /tmp/new-key.json
```

## DNS

### Yandex DNS Zone

- Name: `webmonitor-rf`
- ID: `dnsa0s229tdrk67c0kga`
- Domain (Punycode): `xn--90abjntggcss.xn--p1ai.`
- Domain (Cyrillic): `вебмонитор.рф.`
- Visibility: public

### Punycode преобразование

Кириллические домены передаются в DNS системе только в ASCII-форме
через стандарт Punycode. Преобразование одностороннее:

```
вебмонитор.рф → xn--90abjntggcss.xn--p1ai
```

Везде где речь о DNS-записях, теге script src, URL в коде, конфиге
Resend — используем Punycode. В UI и текстах — кириллицу.

Команда для проверки преобразования:

```
node -e "console.log(require('punycode').toASCII('вебмонитор.рф'))"
```

### NS-серверы Yandex (для регистратора REG.RU)

Yandex Cloud DNS использует общий пул NS для всех публичных зон:

```
ns1.yandexcloud.net.
ns2.yandexcloud.net.
```

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

```
dig +short NS xn--90abjntggcss.xn--p1ai
```

Должен вернуть NS-серверы Yandex (ns*.yandexcloud.net), не REG.RU.

## Lockbox Secret

- Name: `webmonitor-staging-secrets`
- ID: `e6q7u31vmglihgr4658s`
- Current version ID: `e6q680j6arhj54teabec`
- Description: Runtime secrets for webmonitor-staging Serverless Container

**Access bindings:**

- `webmonitor-runtime-sa` (`aje8vk01bgb0ij6rfgan`): `lockbox.payloadViewer`
- `github-actions-sa` (`ajek4rhn7uhdpoolkeku`): `lockbox.payloadViewer`
  (kept after debug, see github-actions-sa секцию)

**Payload keys (16):** DATABASE_URL, AUTH_SECRET, AUTH_URL, YOS_BUCKET_NAME,
YOS_ENDPOINT, YOS_REGION, YOS_ACCESS_KEY_ID, YOS_SECRET_ACCESS_KEY,
YOS_PUBLIC_URL, ANTHROPIC_API_KEY, METRIKA_CLIENT_ID, METRIKA_CLIENT_SECRET,
YOOKASSA_SHOP_ID, YOOKASSA_SECRET_KEY, RESEND_API_KEY, IP_HASH_SALT

⚠️ `SHADOW_DATABASE_URL` не залит — он только для локальных миграций.

⚠️ Ключи которые имеют значение `__NOT_SET__` (placeholder, явно нерабочий
— никакая API-валидация его не примет):

- `ANTHROPIC_API_KEY` (заполнить на этапе 6 — AI-анализ)
- `METRIKA_CLIENT_ID`, `METRIKA_CLIENT_SECRET` (этап 5 — Метрика)
- `YOOKASSA_SHOP_ID`, `YOOKASSA_SECRET_KEY` (этап 10 — платежи)
- `RESEND_API_KEY` (этап 11 — email)
- `YOS_PUBLIC_URL` (этап 4 — трекинг-скрипт)

**При добавлении реального значения:**

```
yc lockbox secret add-version <secret-id> \
  --payload '[{"key": "<KEY>", "text_value": "<value>"}]'
```

⚠️ ВАЖНО: `add-version` **полностью заменяет** payload, поэтому при подмене
одного ключа надо передать ВСЕ ключи — иначе остальные потеряются.
Альтернатива: заранее `yc lockbox secret get` → собрать полный payload
→ подменить нужный ключ → передать всё.

## Serverless Container

- Name: `webmonitor-staging`
- ID: `bbarn8gnskqll4cjnkhm`
- Description: Webmonitor staging environment (frontend + API)
- Default URL: `https://bbarn8gnskqll4cjnkhm.containers.yandexcloud.net/`

**Access bindings:**

- `system:allUsers`: `serverless.containers.invoker` — public access
  (контейнер доступен всем без auth-headers).

**Revisions:** создаются автоматически из GitHub Actions при push в main.

## CI/CD Pipeline

GitHub Actions workflow: [.github/workflows/deploy.yml](../.github/workflows/deploy.yml)

**Триггеры:** push в main + workflow_dispatch (manual).

**Шаги:**

1. Checkout
2. Install yc CLI + auth via JSON-key из `YC_SA_JSON_CREDENTIALS`
3. Configure Docker auth via `yc container registry configure-docker`
4. Build and push Docker image (linux/amd64, GHA cache)
5. Deploy revision via `yc serverless container revision deploy` (прямой CLI)
6. Smoke test: /api/health, /, /login, /signup

**Почему yc CLI напрямую, а не yc-actions wrappers:** yc-actions/yc-sls-container-deploy@v4
вызывает дополнительные API endpoints в pre-flight, на которые наш CI-SA
получал PERMISSION_DENIED без объяснений. Прямой CLI делает только то что
мы указываем — даёт лучшую диагностику и работает с минимальным набором ролей.

## Manual Deploy (fallback)

Если CI сломан — деплой можно сделать вручную с локальной машины
(требуется `yc init` под owner-credentials):

```bash
LAST_SHA=$(git log -1 --format=%H)
IMAGE="cr.yandex/crps6cjjiemm3isfdt50/webmonitor:$LAST_SHA-manual"

# Сборка amd64 image (требуется docker buildx)
docker buildx build --platform linux/amd64 -t "$IMAGE" --push .

# Deploy revision со всеми 16 секретами
SECRET_ARGS=""
for k in DATABASE_URL AUTH_SECRET AUTH_URL YOS_BUCKET_NAME YOS_ENDPOINT \
         YOS_REGION YOS_ACCESS_KEY_ID YOS_SECRET_ACCESS_KEY YOS_PUBLIC_URL \
         ANTHROPIC_API_KEY METRIKA_CLIENT_ID METRIKA_CLIENT_SECRET \
         YOOKASSA_SHOP_ID YOOKASSA_SECRET_KEY RESEND_API_KEY IP_HASH_SALT; do
  SECRET_ARGS="$SECRET_ARGS --secret id=e6q7u31vmglihgr4658s,key=$k,environment-variable=$k"
done

eval yc serverless container revision deploy \
  --container-name webmonitor-staging \
  --image "$IMAGE" \
  --cores 1 --memory 512MB --core-fraction 100 --concurrency 8 \
  --execution-timeout 30s \
  --service-account-id aje8vk01bgb0ij6rfgan \
  $SECRET_ARGS
```

## Что ещё будет создано

- Let's Encrypt certificate для `staging.xn--90abjntggcss.xn--p1ai`
  и привязка домена к контейнеру (этап 3 коммит 4, после пропагации NS).

## Gotchas (критичные находки, НЕ В документации Yandex)

> Эти gotchas найдены опытным путём за этап 3 (~7 итераций debug).
> Future setup recreations should reference this document FIRST.

### DeployRevision требует primitive role `editor`

Чисто service-specific роли (`serverless.containers.admin`,
`serverless-containers.admin`) **НЕ дают достаточно permissions** для
`ContainerService/DeployRevision`. Без primitive роли `editor`
(или `resource-manager.clouds.owner` у владельца аккаунта) —
PERMISSION_DENIED, без указания какого permission не хватает.

Не документировано Yandex. Reference: 7 итераций debug в этом проекте,
финальный fix — добавление `editor` на folder для CI-SA.

### Два namespace для serverless-containers IAM ролей

Роли существуют в двух параллельных namespace:

- `serverless.containers.*` (через ТОЧКУ): editor, viewer, invoker, admin
- `serverless-containers.*` (через ДЕФИС): editor, viewer, containerInvoker,
  auditor, admin

Yandex принимает обе формы при `add-access-binding` без ошибки. README
yc-actions использует ДЕФИС — это **НЕ typo**, обе формы легитимные.
По нашему опыту, для DeployRevision важна primitive роль `editor`,
а не service-specific.

### WIF не работает для serverless-containers mutate API

WIF-tokens успешно используются для read endpoints, но mutate
(DeployRevision) систематически отвергается. Не документировано как known
limitation. Workaround: SA authorized key вместо WIF.

### Punycode всегда проверять через node, не из памяти

```
вебмонитор.рф → xn--90abjntggcss.xn--p1ai
```

(НЕ `xn--c1adqlhcfej` — это была ошибка из памяти, обнаружена в коммите 2b.)

### Lockbox add-version полностью заменяет payload

При обновлении одного ключа — передавать ВСЕ ключи, иначе остальные
удалятся.

### Lockbox empty values запрещены

`text_value: ""` отвергается с `InvalidArgument: empty`. Workaround:
placeholder вроде `__NOT_SET__` (явно нерабочий, не пройдёт валидацию
никакого API).

### yc CLI 1.6.0 quirks

- WIF команды через ПРОБЕЛ: `yc iam workload-identity oidc federation create`,
  не `oidc-federation` (через дефис).
- `--format value(id)` не поддерживается. Используй `--format json | jq -r '.id'`
  или визуально извлекай.

### Dockerfile для serverless containers НЕ хардкодить PORT

`ENV PORT=3000` в Dockerfile блокирует привязку к Yandex container daemon
(который ожидает приложение на `$PORT`, default 8080). Симптом: Yandex
**возвращает PERMISSION_DENIED на DeployRevision** вместо более ясной
ошибки про порт. Server-side pre-flight проверяет что контейнер
способен стартовать.

**Best practice:** в Dockerfile НЕ ставить `ENV PORT`. Next.js standalone
`server.js` автоматически читает `$PORT` из env. Yandex Serverless передаст
правильный PORT (8080) при запуске revision.

### Cross-platform Docker build на Apple Silicon

Yandex Serverless Containers требуют linux/amd64. Apple Silicon (arm64)
по умолчанию билдит arm64-образы. Для cross-build нужен `docker buildx`:

```
brew install docker-buildx
mkdir -p ~/.docker/cli-plugins
ln -sfn $(brew --prefix)/opt/docker-buildx/bin/docker-buildx ~/.docker/cli-plugins/
docker buildx create --name builder --use --bootstrap
docker buildx build --platform linux/amd64 -t IMAGE --push .
```

В CI это не проблема — GitHub Actions ubuntu-latest нативно amd64.
