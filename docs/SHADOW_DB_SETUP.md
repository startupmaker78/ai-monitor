# Shadow Database — настройка на новой машине

Shadow database нужна Prisma при `migrate diff --from-migrations` — Prisma создаёт временную БД, прогоняет в неё все миграции по очереди и сравнивает результат с целевой `schema.prisma`. На Yandex Managed PostgreSQL это не работает (у пользователя БД нет прав на `CREATE DATABASE`), поэтому используем локальный Postgres в Docker.

## Прерёквизиты

- macOS на Apple Silicon (M1/M2/M3) — для других платформ команды Colima будут отличаться
- [Homebrew](https://brew.sh)

## 1. Установка Colima + Docker CLI

```bash
brew install colima docker
```

## 2. Запуск Colima

```bash
colima start
```

После каждого ребута мака — `colima start` нужно запустить заново. Можно автозапустить через `brew services start colima`, но обычно проще руками по необходимости.

## 3. Запуск shadow Postgres

```bash
docker run -d --name webmonitor-shadow \
  -e POSTGRES_PASSWORD=shadow \
  -e POSTGRES_DB=webmonitor_shadow \
  -p 5433:5432 \
  postgres:16
```

Контейнер слушает на `localhost:5433`. Порт 5433 выбран намеренно, чтобы не конфликтовать со стандартным 5432.

## 4. Проверка

```bash
docker exec webmonitor-shadow psql -U postgres -d webmonitor_shadow -c '\l'
```

Должен показать список БД, включая `webmonitor_shadow`.

## 5. Env-переменная

В `.env.local` должна быть строка:

```
SHADOW_DATABASE_URL=postgresql://postgres:shadow@localhost:5433/webmonitor_shadow
```

`prisma.config.ts` читает её через `process.env.SHADOW_DATABASE_URL` и передаёт в Prisma как `datasource.shadowDatabaseUrl`.

## Управление контейнером

```bash
# остановить
docker stop webmonitor-shadow

# снова запустить (контейнер уже создан)
docker start webmonitor-shadow

# полностью удалить (если нужно пересоздать с нуля)
docker rm -f webmonitor-shadow
```

## Команда генерации миграции

После того как shadow DB поднята:

```bash
npm run prisma -- migrate diff \
  --from-migrations prisma/migrations \
  --to-schema prisma/schema.prisma \
  --script \
  --output /tmp/migration.sql
```

Дальше — по workflow из `DECISIONS.md` (запись «2026-04-22: Workflow миграций» с поправкой «2026-04-27: Workflow миграций — добавлен shadow DB»).

## Когда shadow DB не нужна

- `prisma migrate deploy` — применяет уже сгенерированные миграции в production-БД, shadow не использует.
- `prisma migrate status` — только читает state, shadow не нужна.
- `prisma generate` — генерация Prisma Client из schema.prisma, БД вообще не трогает.

То есть если ты только применяешь готовые миграции и работаешь с приложением — Colima можно вообще не запускать. Она нужна только при создании новой миграции.
