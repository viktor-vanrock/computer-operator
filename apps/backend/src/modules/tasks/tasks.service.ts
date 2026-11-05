import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library';

import { prisma } from '@/lib/db/prisma.js';
import { ConflictException, NotFoundException } from '@/lib/http/errors.js';
import { logger } from '@/lib/logger.js';

const log = logger.child({ module: 'tasks' });

import type { AdminTask, CreatePresetTaskInput, CreateTaskInput, Task, UpdatePresetTaskInput } from './tasks.types.js';

interface RawTask {
  id: string;
  title: string;
  prompt: string;
  imageId: string | null;
  difficulty: number;
  isPreset: boolean;
  isVisible: boolean;
  createdAt: Date;
}

const serializeAdmin = (task: RawTask): AdminTask => ({
  ...task,
  createdAt: task.createdAt.toISOString(),
});

const serializePublic = (task: RawTask): Task => ({
  id: task.id,
  title: task.title,
  prompt: task.prompt,
  imageId: task.imageId,
  difficulty: task.difficulty,
  isPreset: task.isPreset,
  isVisible: task.isVisible,
  createdAt: task.createdAt.toISOString(),
});

// Preset tasks are static — cache for 60 minutes
const PRESET_TASKS_TTL_MS = 60 * 60 * 1000;
let presetTasksCache: { value: Task[]; expiresAt: number } | undefined;

function invalidatePresetCache(): void {
  presetTasksCache = undefined;
}

async function requirePreset(id: string): Promise<RawTask> {
  const task = await prisma.task.findFirst({ where: { id, isPreset: true } });
  if (!task) throw new NotFoundException('Preset task not found');
  return task;
}

export const tasksService = {
  async findById(id: string): Promise<AdminTask> {
    log.debug({ taskId: id }, 'findById');
    const task = await prisma.task.findUnique({ where: { id } });
    if (!task) {
      throw new NotFoundException('Task not found');
    }
    return serializeAdmin(task);
  },

  async findPublicById(id: string): Promise<Task> {
    const task = await prisma.task.findUnique({ where: { id } });
    if (!task) throw new NotFoundException('Task not found');
    return serializePublic(task);
  },

  async findAllPreset(): Promise<Task[]> {
    if (presetTasksCache && Date.now() < presetTasksCache.expiresAt) {
      log.debug({ count: presetTasksCache.value.length }, 'findAllPreset сache');
      return presetTasksCache.value;
    }
    const tasks = await prisma.task.findMany({
      where: { isPreset: true, isVisible: true },
      orderBy: [{ difficulty: 'asc' }, { createdAt: 'asc' }],
    });
    const result = tasks.map(serializePublic);
    presetTasksCache = { value: result, expiresAt: Date.now() + PRESET_TASKS_TTL_MS };
    log.debug({ count: result.length }, 'findAllPreset');
    return result;
  },

  async findAllPresetForAdmin(): Promise<AdminTask[]> {
    const tasks = await prisma.task.findMany({
      where: { isPreset: true },
      orderBy: [{ difficulty: 'asc' }, { createdAt: 'asc' }],
    });
    return tasks.map(serializeAdmin);
  },

  async findRandomPreset(): Promise<Task> {
    log.debug('findRandomPreset');
    const where = { isPreset: true, isVisible: true };
    const count = await prisma.task.count({ where });
    if (count === 0) {
      throw new NotFoundException('No preset tasks found');
    }
    const skip = Math.floor(Math.random() * count);
    const task = await prisma.task.findFirst({
      where,
      skip,
    });
    if (!task) {
      throw new NotFoundException('No preset tasks found');
    }
    return serializePublic(task);
  },

  async create(input: CreateTaskInput): Promise<Task> {
    const task = await prisma.task.create({ data: { ...input, isPreset: false, isVisible: true } });
    return serializePublic(task);
  },

  async createPreset(input: CreatePresetTaskInput): Promise<AdminTask> {
    const task = await prisma.task.create({ data: { ...input, isPreset: true } });
    invalidatePresetCache();
    return serializeAdmin(task);
  },

  async importPresets(inputs: CreatePresetTaskInput[]): Promise<AdminTask[]> {
    const tasks = await prisma.$transaction(
      inputs.map((input) => prisma.task.create({ data: { ...input, isPreset: true } }))
    );
    invalidatePresetCache();
    return tasks.map(serializeAdmin);
  },

  async updatePreset(id: string, input: UpdatePresetTaskInput): Promise<AdminTask> {
    await requirePreset(id);
    const task = await prisma.task.update({ where: { id }, data: input });
    invalidatePresetCache();
    return serializeAdmin(task);
  },

  async deletePreset(id: string): Promise<void> {
    await requirePreset(id);
    try {
      await prisma.task.delete({ where: { id } });
      invalidatePresetCache();
    } catch (error) {
      if (error instanceof PrismaClientKnownRequestError && error.code === 'P2003') {
        throw new ConflictException('Delete all sessions linked to this task before deleting the preset');
      }
      throw error;
    }
  },
};
