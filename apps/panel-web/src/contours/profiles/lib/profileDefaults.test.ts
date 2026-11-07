import { describe, expect, it } from 'vitest';
import { DEFAULT_LINK_CONGESTION, LINK_CONGESTIONS } from '@iceslab/shared';
import { defaults } from '@/contours/profiles/lib/profileDefaults';

/**
 * Дефолты формы профиля в той части, где они обещают поведение СЕРВЕРА.
 *
 * `tuicCongestion` до 22.09 стоял здесь словом `'bbr'`, а список значений был
 * переписан ещё в двух местах контура. Сервер сменит дефолт, форма неделю
 * продолжит предлагать прежнее, и ворота этого не увидят: формы проверяют, что
 * значение из союза, а не что союз тот же.
 */
describe('дефолты формы профиля', () => {
  it('1. congestion у tuic это дефолт контракта, а не своё слово', () => {
    expect(defaults(null).tuicCongestion).toBe(DEFAULT_LINK_CONGESTION);
    expect(LINK_CONGESTIONS).toContain(defaults(null).tuicCongestion);
  });
});
