import React, {memo, useCallback, useMemo} from 'react';
import {ActivityIndicator, FlatList, Image, Pressable, Text, View} from 'react-native';
import {fileUrl} from '../api';
import {formatBytes, formatDate, iconFor, kindLabel, viewerKind} from '../lib/files';
import {FileIcon} from '../lib/icons';
import {radius} from '../theme';
import {Empty, Heading, Muted, useTheme} from '../ui/kit';
import type {Theme} from '../theme';
import type {DirEntry} from '../types';

const ROW_HEIGHT = 64;
const GRID_HEIGHT = 132;
const COLUMNS = 3;

/* ── rows ───────────────────────────────────────────────────── */

const ListRow = memo(function ListRow({
  item,
  selected,
  theme,
  onPress,
  onLongPress,
}: {
  item: DirEntry;
  selected: boolean;
  theme: Theme;
  onPress: (item: DirEntry) => void;
  onLongPress: (item: DirEntry) => void;
}) {
  const isImage = item.source === 'local' && viewerKind(item.ext) === 'image';
  return (
    <Pressable
      onPress={() => onPress(item)}
      onLongPress={() => onLongPress(item)}
      delayLongPress={260}
      android_ripple={{color: theme.divider}}
      style={{
        height: ROW_HEIGHT,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        paddingHorizontal: 12,
        marginBottom: 4,
        borderRadius: radius.md,
        borderWidth: 1,
        borderColor: selected ? theme.accent300 : theme.divider,
        backgroundColor: selected ? theme.accent100 : theme.raised,
      }}>
      {isImage ? (
        <Image
          source={{uri: fileUrl(item.path)}}
          style={{width: 34, height: 34, borderRadius: radius.sm, backgroundColor: theme.neutral300}}
        />
      ) : (
        <FileIcon kind={iconFor(item)} size={34} theme={theme} />
      )}
      <View style={{flex: 1}}>
        <Text
          numberOfLines={1}
          style={{color: theme.text, fontSize: 14.5, fontWeight: '600'}}>
          {item.name}
        </Text>
        <Text numberOfLines={1} style={{color: theme.neutral700, fontSize: 11.5, marginTop: 2}}>
          {kindLabel(item)} · {item.isDir ? '—' : formatBytes(item.size)} ·{' '}
          {formatDate(item.modified)}
        </Text>
      </View>
      <Text style={{color: item.source === 'local' ? theme.neutral600 : theme.accent, fontSize: 10.5, fontWeight: '700'}}>
        {item.source === 'local' ? '' : 'DRIVE'}
      </Text>
    </Pressable>
  );
});

const GridCell = memo(function GridCell({
  item,
  selected,
  theme,
  onPress,
  onLongPress,
}: {
  item: DirEntry;
  selected: boolean;
  theme: Theme;
  onPress: (item: DirEntry) => void;
  onLongPress: (item: DirEntry) => void;
}) {
  const isImage = item.source === 'local' && viewerKind(item.ext) === 'image';
  return (
    <Pressable
      onPress={() => onPress(item)}
      onLongPress={() => onLongPress(item)}
      delayLongPress={260}
      android_ripple={{color: theme.divider}}
      style={{
        flex: 1 / COLUMNS,
        height: GRID_HEIGHT,
        margin: 3,
        padding: 9,
        alignItems: 'center',
        borderRadius: radius.lg,
        borderWidth: 1,
        borderColor: selected ? theme.accent300 : theme.divider,
        backgroundColor: selected ? theme.accent100 : theme.raised,
      }}>
      <View
        style={{
          width: '100%',
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: radius.md,
          backgroundColor: theme.surface,
          overflow: 'hidden',
        }}>
        {isImage ? (
          <Image source={{uri: fileUrl(item.path)}} style={{width: '100%', height: '100%'}} />
        ) : (
          <FileIcon kind={iconFor(item)} size={42} theme={theme} />
        )}
        <Text
          style={{
            position: 'absolute',
            right: 4,
            bottom: 3,
            fontSize: 8.5,
            fontWeight: '800',
            letterSpacing: 0.4,
            color: theme.neutral600,
          }}>
          {item.isDir ? 'DIR' : item.ext.toUpperCase()}
        </Text>
      </View>
      <Text
        numberOfLines={2}
        style={{
          color: theme.text,
          fontSize: 11.5,
          textAlign: 'center',
          marginTop: 6,
          lineHeight: 14,
        }}>
        {item.name}
      </Text>
    </Pressable>
  );
});

/* ── list ───────────────────────────────────────────────────── */

export const FilesView = memo(function FilesView({
  entries,
  selected,
  view,
  busy,
  title,
  query,
  totalCount,
  source,
  footer,
  onOpen,
  onToggleSelect,
  onContext,
  onRefresh,
}: {
  entries: DirEntry[];
  selected: string[];
  view: 'grid' | 'list';
  busy: boolean;
  title: string;
  query: string;
  totalCount: number;
  source: 'local' | 'gdrive';
  footer: number;
  onOpen: (item: DirEntry) => void;
  onToggleSelect: (item: DirEntry) => void;
  onContext: (item: DirEntry) => void;
  onRefresh: () => void;
}) {
  const theme = useTheme();
  const picked = useMemo(() => new Set(selected), [selected]);
  const anySelected = selected.length > 0;

  const press = useCallback(
    (item: DirEntry) => (anySelected ? onToggleSelect(item) : onOpen(item)),
    [anySelected, onOpen, onToggleSelect],
  );

  const renderItem = useCallback(
    ({item}: {item: DirEntry}) =>
      view === 'grid' ? (
        <GridCell
          item={item}
          selected={picked.has(item.path)}
          theme={theme}
          onPress={press}
          onLongPress={onContext}
        />
      ) : (
        <ListRow
          item={item}
          selected={picked.has(item.path)}
          theme={theme}
          onPress={press}
          onLongPress={onContext}
        />
      ),
    [view, picked, theme, press, onContext],
  );

  const getItemLayout = useCallback(
    (_: ArrayLike<DirEntry> | null | undefined, index: number) => {
      const h = view === 'grid' ? GRID_HEIGHT + 6 : ROW_HEIGHT + 4;
      const row = view === 'grid' ? Math.floor(index / COLUMNS) : index;
      return {length: h, offset: h * row, index};
    },
    [view],
  );

  return (
    <FlatList
      data={entries}
      key={view}
      numColumns={view === 'grid' ? COLUMNS : 1}
      keyExtractor={keyOf}
      renderItem={renderItem}
      getItemLayout={getItemLayout}
      initialNumToRender={view === 'grid' ? 18 : 14}
      maxToRenderPerBatch={view === 'grid' ? 18 : 14}
      windowSize={7}
      removeClippedSubviews
      refreshing={busy}
      onRefresh={onRefresh}
      contentContainerStyle={{padding: 10, paddingBottom: footer + 24}}
      ListHeaderComponent={
        <View style={{paddingHorizontal: 3, paddingBottom: 10}}>
          <Heading size={20}>{query ? 'Search results' : title}</Heading>
          <Muted size={12.5}>
            {query
              ? `${entries.length} of ${totalCount} match “${query}”`
              : `${entries.length} item${entries.length === 1 ? '' : 's'}${
                  source === 'gdrive' ? ' · Google Drive' : ''
                }`}
          </Muted>
        </View>
      }
      ListEmptyComponent={
        busy ? (
          <ActivityIndicator color={theme.accent} style={{marginTop: 40}} />
        ) : (
          <Empty>Nothing here</Empty>
        )
      }
    />
  );
});

function keyOf(item: DirEntry) {
  return item.path;
}
