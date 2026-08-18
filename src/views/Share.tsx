import React, {memo} from 'react';
import {Text, View} from 'react-native';
import {formatBytes} from '../lib/files';
import {Icon} from '../lib/icons';
import {radius} from '../theme';
import {
  Btn,
  Empty,
  Facts,
  Heading,
  Muted,
  Notice,
  Page,
  Progress,
  RowCard,
  Stack,
  Tag,
  Toggle,
  useTheme,
} from '../ui/kit';
import type {ShareJob, SharePeer, ShareStatus} from '../types';

/**
 * Devices running Depot on the same network, and whatever is moving between
 * them. Files are picked from the file list — long-press anything and choose
 * "Send to a nearby device" — so this screen is the radar and the progress
 * board rather than a second file picker.
 */
export const ShareView = memo(function ShareView({
  status,
  peers,
  jobs,
  footer,
  onToggle,
  onOpenFolder,
  onClearFinished,
}: {
  status: ShareStatus;
  peers: SharePeer[];
  jobs: ShareJob[];
  footer: number;
  onToggle: (on: boolean) => void;
  onOpenFolder: (path: string) => void;
  onClearFinished: () => void;
}) {
  const t = useTheme();
  const active = jobs.filter(j => j.state === 'running');

  return (
    <Page footer={footer}>
      <Stack gap={12}>
        <Toggle
          label={status.running ? 'Visible on this network' : 'Nearby sharing is off'}
          on={status.running}
          onPress={() => onToggle(!status.running)}
        />
        {status.running ? (
          <Muted size={12}>
            Other devices see this one as “{status.name}”. Leave this screen if you like — sharing
            keeps running until you switch it off.
          </Muted>
        ) : (
          <Muted size={12}>
            Turn this on to find other phones running Depot on the same Wi-Fi.
          </Muted>
        )}
      </Stack>

      <Notice>
        Files travel across your local network without encryption, and anyone on that network could
        read them in transit. Use it on networks you trust. Nothing is ever written to a device
        until the person holding it accepts.
      </Notice>

      <Stack gap={12}>
        <Heading size={16}>Nearby devices</Heading>
        {!status.running ? (
          <Empty>Sharing is off</Empty>
        ) : !peers.length ? (
          <Empty>
            Looking for devices — open Depot on the other phone and turn its sharing on too
          </Empty>
        ) : (
          peers.map(peer => (
            <View
              key={peer.id}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 12,
                padding: 13,
                borderRadius: radius.lg,
                backgroundColor: t.raised,
                borderWidth: 1,
                borderColor: t.divider,
              }}>
              <View
                style={{
                  width: 34,
                  height: 34,
                  borderRadius: radius.md,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: t.accent100,
                }}>
                <Icon name="net" size={17} color={t.accent} />
              </View>
              <View style={{flex: 1}}>
                <Text style={{color: t.text, fontSize: 14.5, fontWeight: '600'}} numberOfLines={1}>
                  {peer.name}
                </Text>
                <Muted size={11.5}>{peer.host}</Muted>
              </View>
              <Tag label="Ready" tone="accent2" />
            </View>
          ))
        )}
        {status.running && peers.length ? (
          <Muted size={11.5}>
            To send something, long-press a file or folder in the file list and choose “Send to a
            nearby device”.
          </Muted>
        ) : null}
      </Stack>

      <Stack gap={12}>
        <View style={{flexDirection: 'row', alignItems: 'center', gap: 10}}>
          <Heading size={16} style={{flex: 1}}>
            Transfers
          </Heading>
          {jobs.length > active.length ? (
            <Btn label="Clear finished" small onPress={onClearFinished} />
          ) : null}
        </View>

        {!jobs.length ? <Empty>Nothing sent or received yet</Empty> : null}

        {jobs.map(job => {
          const pct = job.total ? Math.round((job.moved / job.total) * 100) : 0;
          return (
            <RowCard key={job.id}>
              <View style={{flexDirection: 'row', alignItems: 'center', gap: 10}}>
                <Icon
                  name={job.direction === 'in' ? 'download' : 'share'}
                  size={16}
                  color={t.neutral700}
                />
                <Heading size={14.5} style={{flex: 1}}>
                  {job.name}
                </Heading>
                <Tag
                  label={
                    job.state === 'error'
                      ? 'Error'
                      : job.state === 'declined'
                        ? 'Declined'
                        : job.state === 'done'
                          ? 'Complete'
                          : `${pct}%`
                  }
                  tone={
                    job.state === 'error'
                      ? 'danger'
                      : job.state === 'done'
                        ? 'accent2'
                        : job.state === 'declined'
                          ? 'outline'
                          : 'accent'
                  }
                />
              </View>
              {job.state === 'running' ? <Progress percent={pct} /> : null}
              <Facts
                items={[
                  job.direction === 'in' ? 'Incoming' : 'Outgoing',
                  `${formatBytes(job.moved)} of ${formatBytes(job.total)}`,
                  job.error || '',
                ]}
              />
              {job.folder ? (
                <View style={{flexDirection: 'row'}}>
                  <Btn label="Show folder" small onPress={() => onOpenFolder(job.folder as string)} />
                </View>
              ) : null}
            </RowCard>
          );
        })}
      </Stack>
    </Page>
  );
});
