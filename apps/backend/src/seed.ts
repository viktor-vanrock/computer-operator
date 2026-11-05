/**
 * Seed-скрипт — заполняет БД preset-задачами.
 * Запуск: npx tsx src/seed.ts
 *
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const PRESET_TASKS = [
  // ── Легко (1) ────────────────────────────────────────
  { title: 'Найти товар и добавить в корзину',           difficulty: 1 },
  { title: 'Открыть страницу «О компании»',              difficulty: 1 },
  { title: 'Переключить язык интерфейса',                difficulty: 1 },
  { title: 'Найти кнопку «Войти» и нажать её',           difficulty: 1 },
  { title: 'Перейти в раздел «Контакты»',                difficulty: 1 },

  // ── Просто (2) ───────────────────────────────────────
  { title: 'Оформить подписку на тарифный план',         difficulty: 2 },
  { title: 'Заполнить форму обратной связи и отправить', difficulty: 2 },
  { title: 'Добавить товар в избранное',                 difficulty: 2 },
  { title: 'Применить фильтр по категории товаров',      difficulty: 2 },
  { title: 'Поставить оценку товару',                    difficulty: 2 },

  // ── Средне (3) ───────────────────────────────────────
  { title: 'Найти раздел FAQ и скопировать ответ',       difficulty: 3 },
  { title: 'Изменить настройки профиля и сохранить',     difficulty: 3 },
  { title: 'Сравнить два тарифных плана и выбрать',      difficulty: 3 },
  { title: 'Найти и скачать счёт за прошлый месяц',      difficulty: 3 },

  // ── Сложно (4) ───────────────────────────────────────
  { title: 'Применить промокод и оформить заказ',        difficulty: 4 },
  { title: 'Настроить уведомления и подтвердить email',  difficulty: 4 },
  { title: 'Перенести данные из старого профиля',        difficulty: 4 },
  { title: 'Настроить двухфакторную аутентификацию',     difficulty: 4 },

  // ── Эксперт (5) ──────────────────────────────────────
  { title: 'Пройти многошаговую форму регистрации',      difficulty: 5 },
  { title: 'Восстановить доступ к аккаунту без email',   difficulty: 5 },
  { title: 'Настроить интеграцию с внешним сервисом',    difficulty: 5 },
];

async function main() {
  console.info('🌱 Seeding database...');

  // Сначала создаём начальный Score (один глобальный счёт)
  await prisma.score.upsert({
    where: { id: 'global' },
    update: {},
    create: { id: 'global', humanTotal: 0, agentTotal: 0 },
  });

  // FK не позволяет удалить задачи раньше связанных сессий и их метрик.
  await prisma.sessionMetrics.deleteMany();
  await prisma.session.deleteMany();
  // После удаления сессий можно пересоздать preset-задачи.
  await prisma.task.deleteMany({ where: { isPreset: true } });

  for (const task of PRESET_TASKS) {
    await prisma.task.create({
      data: {
        title: task.title,
        prompt: task.title,
        imageId: null,
        difficulty: task.difficulty,
        isPreset: true,
        isVisible: true,
      },
    });
    console.info(`  ✓ Task: "${task.title}" (difficulty: ${task.difficulty})`);
  }

  console.info(`\n✅ Seeded ${PRESET_TASKS.length} tasks + 1 score record`);
}

main()
  .catch((e) => {
    console.error('❌ Seed failed:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
