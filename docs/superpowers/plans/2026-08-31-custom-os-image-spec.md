# Custom OS Image — Implementation Spec

Consolidates the domain-modeling → codebase-design → grilling conversation into one
reference document for plan executors. Domain vocabulary (Custom OS Image, Preset OS,
VM Reservation, VM Provisioning, Deployment) is defined in `CONTEXT.md` at the repo
root — read it first. The architectural decision to reuse the `reserved_vm` profile is
recorded in `docs/adr/0001-custom-image-vm-provisioning-shares-reserved-vm-profile.md`.

## Scope

Custom OS Image is available in `frontend-tech` only, for `SOLO` and `FULL_DUPLEX`
session modes. `SPLIT` (frontend-demo only) is untouched — no UI, no validation guard,
the field is simply never sent for that mode.

## Rules

- **Priority**: if `customImageId` is set, it fully replaces `presetOs` (`arenaOs`) for
  that session — the preset selector is not just deprioritized, it's not consulted at
  all.
- **`customImageId` format**: `^[a-zA-Z0-9._-]{1,100}$` (Zod regex, rejected with 400
  otherwise). It is embedded directly into the generated VM name, so it must be safe
  for that.
- **VM Fleet profile for provisioning**: the constant `reserved_vm` — the same profile
  the pre-built Preset OS pool uses (ADR-0001). Generated VM name:
  `reserved_vm_<customImageId>_<uuid-no-dashes>`.
- **Crash safety**: `Session.vmName` is written to the DB immediately after
  `POST /api/v1/deployments` succeeds (202), *before* polling for readiness starts. If
  the backend crashes mid-poll, the VM is at least discoverable by name in VM Fleet.
  No automatic reconciliation/cleanup of orphaned VMs — out of scope.
- **Execution model**: VM Reservation (Preset OS) stays fully synchronous inside
  `POST /sessions/:id/start`, exactly as today. VM Provisioning (Custom OS Image) is
  split in two: creating the deployment (`POST /api/v1/deployments`, one fast HTTP
  call) is awaited synchronously inside `startAgent`, so a VM Fleet rejection
  (`VM_PROVISIONING_REJECTED` — bad quota, invalid image, etc.) surfaces as an
  immediate HTTP 400, the same way `VM_RESERVATION_EXHAUSTED` does for Preset OS.
  Only *waiting for the VM to become ready* (which can take minutes) is dispatched to
  the background, guarded by an in-memory in-flight set so a duplicate `/start` call
  during that wait is rejected with `SESSION_ALREADY_STARTED` instead of racing a
  second deployment into existence. The eventual `PREPARING`/`FAILED` transition from
  that background wait happens via the existing status+WS-broadcast mechanism (the
  same pattern `schedulePreparingTimeout` already uses), and is written with an atomic,
  status-guarded update (mirroring `tryFinalizeStatus`'s pattern) so it cannot
  overwrite a `COMPLETED`/`FAILED` status set by a concurrent `stopAgent` call — any
  such conflict is resolved by cleaning up the now-unwanted VM instead of resurrecting
  the session.
- **Deployment wait timeout**: `VM_FLEET_DEPLOYMENT_TIMEOUT_MS = 3 * 60_000`, polled
  every `VM_FLEET_DEPLOYMENT_POLL_INTERVAL_MS = 2_000`.
- **`connectArgs` over WebSocket**: because provisioning is async, the `POST /start`
  HTTP response can no longer be relied on to carry `connectArgs` — by the time it
  returns, the VM may not exist yet. `STATUS_CHANGE` WS events gain an optional
  `connectArgs` field, populated whenever the broadcast accompanies a transition to
  `PREPARING` (both Preset OS and Custom OS Image paths, for consistency). Frontend
  arena hooks must read `connectArgs` from this event, not only from the `/start`
  response.

## Failure reason taxonomy

Replaces the blanket `AGENT_START_FAILED` used today for every failure point in
`startAgent`/`completeAgentStart`, except `openTask` (Agent Manager is out of scope for
this feature — left untouched). Used both as the Prometheus `sessionsFailedTotal{reason}`
label and, where the failure is still synchronous (Preset OS reservation, pre-PREPARING
Guacamole auth), as the HTTP `error.code`.

| Failure point | Reason constant |
|---|---|
| No available VM for Preset OS (`reserveAvailable` throws) | `VM_RESERVATION_EXHAUSTED` |
| VM Fleet rejects `POST /deployments` outright (permanent 4xx, e.g. `profile_limit`) | `VM_PROVISIONING_REJECTED` |
| Deployment created, but the VM inside it reaches VM-level `FAILED` | `VM_PROVISIONING_FAILED` |
| Deployment never becomes ready within the timeout | `VM_PROVISIONING_TIMEOUT` |
| Guacamole auth token fetch fails (pre-`PREPARING`) | `GUACAMOLE_AUTH_FAILED` |
| Guacamole `buildSharingParams` fails (post-`PREPARING`, in `completeAgentStart`) | `GUACAMOLE_SHARING_FAILED` |
| `agentManager.openTask` fails | `AGENT_START_FAILED` (unchanged) |
| `PREPARING` timeout (frontend never confirmed `guacamole-ready`) | `PREPARING_TIMEOUT` (unchanged) |

`VMFleetApiError`'s existing `apiCode` field (already used for VM-Fleet-returned
`error.code`) is reused for the two *client-thrown* provisioning errors so callers can
distinguish them without string-matching on the message: `deployment_failed` and
`deployment_timeout`.

## Non-goals

- No SPLIT support.
- No automatic reconciliation of orphaned VMs after a backend crash.
- No changes to Agent Manager / `openTask` error handling.
- No new frontend-demo behavior (it never sends `customImageId`).
- No new test infra for `frontend-tech` (it currently has none — that screen's task is
  verified manually via `npm run dev:tech` + browser, not vitest).
