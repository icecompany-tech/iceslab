import { describe, expect, it } from 'vitest';
import { splitCommand } from '@/contours/nodes/lib/nodeInstall';

describe('splitCommand: строки команды установки', () => {
  it('команда, уже разбитая сервером, показывается его строками; комментарий не рвётся по --', () => {
    const cmd = [
      "# optional: --hysteria-email you@domain, the ACME account's contact",
      'bash <(curl -fsSL https://example.test/install-iceslab-node.sh) \\',
      '  --payload-file /root/iceslab-node.payload \\',
      '  --engines xray,hysteria',
    ].join('\n');
    expect(splitCommand(cmd)).toEqual([
      "# optional: --hysteria-email you@domain, the ACME account's contact",
      'bash <(curl -fsSL https://example.test/install-iceslab-node.sh) \\',
      '  --payload-file /root/iceslab-node.payload \\',
      '  --engines xray,hysteria',
    ]);
  });

  it('однострочник режется по флагам, как раньше', () => {
    expect(splitCommand('bash x.sh --panel-url https://p --bootstrap bs_1')).toEqual([
      'bash x.sh \\',
      '--panel-url https://p \\',
      '--bootstrap bs_1',
    ]);
  });
});
