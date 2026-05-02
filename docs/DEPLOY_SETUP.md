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
- Domain: `вебмонитор.рф` → Punycode: `xn--c1adqlhcfej.xn--p1ai`

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

## Что ещё будет создано

- DNS-зона `xn--c1adqlhcfej.xn--p1ai` (коммит 2b)
- Lockbox secret `webmonitor-staging-secrets` (коммит 2c)
- Serverless Container `webmonitor-staging` (коммит 2c)
- Let's Encrypt certificate для `staging.xn--c1adqlhcfej.xn--p1ai` (коммит 4)
