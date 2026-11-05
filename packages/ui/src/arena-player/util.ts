export function buildTunnelUrl(guacamoleBaseUrl: string | undefined): string {
  const base = guacamoleBaseUrl ?? 'http://localhost:8080';
  const wsBase = base
    .replace(/\/$/, '')
    .replace(/^http:/, 'ws:')
    .replace(/^https:/, 'wss:');
  return `${wsBase}/guacamole/websocket-tunnel`;
}

export function applyScale(display: Guacamole.Display, container: HTMLDivElement): void {
  const displayEl = display.getElement();
  const displayW = displayEl.offsetWidth;
  const displayH = displayEl.offsetHeight;
  if (!displayW || !displayH) return;

  const containerW = container.clientWidth;
  const containerH = container.clientHeight;
  if (!containerW || !containerH) return;

  const scale = Math.min(containerW / displayW, containerH / displayH);

  // Центрируем контент — совпадает с расчётом useClickPosition (letterbox/pillarbox).
  // Не используем display.scale() т.к. он ставит transform-origin: 0 0 без смещения,
  // что уводит контент в левый верхний угол и ломает позиции анимаций кликов.
  const offsetX = (containerW - displayW * scale) / 2;
  const offsetY = (containerH - displayH * scale) / 2;
  displayEl.style.transformOrigin = '0 0';
  displayEl.style.transform = `translate(${offsetX}px, ${offsetY}px) scale(${scale})`;
};
