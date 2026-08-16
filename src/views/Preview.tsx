import React, {memo, useEffect, useState} from 'react';
import {ActivityIndicator, Image, ScrollView, Text, View, useWindowDimensions} from 'react-native';
import {api, fileUrl} from '../api';
import {extOf, viewerKind} from '../lib/files';
import {radius} from '../theme';
import {Btn, Empty, Heading, Muted, MONO, Stack, Tag, useTheme} from '../ui/kit';
import {MediaPlayer} from './MediaPlayer';
import {OpenWithMenu} from './OpenWith';
import type {OfficePreview as OfficePreviewData, PdfPage, SourceKind} from '../types';

/** Resolves a viewable path; Drive files are cached locally first. */
function useLocalCopy(path: string, source: SourceKind, title: string, onError: (m: string) => void) {
  const [local, setLocal] = useState(source === 'gdrive' ? '' : path);

  useEffect(() => {
    if (source !== 'gdrive') {
      setLocal(path);
      return;
    }
    let alive = true;
    setLocal('');
    api
      .cacheDrive(path, title)
      .then(p => alive && setLocal(p))
      .catch(e => alive && onError(e instanceof Error ? e.message : String(e)));
    return () => {
      alive = false;
    };
    // onError is a stable setter in App.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, source, title]);

  return local;
}

export const PreviewPane = memo(function PreviewPane({
  title,
  path,
  source,
  onError,
}: {
  title: string;
  path: string;
  source: SourceKind;
  onError: (message: string) => void;
}) {
  const t = useTheme();
  const ext = extOf(title);
  const kind = viewerKind(ext);
  const local = useLocalCopy(path, source, title, onError);

  if (!local) {
    return (
      <View style={{flex: 1, alignItems: 'center', justifyContent: 'center'}}>
        <ActivityIndicator color={t.accent} />
      </View>
    );
  }

  if (kind === 'video' || kind === 'audio') {
    return <MediaPlayer title={title} path={local} kind={kind} onError={onError} />;
  }

  if (kind === 'spreadsheet' || kind === 'document' || kind === 'slides') {
    return <OfficePane title={title} path={local} onError={onError} />;
  }

  return (
    <View style={{flex: 1, backgroundColor: t.bg}}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 10,
          paddingHorizontal: 14,
          paddingVertical: 10,
          borderBottomWidth: 1,
          borderBottomColor: t.divider,
        }}>
        <Heading size={15} style={{flex: 1}}>
          {title}
        </Heading>
        <OpenWithMenu path={local} onError={onError} />
      </View>

      {kind === 'image' ? (
        <Image
          source={{uri: fileUrl(local)}}
          style={{flex: 1, margin: 10, borderRadius: radius.md}}
          resizeMode="contain"
        />
      ) : kind === 'pdf' ? (
        <PdfPane path={local} onError={onError} />
      ) : kind === 'text' ? (
        <TextPane path={local} onError={onError} />
      ) : (
        <View style={{flex: 1, justifyContent: 'center', paddingHorizontal: 24, gap: 14}}>
          <Empty>No built-in preview for this file type</Empty>
          <OpenWithMenu path={local} onError={onError} variant="button" />
        </View>
      )}
    </View>
  );
});

/* ── text ───────────────────────────────────────────────────── */

const TextPane = memo(function TextPane({
  path,
  onError,
}: {
  path: string;
  onError: (m: string) => void;
}) {
  const t = useTheme();
  const [body, setBody] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    api
      .readText(path)
      .then(v => alive && setBody(v))
      .catch(e => {
        if (alive) {
          setBody('');
          onError(e instanceof Error ? e.message : String(e));
        }
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);

  if (body === null) {
    return (
      <View style={{flex: 1, alignItems: 'center', justifyContent: 'center'}}>
        <ActivityIndicator color={t.accent} />
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={{padding: 14}} horizontal={false}>
      <ScrollView horizontal showsHorizontalScrollIndicator>
        <Text selectable style={{color: t.text, fontFamily: MONO, fontSize: 12.5, lineHeight: 18}}>
          {body}
        </Text>
      </ScrollView>
    </ScrollView>
  );
});

/* ── pdf ────────────────────────────────────────────────────── */

const PAGE_BATCH = 6;

const PdfPane = memo(function PdfPane({
  path,
  onError,
}: {
  path: string;
  onError: (m: string) => void;
}) {
  const t = useTheme();
  const {width} = useWindowDimensions();
  const [pages, setPages] = useState<PdfPage[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  const loadFrom = React.useCallback(
    async (from: number) => {
      try {
        const res = await api.renderPdf(path, from, PAGE_BATCH);
        setTotal(res.total);
        setPages(prev => (from === 0 ? res.pages : [...prev, ...res.pages]));
      } catch (e) {
        onError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [path],
  );

  useEffect(() => {
    setPages([]);
    setLoading(true);
    void loadFrom(0);
  }, [loadFrom]);

  const frame = width - 20;

  return (
    <ScrollView
      contentContainerStyle={{padding: 10, gap: 10}}
      onMomentumScrollEnd={() => {
        if (pages.length < total && !loading) {
          setLoading(true);
          void loadFrom(pages.length);
        }
      }}>
      {pages.map(p => (
        <Image
          key={p.index}
          source={{uri: p.uri}}
          style={{
            width: frame,
            height: (frame * p.height) / Math.max(1, p.width),
            borderRadius: radius.sm,
            backgroundColor: '#fff',
          }}
          resizeMode="contain"
        />
      ))}
      {loading ? <ActivityIndicator color={t.accent} style={{marginVertical: 20}} /> : null}
      {!loading && pages.length < total ? (
        <Btn label={`Load more — ${pages.length} of ${total}`} block onPress={() => loadFrom(pages.length)} />
      ) : null}
    </ScrollView>
  );
});

/* ── office ─────────────────────────────────────────────────── */

const OfficePane = memo(function OfficePane({
  title,
  path,
  onError,
}: {
  title: string;
  path: string;
  onError: (m: string) => void;
}) {
  const t = useTheme();
  const [data, setData] = useState<OfficePreviewData | null>(null);
  const [failed, setFailed] = useState(false);
  const [sheet, setSheet] = useState(0);

  useEffect(() => {
    let alive = true;
    api
      .previewOffice(path)
      .then(v => alive && setData(v))
      .catch(e => {
        if (alive) {
          setFailed(true);
          onError(e instanceof Error ? e.message : String(e));
        }
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);

  if (failed) {
    return (
      <View style={{flex: 1, justifyContent: 'center', paddingHorizontal: 24, gap: 14}}>
        <Empty>This document could not be read in Depot</Empty>
        <OpenWithMenu path={path} onError={onError} variant="button" />
      </View>
    );
  }

  if (!data) {
    return (
      <View style={{flex: 1, alignItems: 'center', justifyContent: 'center'}}>
        <ActivityIndicator color={t.accent} />
      </View>
    );
  }

  const active = data.sheets[sheet];

  return (
    <View style={{flex: 1, backgroundColor: t.bg}}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 10,
          paddingHorizontal: 14,
          paddingVertical: 10,
          borderBottomWidth: 1,
          borderBottomColor: t.divider,
        }}>
        <Heading size={15} style={{flex: 1}}>
          {title}
        </Heading>
        {data.truncated ? <Tag label="Truncated" tone="outline" /> : null}
        <OpenWithMenu path={path} onError={onError} />
      </View>

      {data.kind === 'spreadsheet' ? (
        <>
          {data.sheets.length > 1 ? (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{padding: 10, gap: 8}}>
              {data.sheets.map((s, i) => (
                <Btn
                  key={s.name + i}
                  label={s.name}
                  small
                  kind={i === sheet ? 'primary' : 'secondary'}
                  onPress={() => setSheet(i)}
                />
              ))}
            </ScrollView>
          ) : null}
          <ScrollView horizontal>
            <ScrollView contentContainerStyle={{padding: 10}}>
              {active?.rows.map((row, r) => (
                <View key={r} style={{flexDirection: 'row'}}>
                  {row.map((cell, c) => (
                    <View
                      key={c}
                      style={{
                        width: 132,
                        paddingHorizontal: 9,
                        paddingVertical: 7,
                        borderWidth: 0.5,
                        borderColor: t.divider,
                        backgroundColor: r === 0 ? t.surface : t.raised,
                      }}>
                      <Text
                        numberOfLines={2}
                        style={{
                          color: t.text,
                          fontSize: 12,
                          fontWeight: r === 0 ? '700' : '400',
                        }}>
                        {cell}
                      </Text>
                    </View>
                  ))}
                </View>
              ))}
            </ScrollView>
          </ScrollView>
        </>
      ) : (
        <ScrollView contentContainerStyle={{padding: 16}}>
          <Stack gap={20}>
            {data.pages.map((p, i) => (
              <View key={i} style={{gap: 8}}>
                {p.title ? <Heading size={16}>{p.title}</Heading> : null}
                <Text selectable style={{color: t.text, fontSize: 14, lineHeight: 21}}>
                  {p.body}
                </Text>
              </View>
            ))}
          </Stack>
        </ScrollView>
      )}

      {data.note ? (
        <View style={{padding: 12, borderTopWidth: 1, borderTopColor: t.divider}}>
          <Muted size={11.5}>{data.note}</Muted>
        </View>
      ) : null}
    </View>
  );
});
