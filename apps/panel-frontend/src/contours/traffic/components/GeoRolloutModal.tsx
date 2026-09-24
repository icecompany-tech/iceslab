import { useTranslation } from 'react-i18next';
import { Box, Button, Group, Modal, Stack, Text } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiErrorMessage } from '@/lib/net/client';
import {
  geoSetRefusal,
  getGeoRolloutPlan,
  rolloutGeoSet,
  type GeoSet,
} from '@/lib/domain/geoSets';
import { geoRolloutFacts, usesWords } from '@/contours/traffic/lib/geoFacts';
import { AMBER, DIM, DISPLAY, FAINT, HAIRLINE, MIST, MONO, RED, SNOW, WELL } from '@/contours/traffic/lib/colors';

/**
 * «Разослать на ноды» (geo-contract §7). Сперва план сервера, потом кнопка.
 *
 * Замена `.dat` это рестарт xray с разрывом сессий: окно называет число нод с
 * рестартом и их имена ДО кнопки. Ссылки правил на теги, которых в новой версии
 * нет (`breaks`), запрещают кнопку, и окно называет эти правила. План мог
 * устареть, пока окно было открыто: 409 GEO_ROLLOUT_STALE перечитывает план и
 * говорит об этом, а не шлёт другую версию молча.
 */
export function GeoRolloutModal({ set, onClose }: { set: GeoSet | null; onClose: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const planQuery = useQuery({
    queryKey: ['geo-rollout-plan', set?.id],
    queryFn: () => getGeoRolloutPlan(set!.id),
    enabled: set !== null,
  });
  const facts = planQuery.data ? geoRolloutFacts(planQuery.data) : null;

  const rollout = useMutation({
    mutationFn: (version: string) => rolloutGeoSet(set!.id, version),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['geo-sets'] });
      qc.invalidateQueries({ queryKey: ['nodes'] });
      notifications.show({ color: 'green', message: t('geoSets.rollout.sent', { count: r.nodes }) });
      onClose();
    },
    onError: (err) => {
      const r = geoSetRefusal(err);
      if (r?.code === 'GEO_ROLLOUT_STALE' || r?.code === 'GEO_ROLLOUT_BREAKS') {
        planQuery.refetch();
        notifications.show({
          color: 'yellow',
          title: t('geoSets.rollout.failed'),
          message: r.code === 'GEO_ROLLOUT_STALE' ? t('geoSets.rollout.stale') : t('geoSets.rollout.breaksNow'),
        });
        return;
      }
      notifications.show({ color: 'red', title: t('geoSets.rollout.failed'), message: apiErrorMessage(err) });
    },
  });

  return (
    <Modal
      opened={set !== null}
      onClose={onClose}
      size="lg"
      title={<Text fw={600}>{t('geoSets.rollout.title', { name: set?.name ?? '' })}</Text>}
    >
      <Stack gap="sm">
        {planQuery.isLoading && <Text size="sm" c="dimmed">{t('geoSets.rollout.loading')}</Text>}
        {planQuery.isError && (
          <Text size="sm" c="red">
            {apiErrorMessage(planQuery.error)}
          </Text>
        )}

        {facts && planQuery.data && (
          <>
            <Text style={{ fontFamily: DISPLAY, fontSize: 13, lineHeight: '19px', color: SNOW }}>
              {t('geoSets.rollout.version', { version: facts.version })}
            </Text>

            {/* Что оборвётся: до кнопки, именами. */}
            {facts.restarts.length > 0 && (
              <Box style={{ padding: '10px 12px', borderRadius: 8, border: `1px solid ${AMBER}55`, backgroundColor: `${AMBER}12` }}>
                <Text style={{ fontFamily: DISPLAY, fontSize: 12, lineHeight: '18px', color: AMBER }}>
                  {t('geoSets.rollout.restarts', { count: facts.restarts.length, names: facts.restarts.join(', ') })}
                </Text>
              </Box>
            )}

            {facts.sending.length > 0 ? (
              <Stack gap={0} style={{ borderRadius: 8, border: `1px solid ${HAIRLINE}`, backgroundColor: WELL }}>
                {facts.sending.map((n, i) => (
                  <Box
                    key={n.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      padding: '8px 12px',
                      borderTop: i === 0 ? undefined : `1px solid ${HAIRLINE}`,
                    }}
                  >
                    <Text style={{ fontFamily: DISPLAY, fontSize: 12, color: SNOW, width: 160, flexShrink: 0 }}>
                      {n.name}
                    </Text>
                    <Text style={{ fontFamily: MONO, fontSize: 11, color: MIST, flex: 1 }}>
                      {(n.from ?? t('geoSets.rollout.noPin')) + ' → ' + facts.version}
                    </Text>
                    <Text style={{ fontFamily: MONO, fontSize: 10, color: FAINT }}>
                      {t('geoSets.rollout.files', { count: n.filesToSend.length })}
                    </Text>
                    {n.restartsXray && (
                      <Text style={{ fontFamily: MONO, fontSize: 10, color: AMBER }}>{t('geoSets.rollout.xray')}</Text>
                    )}
                  </Box>
                ))}
              </Stack>
            ) : (
              <Text size="sm" style={{ color: DIM }}>
                {t('geoSets.rollout.nothing')}
              </Text>
            )}
            {facts.unchanged > 0 && (
              <Text style={{ fontFamily: DISPLAY, fontSize: 11, color: FAINT }}>
                {t('geoSets.rollout.unchanged', { count: facts.unchanged })}
              </Text>
            )}

            {/* Правила, которые новая версия сломает: кнопки нет, пока они есть. */}
            {facts.blocked && (
              <Box style={{ padding: '10px 12px', borderRadius: 8, border: `1px solid ${RED}55`, backgroundColor: `${RED}12` }}>
                <Text style={{ fontFamily: DISPLAY, fontSize: 12, lineHeight: '18px', color: RED, marginBottom: 6 }}>
                  {t('geoSets.rollout.breaks')}
                </Text>
                {planQuery.data.breaks.map((b) => (
                  <Text key={b.entry} style={{ fontFamily: MONO, fontSize: 11, lineHeight: '17px', color: SNOW }}>
                    {b.entry}
                    <span style={{ color: MIST, fontFamily: DISPLAY }}> · {usesWords(b.uses, t)}</span>
                  </Text>
                ))}
              </Box>
            )}
          </>
        )}

        <Group justify="flex-end" gap="sm">
          <Button variant="default" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            color="orange"
            loading={rollout.isPending}
            disabled={!facts || facts.blocked || facts.sending.length === 0}
            title={facts?.blocked ? t('geoSets.rollout.blockedHint') : undefined}
            onClick={() => facts && rollout.mutate(facts.version)}
          >
            {t('geoSets.rollout.confirm')}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
