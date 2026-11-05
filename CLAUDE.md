# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

**UI-Agent Arena** — интерактивная платформа-демо для Computer Use Operator (Sber AI).
Человек соревнуется с ИИ-агентом в выполнении задач в UI. Сравнение по скорости и эффективности.

## Stack

| Слой | Технологии |
|------|-----------|
| Frontend | React 19, Vite, TypeScript, Radix UI, TanStack Query v5, Zustand, React Router v7 |
| Backend | Fastify v5, TypeScript, Zod v4, Prisma v6, PostgreSQL 16 |
| Real-time | WebSocket (`@fastify/websocket`) |
| Метрики | Prometheus (`fastify-metrics`, `prom-client`) |
| Icons | `@phosphor-icons/react` (вес `thin` основной, `regular` для акцентов) |
| Animation | `framer-motion` |
| Тесты | Vitest (frontend + backend) |
| Infra | Docker Compose (`/`), npm workspaces (monorepo) |

## Monorepo Structure

```
apps/
  frontend-demo/   — Vite + React SPA, демо-стенд (Landing, Task Selection SOLO/SPLIT/COOP, Arena, Results с Leaderboard)
  frontend-tech/   — Vite + React SPA, технический стенд (упрощённый Task Selection, Arena, Results, без анимаций/лидерборда)
  backend/         — Fastify API server, общий для обоих фронтендов
packages/
  ui/              — общий пакет @arena/ui: дизайн-система, атомарные UI-компоненты, типы, API-клиент, ArenaPlayer (Guacamole viewer)
/                  — docker-compose.yml + .env для PostgreSQL
```

Оба фронтенда — независимые деплой-юниты на разных портах/доменах, использующие один backend и общий `@arena/ui`.
Доменная бизнес-логика (SOLO/SPLIT-оркестрация арены, лидерборд, кастомные задания) остаётся в `frontend-demo`; `frontend-tech` пока переиспользует одиночный VM-путь (`mode: 'SOLO'`) без авторизации — это заготовка под будущий Keycloak-стенд.

## Разделение типов

- **Backend** (`src/modules/*/`) — Zod-схемы в каждом модуле (`*.schema.ts`), источник правды для валидации API
- **`packages/ui/src/types/`** — TypeScript-интерфейсы, зеркалят API-контракт, общие для обоих фронтендов
- **`packages/ui/src/lib/ws-event.schema.ts`** — Zod-схема для runtime-валидации WS-событий

## Dev Commands

```bash
npm install                                       # установка зависимостей (в корне)
npm run docker:up                                 # поднять PostgreSQL (в корне)
npm run docker:down                                # остановить PostgreSQL
npm run dev                                       # запуск backend + оба фронтенда параллельно
npm run dev:backend                               # только backend (порт 3001)
npm run dev:demo                                  # только frontend-demo (порт 5173)
npm run dev:tech                                  # только frontend-tech (порт 5174)
npm run db:migrate --workspace=apps/backend       # создать и применить миграцию (dev)
npm run db:push --workspace=apps/backend          # применить schema без миграции (только прототипирование)
npm run db:studio --workspace=apps/backend        # Prisma Studio (GUI для БД)
npm run db:generate --workspace=apps/backend      # сгенерировать Prisma client
npm run build                                     # production build всего monorepo
npm run lint                                      # ESLint по всему monorepo
npm run typecheck                                 # tsc --noEmit по всему monorepo
```

## Screens & Scope

**`frontend-demo`** (`:5173`):
```
/ (Landing) → /tasks (Task Selection) → /arena/:sessionId (Arena) → /arena/:sessionId/results (Результаты)
```

| Экран | Ключевые данные |
|-------|----------------|
| Landing | статика, кнопка Start |
| Task Selection | `GET /tasks`, `POST /sessions` (SOLO/SPLIT) |
| Arena (Solo/Split) | `POST /sessions/:id/start`, `POST /sessions/:id/stop`, WS `/ws/session/:id` |
| Results | итоговые метрики сессии, Leaderboard |

**`frontend-tech`** (`:5174`, без авторизации в текущей итерации):
```
/ (Task Selection) → /arena/:sessionId (Arena) → /arena/:sessionId/results (Результаты)
```

Упрощённый Task Selection (без анимаций), тот же одиночный VM-путь (`mode: 'SOLO'`), без Landing и Leaderboard.

## Backend Architecture

- **Fastify plugins** — каждый домен (`tasks`, `sessions`, `arena`) регистрируется как отдельный plugin через `fastify.register()`
- **Zod + `fastify-type-provider-zod`** — схемы = источник TypeScript-типов; одна схема на input и output
- **Prisma** — единственный способ работы с БД, прямые SQL-запросы не используются
- **WebSocket** — route `/ws/session/:id` для real-time событий арены (смена статуса, мысли агента)
- Все ошибки через глобальный `fastify.setErrorHandler`, envelope: `{ error: { code, message } }`
- **Логгирование** — Pino-синглтон (`src/lib/logger.ts`), child-логгеры в каждом модуле (`{ module: 'name' }`), в dev — pino-pretty с цветами
- **Health check** — `GET /health` (liveness + readiness), проверяет БД через `SELECT 1`
- **Correlation ID** — заголовок `X-Request-ID` прокидывается через все логи и возвращается в ответе (кроме `/metrics`)
- **LOG_LEVEL** — переменная окружения: `fatal | error | warn | info | debug | trace` (по умолчанию `info`)
- **Метрики** — `GET /metrics` в формате Prometheus; доступен только с localhost или по заголовку `Authorization: Bearer` (`METRICS_TOKEN` в env); не логируется, не получает `X-Request-ID`

### Структура src/lib/

```
src/lib/
├── logger.ts            — Pino-синглтон (базовая утилита для всего приложения)
├── config/
│   └── env.ts           — валидация переменных окружения (Zod)
├── db/
│   └── prisma.ts        — Prisma-клиент (синглтон)
├── http/
│   ├── errors.ts        — доменные HTTP-ошибки (HttpError, NotFoundException, …)
│   ├── correlation-id.ts — плагин X-Request-ID
│   └── request-logger.ts — плагин логирования запросов
├── metrics/
│   ├── metrics.ts       — бизнес-метрики Prometheus (Counter, Gauge, Histogram)
│   └── metrics-auth.ts  — плагин защиты /metrics
└── agent/
    └── agent-manager.client.ts — клиент агент-менеджера + MockAgentManagerClient
```

### Session lifecycle

```
PENDING → PREPARING → RUNNING → COMPLETED
                    ↘ FAILED
```

- `PENDING` — сессия создана, агент не запущен
- `PREPARING` — `POST /sessions/:id/start` вызван, ожидаем `streamUrl` от агента (поллинг до 5 мин)
- `RUNNING` — `streamUrl` получен, сессия активна
- `COMPLETED` — `POST /sessions/:id/stop` выполнен успешно
- `FAILED` — таймаут (`STREAM_TIMEOUT`) или ошибка старта (`AGENT_START_FAILED`)

## Frontend Architecture

- **TanStack Query** — весь серверный стейт; никаких `useEffect` для fetch
- **Zustand** — только локальный UI-стейт (метрики таймера, статус арены), используется в `frontend-demo` для SPLIT-оркестрации
- **Radix UI** — accessible-компоненты, стилизуются через CSS Modules поверх
- **React Router** — навигация между экранами, у каждого приложения свой набор роутов
- `packages/ui/src/ui/` — атомарные компоненты без бизнес-логики (Header, AppLayout, TaskTextarea, ArenaPlayer/Guacamole viewer), импортируются через алиас `@arena/ui/*`; `features/` в каждом приложении — умные, знают о домене
- Общий код (`packages/ui`) не собирается отдельно — потребляется напрямую через `paths` в `tsconfig.json` каждого приложения (`@arena/ui/*` → `packages/ui/src/*`)

## Design System

Взят из корпоративного проекта Sber. CSS-переменные подключаются через `tokens.css` → `theme.css`.
Стилизация — CSS Modules + CSS-переменные.

### Шрифты
```css
--font-display: 'SB Sans Display', -apple-system, sans-serif;  /* заголовки */
--font-text:    'SB Sans Text', -apple-system, sans-serif;      /* основной текст */
--font-mono:    'JetBrains Mono', 'SF Mono', monospace;         /* код/метрики */
```

### Ключевые цвета
```css
--color-primary-500: #21a038;   /* Sber Green — Agent */
--color-human: #1482d8; /* Sber Blue — Human */
--color-accent-500: #00bcd4;    /* Teal — акценты */
--gradient-primary: linear-gradient(135deg, #21a038 0%, #00bcd4 100%);
--gradient-hero:    linear-gradient(135deg, #0f4a1a 0%, #21a038 50%, #00a5bb 100%);
```

### Семантические токены (светлая/тёмная тема через `[data-theme='dark']`)
```css
--bg-primary / --bg-secondary / --bg-tertiary / --bg-elevated
--text-primary / --text-secondary / --text-muted
--border-primary / --border-secondary / --border-focus
--shadow-card / --shadow-card-hover / --shadow-button
```

### Радиусы, тени, отступы
```css
--radius-card: 20px;   --radius-button: 12px;  --radius-modal: 24px;
--space-{1..32}        /* 0.25rem шаг */
--shadow-sm/md/lg/xl
--ease-spring: cubic-bezier(0.34, 1.56, 0.64, 1);
--duration-normal: 150ms;  --duration-slow: 300ms;
```

## Code Conventions
- Файлы >500 строк разбиваются на компоненты/сервисы
- Entity-файлы: `product-item.entity.ts`, класс `ProductItemEntity`
- JSX с несколькими пропсами → обязательный `interface Props`
- `eslint-disable` — только с явного разрешения, всегда предлагать альтернативу
- Все аргументы и возвращаемые типы API/WS методов — typed + Zod-валидация; `any`/`unknown` запрещены

## Database Schema (Prisma, key models)

```
Task           — id, title, difficulty(1-5), estimatedHumanTime, isPreset
Session        — id, taskId, mode(SOLO|SPLIT), status(PENDING|PREPARING|RUNNING|COMPLETED|FAILED), difficulty, streamUrl
SessionMetrics — sessionId, participant(HUMAN|AGENT), time, steps, clicks, errors, retries
Score          — id, humanTotal, agentTotal, updatedAt
```

## Agent skills

### Domain docs

Single-context: корневые `CONTEXT.md` + `docs/adr/`. См. `docs/agents/domain.md`.

## Workflow

Новая сущность, смена жизненного цикла или новая граница между модулями/пакетами — архитектурное решение, не разовая правка: `domain-modeling` → `codebase-design` → `grilling` (гейт) → `writing-plans` → `tdd` → `verification-before-completion` → `code-review` → `finish-branch` → `writing-for-agents`. Однострочный фикс без таких последствий — короче: `grilling` → `tdd` → `verification-before-completion` → `code-review`.

Все импорты вида ../ замени на алиас @ (внутри своего приложения) или @arena/ui (для общего кода из packages/ui)

Always follow SOLID and KISS and DRY principles
Clean up unused code
If task is unclear ask clarifying questions
Follow best practices and design patterns appropriate for the language, framework and project
Prioritize clean, efficient and maintainable code
Always answer in russian language
don't look inside .env file