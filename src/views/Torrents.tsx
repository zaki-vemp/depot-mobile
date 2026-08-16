import React, {memo, useState} from 'react';
import {View} from 'react-native';
import {formatBytes, formatSpeed} from '../lib/files';
import {
  Btn,
  Empty,
  Facts,
  Field,
  Heading,
  Notice,
  Page,
  Progress,
  RowCard,
  Stack,
  Tag,
  useTheme,
} from '../ui/kit';
import type {TorrentInfo} from '../types';

export const TorrentsView = memo(function TorrentsView({
  torrents,
  footer,
  busy,
  onAdd,
  onPause,
  onResume,
  onRemove,
  onOpenFolder,
}: {
  torrents: TorrentInfo[];
  footer: number;
  busy: boolean;
  onAdd: (magnet: string) => Promise<void>;
  onPause: (id: number) => void;
  onResume: (id: number) => void;
  onRemove: (id: number) => void;
  onOpenFolder: (path: string) => void;
}) {
  const t = useTheme();
  const [magnet, setMagnet] = useState('');

  const submit = async () => {
    const value = magnet.trim();
    if (!value) {
      return;
    }
    await onAdd(value);
    setMagnet('');
  };

  return (
    <Page footer={footer}>
      <Stack gap={12}>
        <Field
          label="Magnet link, .torrent URL or local file"
          value={magnet}
          onChangeText={setMagnet}
          placeholder="magnet:?xt=urn:btih:…"
          keyboardType="url"
          onSubmitEditing={() => void submit()}
        />
        <Btn
          label={busy ? 'Adding…' : 'Add download'}
          kind="primary"
          block
          disabled={!magnet.trim() || busy}
          onPress={() => void submit()}
        />
      </Stack>

      <Notice>
        Downloads only for content you hold the rights to. Depot ships no search or indexer — you
        supply the link.
      </Notice>

      {!torrents.length ? <Empty>No downloads yet</Empty> : null}

      <Stack gap={12}>
        {torrents.map(x => {
          const pct = Math.round(x.progress * 100);
          const done = x.progress >= 1;
          return (
            <RowCard key={x.id}>
              <View style={{flexDirection: 'row', alignItems: 'center', gap: 10}}>
                <Heading size={14.5} style={{flex: 1}}>
                  {x.name}
                </Heading>
                <Tag
                  label={x.error ? 'Error' : done ? 'Complete' : x.state}
                  tone={x.error ? 'danger' : done ? 'accent2' : 'accent'}
                />
              </View>
              <Progress percent={pct} color={done ? t.accent2 : t.accent} />
              <Facts
                items={[
                  `${pct}%`,
                  `${formatBytes(x.downloaded)} of ${formatBytes(x.total)}`,
                  `↓ ${formatSpeed(x.downloadSpeed)}`,
                  x.error || '',
                ]}
              />
              <View style={{flexDirection: 'row', gap: 8, flexWrap: 'wrap'}}>
                <Btn label="Pause" small onPress={() => onPause(x.id)} />
                <Btn label="Resume" small onPress={() => onResume(x.id)} />
                <Btn label="Show folder" small onPress={() => onOpenFolder(x.outputFolder)} />
                <Btn label="Remove" kind="danger" small onPress={() => onRemove(x.id)} />
              </View>
            </RowCard>
          );
        })}
      </Stack>
    </Page>
  );
});
