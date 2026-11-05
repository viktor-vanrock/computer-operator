import { ModelOption } from '@/modules/sessions/sessions.types';

export interface SharingParams {
  connectionId: string;
  datasource: string;
  guacToken: string;
}

// ─── Full-duplex ─────────────────────────────────────────────────────────────

export interface FullDuplexOptions {
  historyMaxStepsCount: number;
  maxScreenshotsDelay: number;
  model?: ModelOption;
  sharingParams: SharingParams;
}

export interface FullDuplexSessionOpenedPayload {
  task_uuid: string;
  session_id: string;
  vm_name: string;
  connectionId: string;
  history_max_steps_count: number;
  max_screenshots_delay: number;
}

export interface FullDuplexStepPayload {
  step: number;
  ts: number;
  reflection: string;
  think: string;
  speak: string;
  act: { name: string; arguments: Record<string, unknown> };
  raw?: string;
  thought?: string;
  action_type?: string;
  action_inputs?: Record<string, unknown>;
  action_explanation?: string;
}

export interface FullDuplexOutcomePayload {
  step: number;
  ts: number | string;
  kind: 'finished' | 'aborted';
  value: 'positive' | 'negative' | 'user' | 'env';
  speak?: string;
}

export interface FullDuplexErrorPayload {
  code: string;
  message: string;
  fatal: boolean;
  step?: number | null;
  ts?: number | string | null;
}

export interface FullDuplexClosedPayload {
  reason: 'client_request' | 'fatal_error' | 'guacamole_error' | 'ws_gone' | 'service_shutdown';
  step: number | null;
  ts: number | string;
}

export interface FullDuplexHandlers {
  onSessionOpened: (payload: FullDuplexSessionOpenedPayload) => void;
  onStep: (payload: FullDuplexStepPayload) => void;
  onOutcome: (payload: FullDuplexOutcomePayload) => void;
  onError: (payload: FullDuplexErrorPayload) => void;
  onClosed: (payload: FullDuplexClosedPayload) => void;
}

export interface FullDuplexHandle {
  sendTask: (text: string) => void;
  close: () => void;
}

// ─── SOLO v1 (ws://<service>/v1/) ──────────────────────────────────────────────

export interface SoloSessionOptions {
  profile?: string;
  deferredFirstTask?: boolean;
  vmName: string;
  connectionId: string;
  datasource: string;
  guacToken: string;
  configOverride: {
    maxIterations: number;
    modelRetries: number;
    mouseClickDelay: number;
    minOperationDelay: number;
  };
}

export interface SoloStepPayload {
  executedActions?: Array<{ type: string; inputs: Record<string, unknown> }>;
  step: number;
  ts: number;
  text: string;
  status: 'INCOMPLETE' | 'DONE' | 'FAILED' | 'CANCELLED';
  thought?: string;
  action_type?: string;
  action_inputs?: Record<string, unknown>;
  action_explanation?: string;
}

export type SoloDiagnosticsLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | 'CRITICAL' | 'FATAL';

export interface SoloDiagnosticsPayload {
  ts: number;
  level: SoloDiagnosticsLevel;
  event: string;
  raw: string;
}

export type SoloSessionClosedReason = 'client_request' | 'fatal_diagnostics' | 'critical_diagnostics' | 'guacamole_error' | 'ws_gone' | 'heartbeat_timeout';

export interface SoloSessionHandlers {
  onOpen?: () => void;
  onStep: (payload: SoloStepPayload) => void;
  onDiagnostics: (payload: SoloDiagnosticsPayload) => void;
  onClosed: (reason: SoloSessionClosedReason) => void;
}

export interface SoloSessionHandle {
  sendTask: (text: string, taskId: string) => void;
  cancelTask: () => void;
  close: (reason?: SoloSessionClosedReason) => void;
}
