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
} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import Video, {
  SelectedTrackType,
  TextTrackType,
  type ISO639_1,
  type TextTracks,
  type VideoRef,
} from 'react-native-video';
import {api, baseName, fileUrl, parentDir} from '../api';
import {extOf, formatDuration, viewerKind} from '../lib/files';
import {Icon, type IconName} from '../lib/icons';
import {radius} from '../theme';
import {Btn, IconBtn, useTheme} from '../ui/kit';
import type {DirEntry, RepeatMode, SubtitleTrack} from '../types';

const RATES = [0.5, 0.75, 1, 1.25, 1.5, 2];

/** Formats media3 can sideload from a file next to the movie. */
const SIDECAR: Record<string, TextTrackType> = {
  srt: TextTrackType.SUBRIP,
  vtt: TextTrackType.VTT,
};

/** Basenames worth treating as folder art when nothing matches the track. */
const COVER = /^(cover|folder|album|front|artwork)$/;

const NO_PLAYLIST: DirEntry[] = [];

/** Two taps closer together than this on the same side count as a double tap. */
const DOUBLE_TAP_MS = 280;
/** How far a horizontal drag has to travel before it changes track. */
const SWIPE_TRACK = 70;
/** Below this the gesture is still undecided between a tap and a drag. */
const SLOP = 10;

const OVERLAY = 'rgba(0,0,0,0.55)';
const TRACK = 'rgba(255,255,255,0.26)';
const BUFFERED = 'rgba(255,255,255,0.42)';

function stemOf(name: string) {
  return name.replace(/\.[^.]+$/, '').toLowerCase();
}

type Sheet = 'rate' | 'subs' | 'queue' | 'more' | null;
type Adjust = {kind: 'volume' | 'brightness'; value: number} | null;

/**
 * The desktop player's HUD over an ExoPlayer surface, grown into a phone
 * player: a folder queue with next/prev, repeat and shuffle, drag gestures for
 * seek, volume and brightness, resume points, picture-in-picture, and — for
 * audio — background playback with a real media notification.
 *
 * Subtitles work the way they always have: sidecar `.srt`/`.vtt` files beside
 * the movie plus whatever tracks the container carries.
 */
export const MediaPlayer = memo(function MediaPlayer({
  title,
  path,
  kind,
  onError,
  playlist = NO_PLAYLIST,
  index = -1,
  onChangeMedia,
  onClose,
  canPlay = true,
}: {
  title: string;
  path: string;
  kind: 'video' | 'audio';
  onError: (message: string) => void;
  /** Media siblings of the folder this file was opened from. */
  playlist?: DirEntry[];
  /** Position of the playing file inside `playlist`, or -1 when it has none. */
  index?: number;
  onChangeMedia?: (entry: DirEntry) => void;
  onClose?: () => void;
  /**
   * Audio tabs stay mounted so playback survives a switch back to the file
   * list, which means several players can exist at once. Only the one holding
   * the audio may sound; the rest keep their position and resume when they get
   * it back.
   */
  canPlay?: boolean;
}) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const ref = useRef<VideoRef>(null);

  const [playing, setPlaying] = useState(canPlay);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [buffered, setBuffered] = useState(0);
  const [busy, setBusy] = useState(false);
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(1);
  const [repeat, setRepeat] = useState<RepeatMode>('off');
  const [shuffle, setShuffle] = useState(false);
  const [fit, setFit] = useState<'contain' | 'cover'>('contain');
  const [rate, setRate] = useState(1);
  const [orient, setOrient] = useState<'auto' | 'landscape' | 'portrait'>('auto');
  const [chrome, setChrome] = useState(true);
  const [sheet, setSheet] = useState<Sheet>(null);
  const [sidecars, setSidecars] = useState<SubtitleTrack[]>([]);
  const [embedded, setEmbedded] = useState<SubtitleTrack[]>([]);
  const [track, setTrack] = useState<string | null>(null);
  const [scrub, setScrub] = useState<number | null>(null);
  const [artwork, setArtwork] = useState<string | null>(null);
  const [resume, setResume] = useState<number | null>(null);
  const [ripple, setRipple] = useState<-1 | 1 | 0>(0);
  const [adjust, setAdjust] = useState<Adjust>(null);
  const [box, setBox] = useState({width: 1, height: 1});

  /* ── the folder queue ─────────────────────────────────────── */

  // Shuffle is a stable permutation, recomputed only when it is switched on or
  // the folder changes — not on every track, or "next" would wander.
  const [order, setOrder] = useState<number[]>([]);
  const indexRef = useRef(index);
  indexRef.current = index;

  useEffect(() => {
    const base = playlist.map((_, i) => i);
    if (!shuffle) {
      setOrder(base);
      return;
    }
    const rest = base.filter(i => i !== indexRef.current);
    for (let i = rest.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [rest[i], rest[j]] = [rest[j], rest[i]];
    }
    setOrder(indexRef.current >= 0 ? [indexRef.current, ...rest] : rest);
  }, [shuffle, playlist]);

  const seq = order.length === playlist.length ? order : playlist.map((_, i) => i);
  const at = seq.indexOf(index);
  const queued = playlist.length > 1 && at >= 0 && !!onChangeMedia;
  const hasPrev = queued && (at > 0 || repeat === 'all');
  const hasNext = queued && (at < seq.length - 1 || repeat === 'all');

  const step = useCallback(
    (delta: number) => {
      if (!onChangeMedia || at < 0) return;
      let next = at + delta;
      if (next < 0 || next >= seq.length) {
        if (repeat !== 'all') return;
        next = (next + seq.length) % seq.length;
      }
      const entry = playlist[seq[next]];
      if (entry) onChangeMedia(entry);
    },
    [at, onChangeMedia, playlist, repeat, seq],
  );

  /* ── subtitles ────────────────────────────────────────────── */

  useEffect(() => {
    let alive = true;
    setSidecars([]);
    setEmbedded([]);
    setTrack(null);
    api
      .listSubtitles(path)
      .then(list => alive && setSidecars(list))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [path]);

  /** Only formats ExoPlayer can sideload are offered as separate files. */
  const textTracks = useMemo<TextTracks>(
    () =>
      sidecars
        .filter(s => SIDECAR[extOf(s.id)])
        .map(s => ({
          title: s.label,
          language: (s.language || 'en') as ISO639_1,
          type: SIDECAR[extOf(s.id)],
          uri: fileUrl(s.id),
        })),
    [sidecars],
  );

  const tracks = useMemo(
    () => [...embedded, ...sidecars.filter(s => SIDECAR[extOf(s.id)])],
    [embedded, sidecars],
  );

  const selectedTrack = useMemo(() => {
    if (!track) return {type: SelectedTrackType.DISABLED} as const;
    const i = tracks.findIndex(x => x.id === track);
    return {type: SelectedTrackType.INDEX, value: Math.max(0, i)} as const;
  }, [track, tracks]);

  /* ── artwork for the audio card and the notification ──────── */

  useEffect(() => {
    if (kind !== 'audio') {
      setArtwork(null);
      return;
    }
    let alive = true;
    setArtwork(null);
    const stem = stemOf(baseName(path));
    api
      .listDir(parentDir(path))
      .then(list => {
        if (!alive) return;
        const images = list.filter(e => !e.isDir && viewerKind(e.ext) === 'image');
        const named = images.find(e => stemOf(e.name) === stem);
        const cover = images.find(e => COVER.test(stemOf(e.name)));
        setArtwork((named ?? cover)?.path ?? null);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [kind, path]);

  // The transport notification is the only control surface once the tab loses
  // focus, and on Android 13+ it needs the runtime grant to appear at all.
  useEffect(() => {
    if (kind === 'audio') void api.requestNotifications().catch(() => undefined);
  }, [kind]);

  /* ── resume points ────────────────────────────────────────── */

  const timeRef = useRef(0);
  const durationRef = useRef(0);
  timeRef.current = time;
  durationRef.current = duration;

  useEffect(() => {
    let alive = true;
    setResume(null);
    api
      .playback(path)
      .then(mark => {
        if (!alive || !mark) return;
        const left = mark.duration ? mark.duration - mark.position : Infinity;
        if (mark.position > 5 && left > 15) setResume(mark.position);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [path]);

  // The chip is an offer, not a jump — a silent seek on open is disorienting.
  useEffect(() => {
    if (resume === null) return;
    const id = setTimeout(() => setResume(null), 9000);
    return () => clearTimeout(id);
  }, [resume]);

  useEffect(() => {
    const write = () => {
      const position = timeRef.current;
      const total = durationRef.current;
      if (!total) return;
      // Near either end there is nothing worth resuming from.
      if (position < 5 || total - position < 15) {
        void api.forgetPlayback(path).catch(() => undefined);
        return;
      }
      void api.savePlayback(path, position, total).catch(() => undefined);
    };
    const id = setInterval(write, 5000);
    return () => {
      clearInterval(id);
      write();
    };
  }, [path]);

  /* ── orientation ──────────────────────────────────────────── */

  const turned = useRef(false);

  useEffect(() => {
    void api.setOrientation(orient).catch(() => undefined);
  }, [orient]);

  useEffect(
    () => () => {
      void api.setOrientation('auto').catch(() => undefined);
      // The brightness override is window-wide, so it has to be handed back.
      void api.setBrightness(-1).catch(() => undefined);
    },
    [],
  );

  /* ── chrome ───────────────────────────────────────────────── */

  // Audio has nothing to look at, so its controls never fade.
  const showChrome = kind === 'audio' || chrome;

  useEffect(() => {
    if (kind === 'audio' || !chrome || !playing || !canPlay || sheet || scrub !== null) return;
    const id = setTimeout(() => setChrome(false), 3600);
    return () => clearTimeout(id);
  }, [canPlay, chrome, kind, playing, scrub, sheet, time]);

  useEffect(() => {
    if (!ripple) return;
    const id = setTimeout(() => setRipple(0), 550);
    return () => clearTimeout(id);
  }, [ripple]);

  useEffect(() => {
    if (!adjust) return;
    const id = setTimeout(() => setAdjust(null), 900);
    return () => clearTimeout(id);
  }, [adjust]);

  /* ── transport ────────────────────────────────────────────── */

  const seekTo = useCallback((seconds: number) => {
    const clamped = Math.max(0, seconds);
    setTime(clamped);
    ref.current?.seek(clamped);
  }, []);

  const bump = useCallback(
    (seconds: number) => seekTo(Math.min(durationRef.current || Infinity, timeRef.current + seconds)),
    [seekTo],
  );

  /* ── gestures ─────────────────────────────────────────────── */

  const g = useRef({
    mode: 'none' as 'none' | 'h' | 'v',
    x: 0,
    y: 0,
    volume: 1,
    bright: 0.5,
    lastTap: 0,
    lastBright: 0,
  }).current;

  const pan = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: (_, s) =>
          Math.abs(s.dx) > SLOP || Math.abs(s.dy) > SLOP,
        onPanResponderGrant: e => {
          g.mode = 'none';
          g.x = e.nativeEvent.locationX;
          g.y = e.nativeEvent.locationY;
          g.volume = volume;
        },
        onPanResponderMove: (_, s) => {
          if (g.mode === 'none') {
            if (Math.abs(s.dx) < SLOP && Math.abs(s.dy) < SLOP) return;
            g.mode = Math.abs(s.dx) > Math.abs(s.dy) ? 'h' : 'v';
          }
          if (g.mode !== 'v') return;

          const delta = -s.dy / Math.max(1, box.height);
          if (g.x < box.width / 2) {
            // Left half is brightness. The window value is write-only, so the
            // gesture carries its own running figure.
            const next = Math.max(0.02, Math.min(1, g.bright + delta));
            setAdjust({kind: 'brightness', value: next});
            const now = Date.now();
            if (now - g.lastBright > 60) {
              g.lastBright = now;
              void api.setBrightness(next).catch(() => undefined);
            }
          } else {
            const next = Math.max(0, Math.min(1, g.volume + delta));
            setVolume(next);
            if (next > 0) setMuted(false);
            setAdjust({kind: 'volume', value: next});
          }
        },
        onPanResponderRelease: (_, s) => {
          if (g.mode === 'v') {
            if (g.x < box.width / 2) {
              g.bright = Math.max(0.02, Math.min(1, g.bright - s.dy / Math.max(1, box.height)));
            }
            return;
          }
          if (g.mode === 'h') {
            if (Math.abs(s.dx) > SWIPE_TRACK && queued) step(s.dx < 0 ? 1 : -1);
            return;
          }
          const now = Date.now();
          if (now - g.lastTap < DOUBLE_TAP_MS) {
            const side = g.x < box.width / 2 ? -1 : 1;
            bump(side * 10);
            setRipple(side);
            g.lastTap = 0;
            return;
          }
          g.lastTap = now;
          setChrome(v => !v);
        },
      }),
    [box.height, box.width, bump, g, queued, step, volume],
  );

  /* ── the surface ──────────────────────────────────────────── */

  const player = (
    <Video
      ref={ref}
      source={{
        uri: fileUrl(path),
        // Feeds the media notification and the lockscreen.
        metadata: {
          title,
          artist: baseName(parentDir(path)),
          imageUri: artwork ? fileUrl(artwork) : undefined,
        },
      }}
      paused={!playing || !canPlay}
      muted={muted}
      volume={muted ? 0 : volume}
      repeat={repeat === 'one'}
      rate={rate}
      resizeMode={fit}
      textTracks={textTracks}
      selectedTextTrack={selectedTrack}
      progressUpdateInterval={400}
      preventsDisplaySleepDuringVideoPlayback
      playInBackground={kind === 'audio'}
      playWhenInactive={kind === 'audio'}
      showNotificationControls={kind === 'audio'}
      enterPictureInPictureOnLeave={kind === 'video'}
      style={kind === 'video' ? {flex: 1} : {width: 1, height: 1, opacity: 0}}
      onLoad={e => {
        setDuration(e.duration);
        setEmbedded(
          (e.textTracks ?? []).map((x, i) => ({
            id: `embedded-${i}`,
            label: x.title || x.language || `Track ${i + 1}`,
            language: x.language ?? null,
            kind: 'embedded' as const,
          })),
        );
        const size = e.naturalSize;
        if (
          kind === 'video' &&
          !turned.current &&
          size &&
          size.width > size.height * 1.2 &&
          box.height > box.width
        ) {
          turned.current = true;
          setOrient('landscape');
        }
      }}
      onProgress={e => {
        if (scrub === null) setTime(e.currentTime);
        setBuffered(e.playableDuration);
      }}
      onBuffer={e => setBusy(e.isBuffering)}
      onAudioBecomingNoisy={() => setPlaying(false)}
      onEnd={() => {
        if (hasNext) {
          step(1);
          return;
        }
        setPlaying(false);
      }}
      onError={e =>
        onError(
          e.error?.errorString || 'Playback failed — try opening this one with another app',
        )
      }
    />
  );

  const shown = scrub ?? time;
  const progress = duration ? Math.min(1, shown / duration) : 0;
  const bufferedAt = duration ? Math.min(1, buffered / duration) : 0;
  const counter = queued ? `${at + 1} / ${playlist.length}` : '';

  const repeatIcon: IconName = repeat === 'one' ? 'repeatOne' : 'loop';

  return (
    <View
      style={{flex: 1, backgroundColor: '#000'}}
      onLayout={e =>
        setBox({
          width: Math.max(1, e.nativeEvent.layout.width),
          height: Math.max(1, e.nativeEvent.layout.height),
        })
      }>
      <View {...pan.panHandlers} style={{flex: 1}}>
        {kind === 'video' ? (
          player
        ) : (
          <View style={{flex: 1, alignItems: 'center', justifyContent: 'center', gap: 20}}>
            {artwork ? (
              <Image
                source={{uri: fileUrl(artwork)}}
                style={{width: 232, height: 232, borderRadius: radius.lg}}
                resizeMode="cover"
              />
            ) : (
              <View
                style={{
                  width: 232,
                  height: 232,
                  borderRadius: radius.lg,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: t.ft.audio,
                }}>
                <Icon name="music" size={92} color="#fff" strokeWidth={1.2} />
              </View>
            )}
            <View style={{alignItems: 'center', gap: 4, paddingHorizontal: 32}}>
              <Text
                style={{color: '#fff', fontSize: 17, fontWeight: '600', textAlign: 'center'}}
                numberOfLines={2}>
                {title}
              </Text>
              <Text style={{color: 'rgba(255,255,255,0.6)', fontSize: 12.5}} numberOfLines={1}>
                {baseName(parentDir(path))}
              </Text>
            </View>
            {player}
          </View>
        )}
      </View>

      {busy ? (
        <View style={{position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, justifyContent: 'center'}}>
          <ActivityIndicator color="#fff" size="large" />
        </View>
      ) : null}

      {ripple ? (
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            top: 0,
            bottom: 0,
            justifyContent: 'center',
            alignItems: 'center',
            width: '40%',
            ...(ripple < 0 ? {left: 0} : {right: 0}),
          }}>
          <View
            style={{
              paddingHorizontal: 16,
              paddingVertical: 10,
              borderRadius: radius.pill,
              backgroundColor: OVERLAY,
            }}>
            <Text style={{color: '#fff', fontWeight: '700', fontSize: 14}}>
              {ripple < 0 ? '−10s' : '+10s'}
            </Text>
          </View>
        </View>
      ) : null}

      {adjust ? (
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            top: 0,
            bottom: 0,
            left: 0,
            right: 0,
            alignItems: 'center',
            justifyContent: 'center',
          }}>
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 10,
              paddingHorizontal: 16,
              paddingVertical: 12,
              borderRadius: radius.md,
              backgroundColor: OVERLAY,
            }}>
            <Icon name={adjust.kind === 'volume' ? 'volume' : 'sun'} size={18} color="#fff" />
            <View style={{width: 110, height: 4, borderRadius: 2, backgroundColor: TRACK}}>
              <View
                style={{
                  width: `${Math.round(adjust.value * 100)}%`,
                  height: '100%',
                  borderRadius: 2,
                  backgroundColor: '#fff',
                }}
              />
            </View>
            <Text style={{color: '#fff', fontSize: 12, fontWeight: '700', width: 34}}>
              {Math.round(adjust.value * 100)}%
            </Text>
          </View>
        </View>
      ) : null}

      {!playing && kind === 'video' && !busy ? (
        <Pressable
          onPress={() => setPlaying(true)}
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            alignItems: 'center',
            justifyContent: 'center',
          }}>
          <View
            style={{
              width: 78,
              height: 78,
              borderRadius: 39,
              backgroundColor: OVERLAY,
              alignItems: 'center',
              justifyContent: 'center',
            }}>
            <Icon name="play" size={32} color="#fff" />
          </View>
        </Pressable>
      ) : null}

      {resume !== null ? (
        <View
          style={{
            position: 'absolute',
            left: 14,
            right: 14,
            top: insets.top + 62,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 10,
            paddingLeft: 14,
            paddingRight: 6,
            paddingVertical: 6,
            borderRadius: radius.pill,
            backgroundColor: 'rgba(0,0,0,0.72)',
          }}>
          <Text style={{color: '#fff', fontSize: 12.5, flex: 1}} numberOfLines={1}>
            Left off at {formatDuration(resume)}
          </Text>
          <Btn
            label="Resume"
            small
            kind="primary"
            onPress={() => {
              seekTo(resume);
              setResume(null);
            }}
          />
          <IconBtn icon="close" size={15} color="#fff" label="Start over" onPress={() => setResume(null)} />
        </View>
      ) : null}

      {showChrome ? (
        <>
          <View
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              flexDirection: 'row',
              alignItems: 'center',
              gap: 4,
              paddingTop: insets.top,
              paddingHorizontal: 4,
              paddingBottom: 6,
              backgroundColor: 'rgba(0,0,0,0.45)',
            }}>
            {onClose ? (
              <IconBtn icon="close" color="#fff" label="Close" onPress={onClose} />
            ) : null}
            <View style={{flex: 1, paddingHorizontal: 4}}>
              <Text style={{color: '#fff', fontSize: 14.5, fontWeight: '600'}} numberOfLines={1}>
                {title}
              </Text>
            </View>
            {counter ? (
              <Pressable
                onPress={() => setSheet('queue')}
                accessibilityLabel="Show the folder queue"
                style={{
                  paddingHorizontal: 10,
                  paddingVertical: 5,
                  borderRadius: radius.pill,
                  backgroundColor: 'rgba(255,255,255,0.16)',
                }}>
                <Text style={{color: '#fff', fontSize: 12, fontWeight: '700'}}>{counter}</Text>
              </Pressable>
            ) : null}
            {kind === 'video' ? (
              <IconBtn
                icon="pip"
                color="#fff"
                label="Picture in picture"
                onPress={() => ref.current?.enterPictureInPicture()}
              />
            ) : null}
            <IconBtn icon="more" color="#fff" label="More" onPress={() => setSheet('more')} />
          </View>

          <View
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              bottom: 0,
              paddingHorizontal: 12,
              paddingTop: 6,
              paddingBottom: insets.bottom + 8,
              gap: 2,
              backgroundColor: 'rgba(0,0,0,0.6)',
            }}>
            <View style={{flexDirection: 'row', alignItems: 'center', gap: 10}}>
              <Text style={{color: '#fff', fontSize: 11.5, width: 46}}>{formatDuration(shown)}</Text>
              <View style={{flex: 1}}>
                <Slider
                  value={progress}
                  buffered={bufferedAt}
                  tint={t.accent}
                  active={scrub !== null}
                  onSlide={v => setScrub(v * duration)}
                  onRelease={v => {
                    seekTo(v * duration);
                    setScrub(null);
                  }}
                />
              </View>
              <Text style={{color: '#fff', fontSize: 11.5, width: 46, textAlign: 'right'}}>
                {duration ? `−${formatDuration(Math.max(0, duration - shown))}` : '--:--'}
              </Text>
            </View>

            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 6,
              }}>
              <IconBtn
                icon="skipBack"
                color="#fff"
                label="Previous track"
                disabled={!hasPrev}
                onPress={() => step(-1)}
              />
              <IconBtn icon="back" color="#fff" label="Back 10 seconds" onPress={() => bump(-10)} />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={playing ? 'Pause' : 'Play'}
                onPress={() => setPlaying(v => !v)}
                style={({pressed}) => ({
                  width: 62,
                  height: 62,
                  borderRadius: 31,
                  marginHorizontal: 6,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: 'rgba(255,255,255,0.14)',
                  opacity: pressed ? 0.7 : 1,
                })}>
                <Icon name={playing ? 'pause' : 'play'} size={28} color="#fff" />
              </Pressable>
              <IconBtn icon="forward" color="#fff" label="Forward 10 seconds" onPress={() => bump(10)} />
              <IconBtn
                icon="skipFwd"
                color="#fff"
                label="Next track"
                disabled={!hasNext}
                onPress={() => step(1)}
              />
            </View>

            <View style={{flexDirection: 'row', alignItems: 'center', gap: 2}}>
              <IconBtn
                icon={muted || volume === 0 ? 'volumeOff' : 'volume'}
                size={17}
                color="#fff"
                label="Mute"
                onPress={() => setMuted(v => !v)}
              />
              <View style={{width: 84}}>
                <Slider
                  value={muted ? 0 : volume}
                  tint="#fff"
                  height={3}
                  onSlide={v => {
                    setVolume(v);
                    if (v > 0) setMuted(false);
                  }}
                />
              </View>
              <View style={{flex: 1}} />
              <Pressable
                onPress={() => setSheet('rate')}
                accessibilityLabel="Playback speed"
                style={{paddingHorizontal: 8, paddingVertical: 9}}>
                <Text style={{color: '#fff', fontSize: 12.5, fontWeight: '700'}}>{rate}×</Text>
              </Pressable>
              <IconBtn
                icon="captions"
                size={17}
                color={track ? t.accent : '#fff'}
                label="Subtitles"
                onPress={() => setSheet('subs')}
              />
              <IconBtn
                icon="shuffle"
                size={17}
                color={shuffle ? t.accent : '#fff'}
                disabled={!queued}
                label="Shuffle"
                onPress={() => setShuffle(v => !v)}
              />
              <IconBtn
                icon={repeatIcon}
                size={17}
                color={repeat === 'off' ? '#fff' : t.accent}
                label={`Repeat ${repeat}`}
                onPress={() =>
                  setRepeat(r => (r === 'off' ? 'all' : r === 'all' ? 'one' : 'off'))
                }
              />
              {kind === 'video' ? (
                <IconBtn
                  icon="fit"
                  size={17}
                  color={fit === 'cover' ? t.accent : '#fff'}
                  label="Fit to screen"
                  onPress={() => setFit(f => (f === 'contain' ? 'cover' : 'contain'))}
                />
              ) : null}
            </View>
          </View>
        </>
      ) : null}

      <Modal
        visible={sheet !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setSheet(null)}>
        <Pressable
          onPress={() => setSheet(null)}
          style={{flex: 1, backgroundColor: t.scrim, justifyContent: 'flex-end'}}>
          <Pressable
            onPress={() => undefined}
            style={{
              backgroundColor: t.bg,
              borderTopLeftRadius: 18,
              borderTopRightRadius: 18,
              padding: 16,
              paddingBottom: insets.bottom + 16,
              gap: 8,
              maxHeight: '70%',
            }}>
            {sheet === 'rate' ? (
              <ScrollView contentContainerStyle={{gap: 6}}>
                {RATES.map(r => (
                  <Row
                    key={r}
                    label={`${r}× speed`}
                    on={r === rate}
                    onPress={() => {
                      setRate(r);
                      setSheet(null);
                    }}
                  />
                ))}
              </ScrollView>
            ) : sheet === 'queue' ? (
              <ScrollView contentContainerStyle={{gap: 6}}>
                {playlist.map((entry, i) => (
                  <Row
                    key={entry.path}
                    label={entry.name}
                    hint={i === index ? 'Playing' : undefined}
                    on={i === index}
                    onPress={() => {
                      setSheet(null);
                      if (i !== index) onChangeMedia?.(entry);
                    }}
                  />
                ))}
              </ScrollView>
            ) : sheet === 'more' ? (
              <ScrollView contentContainerStyle={{gap: 6}}>
                <Row
                  label={
                    orient === 'auto'
                      ? 'Rotation: follow the device'
                      : orient === 'landscape'
                        ? 'Rotation: locked landscape'
                        : 'Rotation: locked portrait'
                  }
                  on={orient !== 'auto'}
                  onPress={() => {
                    turned.current = true;
                    setOrient(o => (o === 'auto' ? 'landscape' : o === 'landscape' ? 'portrait' : 'auto'));
                  }}
                />
                <Row
                  label="Share"
                  onPress={() => {
                    setSheet(null);
                    void api.share(path).catch(e => onError(String(e)));
                  }}
                />
                <Row
                  label="Open with another app"
                  onPress={() => {
                    setSheet(null);
                    void api.pickOpenWith(path).catch(e => onError(String(e)));
                  }}
                />
                <Row
                  label="Open in a system player"
                  onPress={() => {
                    setSheet(null);
                    void api.openSystem(path).catch(e => onError(String(e)));
                  }}
                />
              </ScrollView>
            ) : (
              <ScrollView contentContainerStyle={{gap: 6}}>
                <Row
                  label="Subtitles off"
                  on={!track}
                  onPress={() => {
                    setTrack(null);
                    setSheet(null);
                  }}
                />
                {!tracks.length ? (
                  <Text style={{color: t.neutral600, padding: 14}}>
                    No subtitle tracks in this file, and no .srt or .vtt beside it
                  </Text>
                ) : null}
                {tracks.map(x => (
                  <Row
                    key={x.id}
                    label={x.label}
                    hint={x.kind === 'embedded' ? 'In this file' : 'Sidecar file'}
                    on={x.id === track}
                    onPress={() => {
                      setTrack(x.id);
                      setSheet(null);
                    }}
                  />
                ))}
              </ScrollView>
            )}
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
});

/* ── pieces ─────────────────────────────────────────────────── */

/**
 * A bar you can drag. No slider package is installed, so this is the raw
 * responder the old scrub bar used, factored out and given a taller hit area.
 */
const Slider = memo(function Slider({
  value,
  buffered = 0,
  tint,
  height = 4,
  active,
  onSlide,
  onRelease,
}: {
  value: number;
  buffered?: number;
  tint: string;
  height?: number;
  active?: boolean;
  onSlide: (value: number) => void;
  onRelease?: (value: number) => void;
}) {
  const [width, setWidth] = useState(1);
  const at = (x: number) => Math.max(0, Math.min(1, x / width));
  const thumb = active ? 18 : 13;

  return (
    <View
      onLayout={e => setWidth(Math.max(1, e.nativeEvent.layout.width))}
      onStartShouldSetResponder={() => true}
      onMoveShouldSetResponder={() => true}
      onResponderGrant={e => onSlide(at(e.nativeEvent.locationX))}
      onResponderMove={e => onSlide(at(e.nativeEvent.locationX))}
      onResponderRelease={e => onRelease?.(at(e.nativeEvent.locationX))}
      onResponderTerminate={e => onRelease?.(at(e.nativeEvent.locationX))}
      style={{paddingVertical: 14, justifyContent: 'center'}}>
      <View style={{height, borderRadius: height / 2, backgroundColor: TRACK}}>
        {buffered > 0 ? (
          <View
            style={{
              position: 'absolute',
              left: 0,
              top: 0,
              bottom: 0,
              width: `${Math.round(buffered * 100)}%`,
              borderRadius: height / 2,
              backgroundColor: BUFFERED,
            }}
          />
        ) : null}
        <View
          style={{
            width: `${Math.round(value * 100)}%`,
            height: '100%',
            borderRadius: height / 2,
            backgroundColor: tint,
          }}
        />
      </View>
      <View
        pointerEvents="none"
        style={{
          position: 'absolute',
          left: `${Math.round(value * 100)}%`,
          width: thumb,
          height: thumb,
          marginLeft: -thumb / 2,
          borderRadius: thumb / 2,
          backgroundColor: tint,
        }}
      />
    </View>
  );
});

/** One line of any of the player's bottom sheets. */
const Row = memo(function Row({
  label,
  hint,
  on,
  onPress,
}: {
  label: string;
  hint?: string;
  on?: boolean;
  onPress: () => void;
}) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      style={{
        paddingVertical: 13,
        paddingHorizontal: 14,
        borderRadius: radius.md,
        backgroundColor: on ? t.accent100 : t.raised,
      }}>
      <Text numberOfLines={1} style={{color: on ? t.accent : t.text, fontWeight: '600', fontSize: 14.5}}>
        {label}
      </Text>
      {hint ? <Text style={{color: t.neutral600, fontSize: 11.5}}>{hint}</Text> : null}
    </Pressable>
  );
});
