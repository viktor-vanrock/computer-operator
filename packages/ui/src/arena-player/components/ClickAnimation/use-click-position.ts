import { useCallback, useRef, useState } from 'react';

import { GUAC_ASPECT } from './constants';

export interface RenderedArea {
  offsetX: number // px от левого края контейнера до начала реального изображения
  offsetY: number // px от верхнего края контейнера до начала реального изображения
  width: number   // ширина реального изображения (без полос)
  height: number  // высота реального изображения (без полос)
}

/**
 * Отслеживает размеры контейнера через ResizeObserver и вычисляет
 * реальные пиксельные координаты клика с учётом letterbox/pillarbox.
 *
 * Guacamole-сессия создаётся в 1920×1080 и масштабируется
 * с сохранением aspect ratio (16:9) — остаток заполняется чёрными полосами.
 *
 * Возвращает setRef для крепления к контейнеру и функцию
 * resolvePosition(relX, relY) → { x, y } в px внутри контейнера.
 */
export function useClickPosition(): {
  setRef: (el: HTMLDivElement | null) => void
  resolvePosition: (relX: number, relY: number) => { x: number; y: number }
} {
  const [renderedArea, setRenderedArea] = useState<RenderedArea>({
    offsetX: 0,
    offsetY: 0,
    width: 0,
    height: 0,
  });

  const observerRef = useRef<ResizeObserver | null>(null);

  const setRef = useCallback((el: HTMLDivElement | null) => {
    if (observerRef.current) {
      observerRef.current.disconnect();
      observerRef.current = null;
    }
    if (!el) return;

    const calc = () => {
      const containerWidth = el.clientWidth;
      const containerHeight = el.clientHeight;
      if (!containerWidth || !containerHeight) return;

      const containerAspect = containerWidth / containerHeight;

      let renderedWidth: number;
      let renderedHeight: number;

      if (containerAspect > GUAC_ASPECT) {
        // pillarbox — чёрные полосы слева и справа
        renderedHeight = containerHeight;
        renderedWidth = containerHeight * GUAC_ASPECT;
      } else {
        // letterbox — чёрные полосы сверху и снизу
        renderedWidth = containerWidth;
        renderedHeight = containerWidth / GUAC_ASPECT;
      }

      const offsetX = (containerWidth - renderedWidth) / 2;
      const offsetY = (containerHeight - renderedHeight) / 2;

      setRenderedArea({ offsetX, offsetY, width: renderedWidth, height: renderedHeight });
    };

    const observer = new ResizeObserver(() => calc());
    observer.observe(el);
    observerRef.current = observer;
    calc();
  }, []);

  const resolvePosition = useCallback(
    (relX: number, relY: number): { x: number; y: number } => ({
      x: renderedArea.offsetX + relX * renderedArea.width,
      y: renderedArea.offsetY + relY * renderedArea.height,
    }),
    [renderedArea]
  );

  return { setRef, resolvePosition };
}
