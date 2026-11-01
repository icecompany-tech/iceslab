// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { ReactNode } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import i18next from 'i18next';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import ru from '@/i18n/locales/ru';
import { StepInstall } from '@/contours/nodes/components/NodeCreate/StepInstall';
import { NodePayloadModal } from '@/contours/nodes/components/NodePayloadModal';
import type { Registered } from '@/contours/nodes/lib/nodeCreateForm';

/*
 * A-295, AUDT 01.11: the node windows in both forms, payloadOnly true (a panel
 * without https) and false. The words are the ru dictionary's own, read from
 * it, so a reworded string does not break the test and a dropped one does.
 */

const i18n = i18next.createInstance();
const at = (key: string): string =>
  key.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown>)[k], ru) as string;

beforeAll(async () => {
  await i18n.use(initReactI18next).init({ lng: 'ru', resources: { ru: { translation: ru } }, interpolation: { escapeValue: false } });
  // Mantine asks for both; jsdom has neither.
  window.matchMedia ??= ((q: string) => ({
    matches: false,
    media: q,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});
afterEach(cleanup);

const wrap = (node: ReactNode) =>
  render(
    <I18nextProvider i18n={i18n}>
      <MantineProvider>{node}</MantineProvider>
    </I18nextProvider>,
  );

const TOKEN = 'bs_testtoken000000000000000000000';
const BOOTSTRAP_CMD = `bash <(curl -fsSL https://example.test/install-iceslab-node.sh) \\\n  --panel-url https://panel.example.test \\\n  --bootstrap ${TOKEN}`;
const PAYLOAD_CMD = 'bash <(curl -fsSL https://example.test/install-iceslab-node.sh) \\\n  --payload-file /root/iceslab-node.payload';

const registered = (payloadOnly: boolean): Registered => ({
  id: 'n1',
  name: 'de-1',
  address: '203.0.113.7:2600',
  token: TOKEN,
  expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
  command: payloadOnly ? PAYLOAD_CMD : BOOTSTRAP_CMD,
  payload: 'PAYLOAD-BASE64',
  payloadOnly,
  hosts: [],
});

const step = (payloadOnly: boolean) =>
  wrap(
    <StepInstall
      registered={registered(payloadOnly)}
      showPayload={false}
      setShowPayload={() => {}}
      copied={null}
      isOnline={false}
      waited={0}
      copy={async () => {}}
      downloadPayload={() => {}}
      watchFailure={null}
    />,
  );

describe('окно создания ноды (StepInstall)', () => {
  it('payloadOnly: скачать сейчас, положить в путь команды через scp, выполнить; токена нет', () => {
    step(true);
    expect(screen.getByText(at('nodeCreate.payloadOnlyTitle'))).toBeTruthy();
    expect(screen.getByText(at('nodeCreate.payloadStepTitle'))).toBeTruthy();
    expect(screen.getByText(at('nodeCreate.payloadOnce'))).toBeTruthy();
    expect(screen.getByText('scp ./de-1-payload.txt root@203.0.113.7:/root/iceslab-node.payload')).toBeTruthy();
    expect(screen.getByText(at('nodeCreate.runStepTitle'))).toBeTruthy();
    expect(screen.queryByText(TOKEN)).toBeNull();
    expect(screen.queryByText(at('nodeCreate.tokenTitle'))).toBeNull();
  });

  it('с https: токен со сроком и команда bootstrap; payload рядом, со словами «один раз, сейчас»', () => {
    step(false);
    expect(screen.getByText(at('nodeCreate.onceTitle'))).toBeTruthy();
    expect(screen.getByText(at('nodeCreate.tokenTitle'))).toBeTruthy();
    expect(screen.getByText(TOKEN)).toBeTruthy();
    expect(screen.getByText(at('nodeCreate.payloadOnce'))).toBeTruthy();
    expect(screen.queryByText(at('nodeCreate.payloadOnlyTitle'))).toBeNull();
    expect(screen.queryByText(/^scp /)).toBeNull();
  });
});

const modal = (payloadOnly: boolean) =>
  wrap(
    <NodePayloadModal
      opened
      onClose={() => {}}
      nodeName="de-1"
      payload=""
      bootstrap={{
        token: TOKEN,
        expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
        command: payloadOnly ? PAYLOAD_CMD : BOOTSTRAP_CMD,
        payloadOnly,
      }}
    />,
  );

describe('перевыпуск на странице ноды (NodePayloadModal)', () => {
  it('payloadOnly: не готовая установка; payload только при создании, потерян: заново или панель с доменом', () => {
    modal(true);
    expect(screen.getByText(at('nodePayloadModal.payloadOnlyWarning'))).toBeTruthy();
    expect(screen.getByText(at('nodePayloadModal.runIfKept'))).toBeTruthy();
    expect(screen.queryByText(TOKEN)).toBeNull();
    expect(screen.queryByText(at('nodePayloadModal.bootstrapToken'))).toBeNull();
    expect(screen.queryByText(at('nodePayloadModal.runOnNode'))).toBeNull();
    expect(screen.queryByText(at('nodePayloadModal.downloadPayload'))).toBeNull();
  });

  it('с https: токен и команда; вместо пустого payload строка «только при создании»', () => {
    modal(false);
    expect(screen.getByText(at('nodePayloadModal.warning'))).toBeTruthy();
    expect(screen.getByText(TOKEN)).toBeTruthy();
    expect(screen.getByText(at('nodePayloadModal.runOnNode'))).toBeTruthy();
    expect(screen.getByText(at('nodePayloadModal.payloadAtCreateOnly'))).toBeTruthy();
    expect(screen.queryByText(at('nodePayloadModal.payloadOnlyWarning'))).toBeNull();
    expect(screen.queryByText(at('nodePayloadModal.downloadPayload'))).toBeNull();
  });
});
