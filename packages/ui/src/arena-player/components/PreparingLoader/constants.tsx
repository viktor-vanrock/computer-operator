import { HardDrivesIcon, MonitorIcon, PlugsConnectedIcon,RobotIcon } from '@phosphor-icons/react';

import type { PreparingStep } from '../../arena-player.types';

export const STEPS: PreparingStep[] = [
  { icon: <HardDrivesIcon weight="thin" size={18} />,      label: 'Инициализация виртуальной машины', duration: 1000 },
  { icon: <MonitorIcon weight="thin" size={18} />,          label: 'Загрузка операционной системы',    duration: 1000 },
  { icon: <RobotIcon weight="thin" size={18} />,            label: 'Запуск агентной среды',             duration: 1000 },
  { icon: <PlugsConnectedIcon weight="thin" size={18} />,   label: 'Установка защищённого канала',      duration: 1000 },
];

export const TOTAL_DURATION = STEPS.reduce((acc, s) => acc + s.duration, 0);
