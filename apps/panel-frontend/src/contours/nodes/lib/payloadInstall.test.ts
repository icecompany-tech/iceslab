import { describe, expect, it } from 'vitest';
import { isPayloadOnly, payloadFileName, payloadFileOf, scpCommand } from '@/contours/nodes/lib/payloadInstall';
import ru from '@/i18n/locales/ru';
import en from '@/i18n/locales/en';

const at = (d: unknown, key: string): unknown =>
  key.split('.').reduce<unknown>((o, k) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined), d);

describe('A-295: установка ноды из payload на панели без https', () => {
  it('payloadOnly только по true; старый сервер без поля и чужое значение это путь токена', () => {
    expect(isPayloadOnly({ payloadOnly: true })).toBe(true);
    expect(isPayloadOnly({ payloadOnly: false })).toBe(false);
    expect(isPayloadOnly({})).toBe(false);
    expect(isPayloadOnly({ payloadOnly: 'true' })).toBe(false);
    expect(isPayloadOnly(null)).toBe(false);
    expect(isPayloadOnly(undefined)).toBe(false);
  });

  it('путь файла берётся из команды сервера, без копии константы', () => {
    const cmd =
      'curl -fsSL https://raw.githubusercontent.com/icecompany-tech/iceslab/main/scripts/install-iceslab-node.sh | bash -s -- --payload-file /root/iceslab-node.payload --engines xray';
    expect(payloadFileOf(cmd)).toBe('/root/iceslab-node.payload');
    expect(payloadFileOf('bash -s -- --panel-url https://p.example --bootstrap bs_x')).toBeNull();
  });

  it('scp кладёт скачанный файл туда, где его читает команда; порт агента снят', () => {
    expect(payloadFileName('de-1')).toBe('de-1-payload.txt');
    expect(scpCommand('de-1', '203.0.113.7:2600', '/root/iceslab-node.payload')).toBe(
      'scp ./de-1-payload.txt root@203.0.113.7:/root/iceslab-node.payload',
    );
    expect(scpCommand('de-1', 'node.example.com', '/root/x')).toBe('scp ./de-1-payload.txt root@node.example.com:/root/x');
  });

  it('слова окна и страницы ноды есть в обеих локалях', () => {
    const keys = [
      'nodeCreate.payloadOnce',
      'nodeCreate.payloadOnlyTitle',
      'nodeCreate.payloadOnlyBody',
      'nodeCreate.payloadStepTitle',
      'nodeCreate.scpTitle',
      'nodeCreate.scpHint',
      'nodeCreate.copyScp',
      'nodeCreate.runStepTitle',
      'nodeCreate.runHintPayload',
      'nodePayloadModal.payloadAtCreateOnly',
      'nodePayloadModal.payloadOnlyWarning',
      'nodePayloadModal.runOnNodeHintPayload',
      'nodePayloadModal.runIfKept',
      'nodeCreate.step3HintPayload',
      'nodeCreate.tl2Payload',
      'nodeCreate.tl2PayloadHint',
      'nodeEdit.bootstrapPayloadOnly',
      'nodeEdit.bootstrapPayloadOnlyShown',
      'nodeCreate.tl2Hint',
      'nodeCreate.onceBody',
      'nodePayloadModal.warning',
    ];
    const missing = keys.flatMap((k) => [
      ...(typeof at(ru, k) === 'string' ? [] : [`ru ${k}`]),
      ...(typeof at(en, k) === 'string' ? [] : [`en ${k}`]),
    ]);
    expect(missing).toEqual([]);
  });

  it('ключ ноды выпускает панель (keygen.service.ts, issueNodeCert), и окна говорят именно это', () => {
    const keys = ['nodeCreate.tl2Hint', 'nodeCreate.onceBody', 'nodePayloadModal.warning'];
    const byPanel = { ru: /(выпустила панель|Панель выпускает)/, en: /(the panel issued|The panel issues)/ };
    const noCopy = { ru: /панель не хранит/, en: /the panel keeps no copy/ };
    const off = keys.flatMap((k) =>
      (['ru', 'en'] as const).flatMap((l) => {
        const s = String(at(l === 'ru' ? ru : en, k));
        return byPanel[l].test(s) && noCopy[l].test(s) ? [] : [`${l} ${k}`];
      }),
    );
    expect(off).toEqual([]);
  });
});
