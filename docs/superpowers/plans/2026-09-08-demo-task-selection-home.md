# Demo Task Selection Home Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Сделать выбор заданий главной страницей demo-стенда, упростить интерфейс выбора, увеличить только demo-таймаут экрана до минуты и скрыть сложность в требуемых UI.

**Architecture:** Маршрутизация и task-selection меняются внутри `frontend-demo`. Общий Header получает demo-вариант отображения, а общий таймаут готовности экрана и backend-сторож увеличиваются до минуты для всех стендов. В task-management сложность остаётся частью модели и payload, но скрывается из UI.

**Tech Stack:** React 19, TypeScript, React Router v7, CSS Modules, Vitest, Testing Library.

**Spec:** Одобренное пользователем ТЗ в диалоге от 2026-09-08.

## Global Constraints

- Все изменения навигации, выбора кейсов и минутного таймаута относятся только к `frontend-demo`.
- `frontend-tech` сохраняет текущий header; минутный экранный таймаут применяется ко всем стендам, а в task-management скрывается только UI сложности.
- API, Prisma, импорт/экспорт и поле `difficulty` не изменяются.
- Для preset-сессии передаётся `task.difficulty`; custom task создаётся с `difficulty: 3`, сессия — с `difficulty: 1`.
- Использовать существующие CSS-токены и импорты через `@` / `@arena/ui`.

---

### Task 1: Главный маршрут и минимальный demo-header

**Files:**
- Modify: `apps/frontend-demo/src/App.tsx`
- Modify: `apps/frontend-demo/src/constants/routes.ts`
- Modify: `packages/ui/src/ui/layout/app-layout.tsx`
- Modify: `packages/ui/src/ui/header/header.types.ts`
- Modify: `packages/ui/src/ui/header/index.tsx`
- Modify: `packages/ui/src/ui/header/header.module.css`
- Test: `apps/frontend-demo/src/test/app-routing.test.tsx`

**Interfaces:**
- Produces: `HeaderProps.variant?: 'default' | 'minimal'`, `AppLayout` passthrough `headerVariant?: 'default' | 'minimal'`.

- [ ] Написать тесты: `/` показывает TaskSelection, `/tasks` перенаправляет на `/`, в demo-header нет navigation.
- [ ] Запустить тесты и подтвердить ожидаемый RED.
- [ ] Обновить маршруты и добавить минимальный вариант Header без backdrop.
- [ ] Запустить тесты и подтвердить GREEN.

### Task 2: Все опубликованные кейсы без сложности и случайного выбора

**Files:**
- Modify: `apps/frontend-demo/src/features/task-selection/index.tsx`
- Modify: `apps/frontend-demo/src/features/task-selection/use-task-selection.ts`
- Modify: `apps/frontend-demo/src/features/task-selection/task-selection.types.ts`
- Modify: `apps/frontend-demo/src/features/task-selection/task-selection.module.css`
- Modify: `apps/frontend-demo/src/features/task-selection/components/index.ts`
- Delete: `apps/frontend-demo/src/features/task-selection/components/DifficultySelector/index.tsx`
- Delete: `apps/frontend-demo/src/features/task-selection/components/DifficultySelector/difficulty-selector.module.css`
- Delete: `apps/frontend-demo/src/features/task-selection/components/GenerateBlock/index.tsx`
- Delete: `apps/frontend-demo/src/features/task-selection/components/GenerateBlock/generate-block.module.css`
- Test: `apps/frontend-demo/src/test/use-task-selection.test.ts`
- Test: `apps/frontend-demo/src/test/task-selection-page.test.tsx`

**Interfaces:**
- Produces: `useTaskSelection()` без `difficulty`, `setDifficulty`, `handleGenerate`; preset difficulty берётся из selected task.

- [ ] Написать/обновить тесты вывода всех API-кейсов, отсутствия random/difficulty UI и payload сложностей.
- [ ] Запустить тесты и подтвердить ожидаемый RED.
- [ ] Удалить UI и состояние фильтра/рандома, отрисовать `tasks` напрямую.
- [ ] Запустить тесты и подтвердить GREEN.

### Task 3: Явные выбранное и disabled-состояния

**Files:**
- Modify: `apps/frontend-demo/src/features/task-selection/components/TaskCard/index.tsx`
- Modify: `apps/frontend-demo/src/features/task-selection/components/TaskCard/task-card.module.css`
- Modify: `apps/frontend-demo/src/features/task-selection/components/CustomTaskForm/index.tsx`
- Modify: `apps/frontend-demo/src/features/task-selection/components/CustomTaskForm/custom-task-form.module.css`
- Modify: `packages/ui/src/ui/task-textarea/task-textarea.module.css`
- Test: `apps/frontend-demo/src/test/task-card.test.tsx`
- Test: `apps/frontend-demo/src/test/custom-task-form.test.tsx`

**Interfaces:**
- Consumes: существующие `TaskCard.selected`, `TaskTextarea.disabled`.

- [ ] Написать тесты индикатора «Выбрано», `aria-pressed`, disabled-поля, пояснения и возврата к custom input.
- [ ] Запустить тесты и подтвердить ожидаемый RED.
- [ ] Реализовать семантику и CSS-состояния.
- [ ] Запустить тесты и подтвердить GREEN.

### Task 4: Минутный demo-таймаут и скрытый arena badge

**Files:**
- Modify: `packages/ui/src/arena-player/arena-player.types.ts`
- Modify: `packages/ui/src/arena-player/index.tsx`
- Modify: `packages/ui/src/arena-player/GuacamoleDisplay.tsx`
- Modify: `packages/ui/src/arena-player/use-guacamole-client.ts`
- Modify: `apps/frontend-demo/src/features/arena/arena.constants.ts`
- Modify: `apps/frontend-demo/src/features/arena/index.tsx`
- Modify: `apps/frontend-demo/src/features/arena/arena.use-arena.ts`
- Test: `apps/frontend-demo/src/test/guacamole-screen-timeout.test.tsx`

**Interfaces:**
- Produces: общий `DEFAULT_SCREEN_READY_TIMEOUT_MS = 60_000` для всех стендов.

- [ ] Написать fake-timer тест для общего default 60 секунд.
- [ ] Запустить тест и подтвердить ожидаемый RED.
- [ ] Обновить общий клиентский и backend-таймаут, тексты ошибок обоих стендов и передать `showDifficultyBadge={false}`.
- [ ] Запустить тест и подтвердить GREEN.

### Task 5: Скрыть сложность в tech task-management

**Files:**
- Modify: `apps/frontend-tech/src/features/task-management/index.tsx`
- Modify: `apps/frontend-tech/src/features/task-management/task-management.module.css`
- Test: `apps/frontend-tech/src/test/task-management.test.tsx`

**Interfaces:**
- Consumes: обязательное `TaskFormValue.difficulty`; new task default `1`, edit retains task value.

- [ ] Написать тесты отсутствия столбца/поля и сохранения difficulty в create/update payload.
- [ ] Запустить тесты и подтвердить ожидаемый RED.
- [ ] Удалить только визуальное отображение и редактирование difficulty.
- [ ] Запустить тесты и подтвердить GREEN.

### Task 6: Полная проверка

**Files:**
- Review: все изменённые файлы.

- [ ] Запустить `npm run test --workspace=apps/frontend-demo`.
- [ ] Запустить `npm run test --workspace=apps/frontend-tech`.
- [ ] Запустить `npm run typecheck`.
- [ ] Запустить `npm run build`.
- [ ] Выполнить browser QA для `/`, выбора кейса и mobile viewport через Playwright, поскольку Browser plugin недоступен.
- [ ] Просмотреть `git diff` на лишние изменения и сверить каждый критерий ТЗ.
