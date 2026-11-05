/**
 * Клик, пойманный на нашей стороне через `Guacamole.Mouse` поверх Guacamole canvas.
 */
export interface AgentClick {
  id: string
  x: number // относительная [0, 1] от ширины Guacamole-дисплея
  y: number // относительная [0, 1] от высоты Guacamole-дисплея
  timestamp: number
}

export interface PreparingStep {
  icon: React.ReactNode
  label: string
  duration: number
}
