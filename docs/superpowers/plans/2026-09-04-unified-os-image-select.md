# Unified OS Image Select Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the technical stand's separate Preset OS select and manual Custom OS Image input with one select containing Ubuntu and in-use Packer images from VM Fleet.

**Architecture:** The backend owns VM Fleet access and exposes a minimal `GET /images` DTO after runtime validation, filtering, and sorting. Shared UI code provides the typed query hook; `frontend-tech` derives select options from that query and maps the selected prefixed value back to the existing `arenaOs` or `customImageId` session fields.

**Tech Stack:** Fastify 5, Zod 4, React 19, TanStack Query 5, Radix Select, TypeScript, Vitest.

**Spec:** Approved specification in the conversation dated 2026-09-04.

## Global Constraints

- `Ubuntu` is always first, selected by default, and maps to `arenaOs: "ubuntu2204"`.
- VM Fleet images come from `GET /api/v1/images?in_use=true`; only entries with a `tags` object are exposed.
- Packer image labels are `<name> · <first-eight-image-id-characters>…`; the complete `image_id` is submitted as `customImageId`.
- Sort images by valid `tags.created` descending, then numeric dotted `tags.version` descending, then `name` ascending; invalid/missing dates and versions sort last.
- Loading and VM Fleet failure never block Ubuntu; failure leaves only Ubuntu.
- VM Fleet credentials and raw metadata never leave the backend.
- Do not change `frontend-demo`, session creation contracts, or VM Reservation.
- No new dependency, `any`, relative parent imports, pagination, search, manual retry button, or server cache.

---

### Task 1: VM Fleet image client

**Files:**
- Modify: `apps/backend/src/lib/vm-fleet/vm-fleet.types.ts`
- Modify: `apps/backend/src/lib/vm-fleet/vm-fleet.client.ts`
- Modify: `apps/backend/src/lib/vm-fleet/index.ts`
- Test: `apps/backend/src/test/vm-fleet-client.test.ts`

**Interfaces:**
- Produces: `VMFleetClient.listImagesInUse(): Promise<VMFleetImage[]>`
- Produces: `VMFleetImage` and `VMFleetImageTags` types.

- [ ] Add failing client tests for the exact query URL, Bearer authorization, a complete image response, and malformed non-array JSON.
- [ ] Run `npx vitest run src/test/vm-fleet-client.test.ts` from `apps/backend`; confirm failure because `listImagesInUse` is absent.
- [ ] Add image types, runtime array/object validation in `listImagesInUse`, and exports.
- [ ] Run the focused test again and confirm it passes.

### Task 2: Public images API

**Files:**
- Create: `apps/backend/src/modules/images/images.schema.ts`
- Create: `apps/backend/src/modules/images/images.types.ts`
- Create: `apps/backend/src/modules/images/images.service.ts`
- Create: `apps/backend/src/modules/images/images.router.ts`
- Modify: `apps/backend/src/server.ts`
- Test: `apps/backend/src/test/images.test.ts`

**Interfaces:**
- Consumes: `vmFleetClient.listImagesInUse()`.
- Produces: `GET /images -> { data: Array<{ imageId: string; name: string }> }`.

- [ ] Add failing service tests for filtering entries without tag objects, date/version/name ordering, malformed metadata placement, and DTO projection; add router-level error mapping coverage for `VMFleetApiError -> BadGatewayException`.
- [ ] Run `npx vitest run src/test/images.test.ts` and confirm imports/behavior fail because the module is absent.
- [ ] Implement focused Zod schema/type, comparison helpers, service projection, router, and server registration.
- [ ] Run images and VM Fleet tests and confirm they pass.

### Task 3: Shared images query and frontend selection model

**Files:**
- Create: `packages/ui/src/types/image.types.ts`
- Create: `packages/ui/src/api/images.api.ts`
- Create: `apps/frontend-tech/src/features/task-selection/image-options.ts`
- Create: `apps/frontend-tech/src/test/image-options.test.ts`
- Modify: `apps/frontend-tech/src/constants/session-config.ts`
- Modify: `apps/frontend-tech/src/features/task-selection/use-task-selection.ts`

**Interfaces:**
- Produces: `useAvailableImages()` and `AvailableImage`.
- Produces: prefixed values `preset:ubuntu2204` and `image:<full-image-id>` with mapping to mutually exclusive session fields.

- [ ] Add a failing pure helper test for Ubuntu ordering, truncated labels, and full-id session mapping; run it to confirm the module is absent.
- [ ] Add the shared type, TanStack Query hook, and pure option builder/shortener; replace separate `arenaOs`/`customImageId` state with one defaulted selection.
- [ ] Run typechecks for `packages/ui` and `apps/frontend-tech`; fix all contract errors.

### Task 4: Unified select UI and documentation

**Files:**
- Modify: `apps/frontend-tech/src/features/task-selection/index.tsx`
- Modify: `apps/frontend-tech/src/features/task-selection/task-selection.module.css`
- Modify: `CONTEXT.md`

**Interfaces:**
- Consumes: `useAvailableImages()` and selection state from Task 3.
- Produces: one accessible OS/image select plus loading/error status copy.

- [ ] Replace `OsOrCustomImageField` with one select; keep Ubuntu usable during loading and failure.
- [ ] Render `Загрузка доступных образов…` during pending and `Не удалось загрузить образы — доступна только Ubuntu` on error.
- [ ] Remove unused text-input styles and update domain wording to describe catalog selection rather than manual input.
- [ ] Build `frontend-tech`; visual inspection is explicitly skipped at the user's request.

### Task 5: Full verification and review

**Files:**
- Verify all changed files.

**Interfaces:**
- Consumes: completed backend, shared UI, and frontend implementation.
- Produces: a verified branch ready for integration.

- [ ] Run `npm run test --workspace=apps/backend`.
- [ ] Run `npm run typecheck --workspace=apps/backend`, `npm run typecheck --workspace=packages/ui`, and `npm run typecheck --workspace=apps/frontend-tech`.
- [ ] Run `npm run build --workspace=apps/frontend-tech`.
- [ ] Run relevant lint checks and inspect `git diff --check`.
- [ ] Review the final diff against every approved acceptance criterion and fix any gap before handoff.
