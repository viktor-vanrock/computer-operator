# UI-Agent Arena

Интерактивная платформа-демо для Computer Use Operator (Sber AI).  
Человек соревнуется с ИИ-агентом в выполнении UI-задач. Сравнение по скорости и эффективности.

## Стек

| Слой | Технологии |
|------|-----------|
| Frontend | React 19, Vite 6, TypeScript 5.8, Radix UI, TanStack Query v5, Zustand 5, React Router v7 |
| Backend | Fastify v5, TypeScript 5.8, Zod v4, Prisma v6, PostgreSQL 16 |
| Real-time | WebSocket (`@fastify/websocket`) |
| Метрики | Prometheus (`fastify-metrics`, `prom-client`) |
| Тесты | Vitest (frontend + backend) |
| Инфра | Docker Compose, npm workspaces |

## Структура проекта

```
apps/
  frontend/       — Vite + React SPA (порт 5173)
  backend/        — Fastify API + WebSocket (порт 3001)
docker-compose.yml
```

## Быстрый старт

### 1. Переменные окружения

Создайте `apps/backend/.env` на основе `.env.example`:

```env
DATABASE_URL=postgresql://user:password@localhost:5432/dbname
PORT=3001
NODE_ENV=development
AGENT_MANAGER_API_URL=localhost

# Обязательные секреты смысловой модерации
GIGACHAT_AUTHORIZATION_KEY=replace-with-gigachat-authorization-key
TASK_VALIDATION_SECRET=change-me-to-a-random-string-of-at-least-32-chars

# Уровень логирования: fatal | error | warn | info | debug | trace (по умолчанию: info)
LOG_LEVEL=info

# Опционально: токен для аутентификации Prometheus scrape (заголовок Authorization: Bearer)
# METRICS_TOKEN=your-secret-token
```

### 2. Запуск PostgreSQL

```bash
npm run docker:up
```

### 3. Установка зависимостей

```bash
npm install
```

### 4. Инициализация БД

```bash
npm run db:push --workspace=apps/backend
npm run db:seed --workspace=apps/backend
```

### 5. Запуск в dev-режиме

```bash
npm run dev
```

Frontend: http://localhost:5173  
Backend: http://localhost:3001

## Скрипты

| Команда | Описание |
|---------|----------|
| `npm run dev` | Запуск frontend + backend параллельно |
| `npm run build` | Production build всего монорепо |
| `npm run lint` | ESLint по всему монорепо |
| `npm run typecheck` | Проверка типов (tsc --noEmit) |
| `npm run test` | Тестирование (Vitest, frontend + backend) |
| `npm run docker:up` | Поднять PostgreSQL |
| `npm run docker:down` | Остановить PostgreSQL |
| `npm run db:push` | Применить Prisma schema к БД |
| `npm run db:seed` | Загрузить тестовые данные |
| `npm run db:studio` | Prisma Studio (GUI для БД) |
| `npm run db:generate` | Сгенерировать Prisma Client |

## Тесты

```bash
# Все тесты (Vitest)
npm run test

# Только backend
npm run test --workspace=apps/backend

# Только frontend
npm run test --workspace=apps/frontend

# С покрытием
npm run test:coverage --workspace=apps/backend
```

## API

| Метод | Путь | Описание |
|-------|------|----------|
| GET | `/health` | Liveness + Readiness probe |
| GET | `/metrics` | Метрики Prometheus (только localhost или `Authorization: Bearer`) |
| GET | `/tasks` | Список preset-задач |
| GET | `/tasks/:id` | Получить задачу по ID |
| POST | `/tasks` | Создать задачу |
| POST | `/tasks/random` | Получить случайную preset-задачу |
| POST | `/sessions` | Создать сессию |
| GET | `/sessions/:id` | Получить сессию |
| PATCH | `/sessions/:id` | Обновить статус / метрики |
| POST | `/sessions/:id/start` | Запустить агента |
| POST | `/sessions/:id/stop` | Остановить агента |
| WS | `/ws/session/:id` | Real-time события арены |

## Экраны

```
/ (Landing) → /tasks (Выбор задачи) → /arena/:sessionId (Арена) → /results (Результаты)
```

## Разработка

- **Схемы** — Zod в `apps/backend/src/modules/*/`, источник правды для API
- **Типы фронтенда** — TypeScript-интерфейсы в `apps/frontend/src/types/`
- **WS-валидация** — `apps/frontend/src/lib/ws-event.schema.ts`
- **Стилизация** — CSS Modules + CSS-переменные (Sber design tokens)
- **Иконки** — `@phosphor-icons/react` (вес `thin`)
# Task moderation

Свободные задачи демостенда проходят смысловую модерацию GigaChat через
`POST /moderation/validate`. Успешная проверка возвращает короткоживущий
HMAC-токен, который обязателен для анонимных `POST /tasks` и
`POST /sessions/:id/next-task`. Аутентифицированный технический стенд и
административные операции с пресетами обходят модерацию.

Обязательные секреты `GIGACHAT_AUTHORIZATION_KEY` и
`TASK_VALIDATION_SECRET` (не менее 32 символов) должны поступать из Vault.
Профиль пула VM Fleet задаётся через `VMFLEET_PROFILE` (по умолчанию
`reserved_vm`).
Поддерживаются настройки `GIGACHAT_SCOPE`, `GIGACHAT_AUTH_URL`,
`GIGACHAT_API_URL`, `GIGACHAT_MODEL`, `GIGACHAT_TIMEOUT_MS`,
`FREEFORM_TASK_MAX_LENGTH` и `TASK_VALIDATION_TTL_MS`.
Для корпоративного ключа проекта `GIGACHAT_SCOPE` по умолчанию равен
`GIGACHAT_API_CORP`; scope должен соответствовать типу выданного ключа.

Промпты для ручной проверки: [`docs/moderation-smoke-prompts.md`](docs/moderation-smoke-prompts.md).
