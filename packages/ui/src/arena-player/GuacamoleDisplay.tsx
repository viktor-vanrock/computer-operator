import { useRef } from 'react';

import type { HumanInputAction } from './human-input';
import type { GuacamoleConnectionError } from './use-guacamole-client';
import { useGuacamoleClient } from './use-guacamole-client';

interface Props {
  connectArgs: string
  tunnelUrl: string
  className?: string | undefined
  onConnected?: ((tunnelId?: string) => void) | undefined
  onError?: ((error: GuacamoleConnectionError) => void) | undefined
  onAgentClick?: ((x: number, y: number) => void) | undefined
  clipboardInputEnabled?: boolean | undefined
  inputEnabled?: boolean | undefined
  onHumanAction?: ((action: HumanInputAction) => void) | undefined
}

export function GuacamoleDisplay({
  connectArgs, tunnelUrl, className, onConnected, onError, onAgentClick, inputEnabled = false, clipboardInputEnabled = false, onHumanAction,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);

  useGuacamoleClient({
    connectArgs, tunnelUrl, containerRef, onConnected, onError, onAgentClick,
    inputEnabled, clipboardInputEnabled, onHumanAction,
  });

  return <div ref={containerRef} className={className} tabIndex={inputEnabled ? 0 : -1} aria-label="Рабочий стол" />;
}
