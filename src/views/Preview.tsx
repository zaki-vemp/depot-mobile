import React, {memo, useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {
  ActivityIndicator,
  Image,
  Modal,
  PanResponder,
  Pressable,
  ScrollView,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import {api, fileUrl} from '../api';
import {extOf, viewerKind} from '../lib/files';
import {radius} from '../theme';
import {Btn, Divider, Empty, Heading, IconBtn, Muted, MONO, Stack, Tag, useTheme} from '../ui/kit';
import {MediaPlayer} from './MediaPlayer';
import {OpenWithMenu} from './OpenWith';
import type {
  DirEntry,
  OcrResult,
  OfficePreview as OfficePreviewData,
  PdfPage,
  SourceKind,
} from '../types';

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
  onEdit,
  playlist,
  onChangeMedia,
  onClose,
  canPlay,
}: {
  title: string;
  path: string;
  source: SourceKind;
  onError: (message: string) => void;
  onEdit?: () => void;
  /** Media siblings of the folder this file was opened from. */
  playlist?: DirEntry[];
  onChangeMedia?: (entry: DirEntry) => void;
  onClose?: () => void;
  /** False while another audio tab owns playback. */
  canPlay?: boolean;
}) {
  const t = useTheme();
  const ext = extOf(title);
  const kind = viewerKind(ext);
  const local = useLocalCopy(path, source, title, onError);
  // The queue is keyed on the original path; `local` may be a Drive cache copy.
  const index = playlist ? playlist.findIndex(e => e.path === path) : -1;
  const [ocrFor, setOcrFor] = useState<string | null>(null);

  if (!local) {
    return (
      <View style={{flex: 1, alignItems: 'center', justifyContent: 'center'}}>
        <ActivityIndicator color={t.accent} />
      </View>
    );
  }

  if (kind === 'video' || kind === 'audio') {
    return (
      <MediaPlayer
        title={title}
        path={local}
        kind={kind}
        onError={onError}
        playlist={playlist}
        index={index}
        onChangeMedia={onChangeMedia}
        onClose={onClose}
        canPlay={canPlay}
      />
    );
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
        <Heading size={15} numberOfLines={1} style={{flex: 1}}>
          {title}
        </Heading>
        {kind === 'image' && index >= 0 && (playlist?.length ?? 0) > 1 ? (
          <Tag label={`${index + 1} / ${playlist?.length}`} tone="outline" />
        ) : null}
        {kind === 'image' ? (
          <Btn label="Text" icon="doc" small onPress={() => setOcrFor(local)} />
        ) : null}
        {onEdit && kind === 'text' ? (
          <Btn label="Edit" small onPress={onEdit} />
        ) : null}
        <OpenWithMenu path={local} onError={onError} />
      </View>

      {kind === 'image' ? (
        <ImagePane
          path={local}
          playlist={playlist}
          index={index}
          onChangeMedia={onChangeMedia}
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

      {ocrFor ? (
        <OcrSheet
          path={ocrFor}
          title={title}
          canSave={source === 'local'}
          onError={onError}
          onClose={() => setOcrFor(null)}
        />
      ) : null}
    </View>
  );
});

/* ── text in pictures ───────────────────────────────────────── */

/**
 * On-device OCR over the picture on screen. A file manager is full of text that
 * is only pixels — receipts, whiteboards, screenshots of errors — and the point
 * is to get it back as something you can select, copy, or keep beside the image
 * as a real `.txt` the search index can see.
 */
const OcrSheet = memo(function OcrSheet({
  path,
  title,
  canSave,
  onError,
  onClose,
}: {
  path: string;
  title: string;
  /** A Drive image is read from a cache copy, so there is nowhere to put a sibling. */
  canSave: boolean;
  onError: (m: string) => void;
  onClose: () => void;
}) {
  const t = useTheme();
  const [result, setResult] = useState<OcrResult | null>(null);
  const [failed, setFailed] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setResult(null);
    setFailed(false);
    api
      .ocrImage(path)
      .then(r => alive && setResult(r))
      .catch(e => {
        if (!alive) return;
        setFailed(true);
        onError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);

  const text = result?.text ?? '';

  const save = async () => {
    // Beside the image, under the same name, so the pair stays together.
    const target = `${path.replace(/\.[^.]+$/, '')}.txt`;
    try {
      await api.writeText(target, text);
      setSaved(target);
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <Pressable onPress={onClose} style={{flex: 1, backgroundColor: t.scrim, justifyContent: 'flex-end'}}>
        <Pressable
          onPress={() => undefined}
          style={{
            backgroundColor: t.bg,
            borderTopLeftRadius: 18,
            borderTopRightRadius: 18,
            paddingTop: 14,
            maxHeight: '80%',
          }}>
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 10,
              paddingHorizontal: 16,
              paddingBottom: 12,
            }}>
            <View style={{flex: 1}}>
              <Heading size={15}>Text in this picture</Heading>
              <Muted size={11.5} numberOfLines={1}>
                {title}
              </Muted>
            </View>
            <IconBtn icon="close" label="Close" onPress={onClose} />
          </View>
          <Divider />

          {!result && !failed ? (
            <View style={{padding: 40, alignItems: 'center', gap: 12}}>
              <ActivityIndicator color={t.accent} />
              <Muted size={12}>Reading…</Muted>
            </View>
          ) : failed ? (
            <Empty>That picture could not be read</Empty>
          ) : !text.trim() ? (
            <Empty>No text found in this picture</Empty>
          ) : (
            <ScrollView contentContainerStyle={{padding: 16}}>
              <Text selectable style={{color: t.text, fontSize: 14, lineHeight: 21}}>
                {text}
              </Text>
            </ScrollView>
          )}

          {text.trim() ? (
            <View style={{padding: 14, gap: 10, borderTopWidth: 1, borderTopColor: t.divider}}>
              {saved ? <Muted size={11.5}>Saved to {saved}</Muted> : null}
              <View style={{flexDirection: 'row', gap: 8}}>
                <Btn
                  label="Copy"
                  icon="copy"
                  small
                  onPress={() => void api.setClipboard(text).catch(e => onError(String(e)))}
                />
                {canSave ? (
                  <Btn
                    label="Save as .txt"
                    icon="doc"
                    small
                    kind="primary"
                    onPress={() => void save()}
                  />
                ) : (
                  <Muted size={11.5} style={{alignSelf: 'center'}}>
                    Copy this file locally to save the text beside it
                  </Muted>
                )}
              </View>
            </View>
          ) : null}
        </Pressable>
      </Pressable>
    </Modal>
  );
});

/* ── images ─────────────────────────────────────────────────── */

/** Below this a two-finger gesture is still noise rather than a pinch. */
const PINCH_SLOP = 12;
/** How far a one-finger drag has to travel to count as a swipe between photos. */
const SWIPE_IMAGE = 70;
const MAX_ZOOM = 4;

function distance(touches: readonly {pageX: number; pageY: number}[]) {
  const dx = touches[0].pageX - touches[1].pageX;
  const dy = touches[0].pageY - touches[1].pageY;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * A folder of photos read as a gallery: swipe or tap the edges to move between
 * siblings, pinch or double-tap to zoom, drag to pan once zoomed. No gesture
 * package is installed, so this is `PanResponder` and plain maths.
 */
const ImagePane = memo(function ImagePane({
  path,
  playlist,
  index,
  onChangeMedia,
}: {
  path: string;
  playlist?: DirEntry[];
  index: number;
  onChangeMedia?: (entry: DirEntry) => void;
}) {
  const t = useTheme();
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({x: 0, y: 0});

  const queued = !!playlist && playlist.length > 1 && index >= 0 && !!onChangeMedia;
  const hasPrev = queued && index > 0;
  const hasNext = queued && index < (playlist?.length ?? 0) - 1;

  const step = useCallback(
    (delta: number) => {
      if (!playlist || !onChangeMedia || index < 0) return;
      const entry = playlist[index + delta];
      if (entry) onChangeMedia(entry);
    },
    [index, onChangeMedia, playlist],
  );

  // A new photo always starts unzoomed.
  useEffect(() => {
    setZoom(1);
    setOffset({x: 0, y: 0});
  }, [path]);

  const g = useRef({
    zoom: 1,
    offset: {x: 0, y: 0},
    pinch: 0,
    lastTap: 0,
    mode: 'none' as 'none' | 'pan' | 'pinch',
  }).current;

  const pan = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: (_, s) => Math.abs(s.dx) > 6 || Math.abs(s.dy) > 6,
        onPanResponderGrant: () => {
          g.zoom = zoom;
          g.offset = offset;
          g.pinch = 0;
          g.mode = 'none';
        },
        onPanResponderMove: (e, s) => {
          const touches = e.nativeEvent.touches;
          if (touches.length >= 2) {
            const span = distance(touches);
            if (!g.pinch) {
              if (span < PINCH_SLOP) return;
              g.pinch = span;
              g.mode = 'pinch';
              return;
            }
            setZoom(Math.max(1, Math.min(MAX_ZOOM, (g.zoom * span) / g.pinch)));
            return;
          }
          if (g.mode === 'pinch') return;
          // One finger pans only when there is something to pan.
          if (g.zoom > 1) {
            g.mode = 'pan';
            setOffset({x: g.offset.x + s.dx, y: g.offset.y + s.dy});
          }
        },
        onPanResponderRelease: (_, s) => {
          if (g.mode === 'pinch') {
            if (zoom <= 1.02) setOffset({x: 0, y: 0});
            return;
          }
          if (g.mode === 'pan') return;
          if (g.zoom === 1 && Math.abs(s.dx) > SWIPE_IMAGE && Math.abs(s.dx) > Math.abs(s.dy)) {
            step(s.dx < 0 ? 1 : -1);
            return;
          }
          const now = Date.now();
          if (now - g.lastTap < 280) {
            g.lastTap = 0;
            setZoom(z => (z > 1 ? 1 : 2.5));
            setOffset({x: 0, y: 0});
            return;
          }
          g.lastTap = now;
        },
      }),
    [g, offset, step, zoom],
  );

  return (
    <View style={{flex: 1}}>
      <View {...pan.panHandlers} style={{flex: 1, overflow: 'hidden'}}>
        <Image
          source={{uri: fileUrl(path)}}
          style={{
            flex: 1,
            margin: 10,
            borderRadius: radius.md,
            transform: [{translateX: offset.x}, {translateY: offset.y}, {scale: zoom}],
          }}
          resizeMode="contain"
        />
      </View>

      {queued && zoom === 1 ? (
        <View
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            top: '50%',
            marginTop: -20,
            flexDirection: 'row',
            justifyContent: 'space-between',
            paddingHorizontal: 4,
          }}>
          <IconBtn
            icon="back"
            label="Previous image"
            disabled={!hasPrev}
            color={t.neutral700}
            onPress={() => step(-1)}
          />
          <IconBtn
            icon="forward"
            label="Next image"
            disabled={!hasNext}
            color={t.neutral700}
            onPress={() => step(1)}
          />
        </View>
      ) : null}

      {queued && playlist?.[0]?.source === 'local' ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{gap: 6, paddingHorizontal: 10, paddingBottom: 10}}
          // Explicit: a horizontal ScrollView deriving its height from content
          // makes the picture above it resize as thumbnails load.
          style={{height: 72, flexGrow: 0, flexShrink: 0}}>
          {playlist?.map((entry, i) => (
            <Pressable
              key={entry.path}
              onPress={() => i !== index && onChangeMedia?.(entry)}
              accessibilityLabel={entry.name}
              style={{
                borderRadius: radius.sm,
                borderWidth: 2,
                borderColor: i === index ? t.accent : 'transparent',
                overflow: 'hidden',
              }}>
              <Image
                source={{uri: fileUrl(entry.path)}}
                style={{width: 52, height: 52, backgroundColor: t.neutral300}}
                resizeMode="cover"
              />
            </Pressable>
          ))}
        </ScrollView>
      ) : null}
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
        <Heading size={15} numberOfLines={1} style={{flex: 1}}>
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
