export const STATS = [
  { id: 'rounds', base: 47,  label: 'Раундов сыграно',  suffix: ''  },
  { id: 'wins',   base: 62,  label: 'Побед агента',     suffix: '%' },
  { id: 'speed',  base: 1.8, label: 'Быстрее человека', suffix: '×' },
] as const;

export const FEATURES = [
  {
    id: 'automation',
    icon: 'Lightning',
    label: 'Автоматизация задач',
    desc: 'Запусти агента и наблюдай, как он самостоятельно работает с интерфейсом.',
    accentVar: '--color-sky',
  },
  {
    id: 'analytics',
    icon: 'ChartBar',
    label: 'Детальная аналитика',
    desc: 'Сравни шаги, клики и ошибки, чтобы увидеть, где агент обходит человека.',
    accentVar: '--color-violet',
  },
  {
    id: 'agent',
    icon: 'Brain',
    label: 'Мышление IRL',
    desc: 'Смотри мысли агента в сайдбаре и каждый его шаг рассуждений.',
    accentVar: '--color-aqua',
  },
] as const;
