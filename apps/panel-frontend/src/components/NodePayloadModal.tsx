import { useState } from 'react';
import { now } from '../lib/demoFlag';
import {
  Alert,
  Badge,
  Button,
  Code,
  Collapse,
  Divider,
  Group,
  Modal,
  ScrollArea,
  Stack,
  Text,
} from '@mantine/core';
import { IconAlertTriangle, IconCheck, IconChevronDown, IconCopy, IconDownload } from '@tabler/icons-react';
import { useTranslation } from 'react-i18next';
import { copyToClipboard } from '../lib/clipboard';

interface BootstrapInfo {
  token: string;
  expiresAt: string;
  command: string;
}

interface Props {
  opened: boolean;
  onClose: () => void;
  nodeName: string;
  payload: string;
  bootstrap?: BootstrapInfo;
}

/**
 * Shown exactly once after a successful node create. Two flows are offered:
 *
 *   1. Bootstrap-token (recommended) - short command that the admin pastes
 *      on the node; install-script curls the panel for the full payload.
 *      Sidesteps the 4 KB Linux TTY paste limit.
 *
 *   2. Manual / file (fallback) - full base64 payload shown for download.
 *      Admin scp's the file to the node and runs install-script with
 *      `--payload-file /path/to/file`. Useful for air-gapped setups or
 *      when the node can't reach the panel HTTP endpoint at install time.
 */
export function NodePayloadModal({ opened, onClose, nodeName, payload, bootstrap }: Props) {
  const { t } = useTranslation();
  const [copiedKey, setCopiedKey] = useState<'cmd' | 'payload' | null>(null);
  const [showRaw, setShowRaw] = useState(false);

  async function handleCopy(key: 'cmd' | 'payload', value: string) {
    try {
      await copyToClipboard(value);
      setCopiedKey(key);
      window.setTimeout(() => setCopiedKey((current) => (current === key ? null : current)), 1500);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('clipboard copy failed', err);
    }
  }

  function handleDownload() {
    const blob = new Blob([payload], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${nodeName}-payload.b64`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      closeOnClickOutside={false}
      closeOnEscape={false}
      title={t('nodePayloadModal.title', { name: nodeName })}
      size="lg"
    >
      <Stack>
        <Alert color="yellow" icon={<IconAlertTriangle size={18} />}>
          {t('nodePayloadModal.warning')}
        </Alert>

        {bootstrap ? (
          <>
            <Stack gap={4}>
              <Group justify="space-between">
                <Text fw={600}>{t('nodePayloadModal.bootstrapToken')}</Text>
                <Badge color="blue" variant="light">
                  {t('nodePayloadModal.expiresIn', {
                    min: Math.max(
                      0,
                      Math.round((new Date(bootstrap.expiresAt).getTime() - now()) / 60000),
                    ),
                  })}
                </Badge>
              </Group>
              <Code style={{ wordBreak: 'break-all' }}>{bootstrap.token}</Code>
            </Stack>

            <Stack gap={4}>
              <Text fw={600}>{t('nodePayloadModal.runOnNode')}</Text>
              <Text size="xs" c="dimmed">
                {t('nodePayloadModal.runOnNodeHint')}
              </Text>
              <ScrollArea h={120} type="auto">
                <Code block style={{ whiteSpace: 'pre' }}>
                  {bootstrap.command}
                </Code>
              </ScrollArea>
              <Group>
                <Button
                  leftSection={copiedKey === 'cmd' ? <IconCheck size={16} /> : <IconCopy size={16} />}
                  color={copiedKey === 'cmd' ? 'green' : undefined}
                  variant={copiedKey === 'cmd' ? 'filled' : 'light'}
                  onClick={() => handleCopy('cmd', bootstrap.command)}
                >
                  {copiedKey === 'cmd' ? t('nodePayloadModal.copied') : t('nodePayloadModal.copyCommand')}
                </Button>
              </Group>
            </Stack>
          </>
        ) : null}

        {payload ? <Divider /> : null}

        {payload ? <Stack gap={4}>
          <Group justify="space-between" wrap="nowrap">
            <Text fw={600}>{t('nodePayloadModal.manualTitle')}</Text>
            <Button
              variant="subtle"
              size="compact-sm"
              rightSection={<IconChevronDown size={14} />}
              onClick={() => setShowRaw((v) => !v)}
            >
              {showRaw ? t('nodePayloadModal.hideRaw') : t('nodePayloadModal.showRaw')}
            </Button>
          </Group>
          <Text size="xs" c="dimmed">
            {t('nodePayloadModal.manualHint')}
          </Text>
          <Collapse in={showRaw}>
            <ScrollArea h={160} type="auto" mt="xs">
              {/* base64 payload is one giant unbroken token; pre-wrap + break-all
                  fold it into the box width instead of letting it run off the
                  right edge (Code block defaults to white-space: pre). */}
              <Code block style={{ wordBreak: 'break-all', whiteSpace: 'pre-wrap' }}>
                {payload}
              </Code>
            </ScrollArea>
          </Collapse>
          <Group mt="xs">
            <Button
              leftSection={<IconDownload size={16} />}
              variant="light"
              onClick={handleDownload}
            >
              {t('nodePayloadModal.downloadPayload')}
            </Button>
            <Button
              leftSection={copiedKey === 'payload' ? <IconCheck size={16} /> : <IconCopy size={16} />}
              variant={copiedKey === 'payload' ? 'filled' : 'light'}
              color={copiedKey === 'payload' ? 'green' : undefined}
              onClick={() => handleCopy('payload', payload)}
            >
              {copiedKey === 'payload' ? t('nodePayloadModal.copied') : t('nodePayloadModal.copyPayload')}
            </Button>
          </Group>
        </Stack> : null}

        <Group justify="flex-end" mt="md">
          <Button onClick={onClose} variant="filled">
            {t('nodePayloadModal.iSavedIt')}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
