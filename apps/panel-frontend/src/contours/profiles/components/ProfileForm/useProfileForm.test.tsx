// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import type { ReactNode } from 'react';
import { act, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Profile } from '@/lib/domain/profiles';
import { useProfileForm } from '@/contours/profiles/components/ProfileForm/useProfileForm';
import { xrayFieldReactions } from '@/contours/profiles/lib/xrayFieldReactions';

/*
 * Три реакции формы профиля ушли из useEffect в onValuesChange (25.09), без
 * подавлений exhaustive-deps. Видимое поведение то же: это и проверяется.
 */

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>
);

const xrayProfile = (over: Partial<Profile> = {}): Profile =>
  ({
    id: 'p1',
    name: 'de-reality',
    description: null,
    protocol: 'xray',
    engine: null,
    effectiveEngine: 'xray',
    enabled: true,
    config: { subprotocol: 'vless', security: 'reality', network: 'raw', flow: 'xtls-rprx-vision' },
    ...over,
  }) as unknown as Profile;

const render = (profile: Profile | null) =>
  renderHook(
    ({ p }: { p: Profile | null }) =>
      useProfileForm({ profile: p, opened: true, mode: 'create', onSubmit: async () => {}, onClose: () => {} }),
    { wrapper, initialProps: { p: profile } },
  );

describe('useProfileForm: реакции на смену поля', () => {
  it('транспорт grpc при пустом serviceName: GunService; Vision снят', () => {
    const { result } = render(xrayProfile());
    act(() => {
      result.current.form.setFieldValue('xrayServiceName', '');
      result.current.form.setFieldValue('xrayNetwork', 'grpc');
    });
    expect(result.current.form.values.xrayServiceName).toBe('GunService');
    expect(result.current.form.values.xrayFlow).toBe('');
  });

  it('оператор очистил serviceName после grpc: остаётся пустым, обратно не заполняется', () => {
    const { result } = render(xrayProfile());
    act(() => result.current.form.setFieldValue('xrayNetwork', 'grpc'));
    act(() => result.current.form.setFieldValue('xrayServiceName', ''));
    expect(result.current.form.values.xrayServiceName).toBe('');
  });

  it('vmess при REALITY: security none; смена security потом не трогается', () => {
    const { result } = render(xrayProfile());
    act(() => result.current.form.setFieldValue('xraySubprotocol', 'vmess'));
    expect(result.current.form.values.xraySecurity).toBe('none');
    act(() => result.current.form.setFieldValue('xraySecurity', 'tls'));
    expect(result.current.form.values.xraySecurity).toBe('tls');
  });

  it('новый объект профиля с тем же id (refetch) не пересевает форму: правка на месте', () => {
    const { result, rerender } = render(xrayProfile());
    act(() => result.current.form.setFieldValue('name', 'edited-by-me'));
    rerender({ p: xrayProfile({ name: 'renamed-elsewhere' }) });
    expect(result.current.form.values.name).toBe('edited-by-me');
    // Другой профиль пересевает.
    rerender({ p: xrayProfile({ id: 'p2', name: 'other' }) });
    expect(result.current.form.values.name).toBe('other');
  });
});

describe('xrayFieldReactions', () => {
  type F = Parameters<typeof xrayFieldReactions>[0];
  const base = {
    xrayNetwork: 'raw',
    xrayServiceName: '',
    xrayFlow: 'xtls-rprx-vision',
    xraySubprotocol: 'vless',
    xraySecurity: 'reality',
  } as F;
  const grpc = 'grpc' as F['xrayNetwork'];
  it('без смены своего поля реакции нет', () => {
    expect(xrayFieldReactions(base, base)).toBeNull();
    expect(xrayFieldReactions({ ...base, xrayNetwork: grpc }, { ...base, xrayNetwork: grpc, xrayServiceName: 'X' })).toBeNull();
  });
  it('засев (previous null) применяет всё, как прежние эффекты на первом рендере', () => {
    expect(xrayFieldReactions({ ...base, xrayNetwork: grpc }, null)).toEqual({ xrayServiceName: 'GunService', xrayFlow: '' });
  });
});
