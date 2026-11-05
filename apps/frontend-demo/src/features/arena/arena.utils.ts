import { DoneStatus, ParsedDoneContent } from './arena.types';

/**
 * Парсит payload из done-мысли агента.
 * Формат: "<status> | <message>", где status ∈ {success, failure}.
 * Если разделителя нет — возвращаем status='unknown' и весь content как message.
 */
export function parseDoneContent(content: unknown): ParsedDoneContent {
  if (!content || 'string' !== typeof content) {
    return { status: 'unknown', message: '' };
  }

  const trimmed = content.trim();
  if (!trimmed) return { status: 'unknown', message: '' };

  const sepIdx = trimmed.indexOf('|');
  if (-1 === sepIdx) {
    return { status: 'unknown', message: trimmed };
  }

  const left = trimmed.slice(0, sepIdx).trim().toLowerCase();
  const right = trimmed.slice(sepIdx + 1).trim();

  let status: DoneStatus = 'unknown';
  if ('success' === left) status = 'success';
  else if ('failure' === left) status = 'failure';

  return { status, message: right };
}
