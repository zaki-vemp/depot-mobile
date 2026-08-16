import React, {memo} from 'react';
import {View} from 'react-native';
import {formatBytes, formatSpeed} from '../lib/files';
import {Btn, Empty, Facts, Heading, Page, Progress, RowCard, Stack, Tag, useTheme} from '../ui/kit';
import type {Transfer} from '../types';

export const TransfersView = memo(function TransfersView({
  transfers,
  footer,
  onClearFinished,
  onCancel,
}: {
  transfers: Transfer[];
  footer: number;
  onClearFinished: () => void;
  onCancel: (id: string) => void;
}) {
  const t = useTheme();

  return (
    <Page footer={footer}>
      <View style={{flexDirection: 'row', alignItems: 'center', gap: 12}}>
        <Heading size={24} style={{flex: 1}}>
          Transfers
        </Heading>
        <Btn label="Clear finished" small onPress={onClearFinished} />
      </View>

      {!transfers.length ? <Empty>No copies or downloads yet</Empty> : null}

      <Stack gap={12}>
        {transfers.map(x => {
          const pct = x.total
            ? Math.min(100, Math.round((x.moved / x.total) * 100))
            : x.state === 'done'
              ? 100
              : 0;
          const color =
            x.state === 'error' ? t.neutral500 : x.state === 'done' ? t.accent2 : t.accent;
          return (
            <RowCard key={x.id}>
              <View style={{flexDirection: 'row', alignItems: 'center', gap: 10}}>
                <Heading size={14.5} style={{flex: 1}}>
                  {x.name}
                </Heading>
                <Tag label={x.route} tone="outline" />
              </View>
              <Progress percent={pct} color={color} />
              <Facts
                items={[
                  `${pct}%`,
                  `${formatBytes(x.moved)}${x.total ? ` of ${formatBytes(x.total)}` : ''}`,
                  x.state === 'running' ? formatSpeed(x.speed) : '—',
                  x.error ? x.error : x.state,
                ]}
              />
              {x.state === 'running' || x.state === 'queued' ? (
                <Btn label="Cancel" kind="danger" small onPress={() => onCancel(x.id)} />
              ) : null}
            </RowCard>
          );
        })}
      </Stack>
    </Page>
  );
});
