import { describe, expect, it } from 'vitest';
import { CORE_COMPONENTS } from '@iceslab/shared';
import { createCoreVersions, wizardCoreComponents } from '@/contours/nodes/lib/nodeCreateForm';

describe('wizardCoreComponents: ядра выбранного протокола первыми', () => {
  it('hysteria: hysteria сверху, остальные под «остальные ядра», caddy-naive не предлагается вовсе', () => {
    const { relevant, others } = wizardCoreComponents('hysteria', false);
    expect(relevant).toEqual(['hysteria']);
    expect(others).not.toContain('hysteria');
    expect([...relevant, ...others]).not.toContain('caddy-naive');
    expect(new Set([...relevant, ...others]).size).toBe(CORE_COMPONENTS.length - 1);
  });

  it('AWG двумя компонентами; shadowsocks это xray; с движком sing-box добавляется singbox', () => {
    expect(wizardCoreComponents('amneziawg', false).relevant).toEqual(['amneziawg-module', 'amneziawg-tools']);
    expect(wizardCoreComponents('shadowsocks', false).relevant).toEqual(['xray']);
    expect(wizardCoreComponents('xray', true).relevant).toEqual(['xray', 'singbox']);
    expect(wizardCoreComponents('tuic', false).relevant).toEqual(['singbox']);
  });
});

describe('createCoreVersions: ключ только с выбором', () => {
  it('ничего не выбрано: ключа нет, сервер ставит пины', () => {
    expect(createCoreVersions(true, {})).toBeUndefined();
  });

  it('выбрано: ровно выбранные компоненты', () => {
    expect(createCoreVersions(true, { singbox: '1.13.14' })).toEqual({ singbox: '1.13.14' });
  });

  it('сервер старше поля: не шлём, даже если выбрано', () => {
    expect(createCoreVersions(false, { singbox: '1.13.14' })).toBeUndefined();
  });
});
