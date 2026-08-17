import React, {memo, useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {Modal, Pressable, ScrollView, Text, View} from 'react-native';
import Video, {
  SelectedTrackType,
  TextTrackType,
  type ISO639_1,
  type TextTracks,
  type VideoRef,
} from 'react-native-video';
import {api, fileUrl} from '../api';
import {extOf, formatDuration} from '../lib/files';
import {Icon} from '../lib/icons';
import {radius} from '../theme';
import {Btn, IconBtn, useTheme} from '../ui/kit';
import type {SubtitleTrack} from '../types';

const RATES = [0.5, 0.75, 1, 1.25, 1.5, 2];

/** Formats media3 can sideload from a file next to the movie. */
const SIDECAR: Record<string, TextTrackType> = {
  srt: TextTrackType.SUBRIP,
  vtt: TextTrackType.VTT,
};

/**
 * The desktop player's HUD over an ExoPlayer surface: scrub bar, ±10s, rate,
 * volume, loop, subtitle picker — sidecar files and the tracks baked into the
 * container both — and hand-off to a system app.
 */
export const MediaPlayer = memo(function MediaPlayer({
  title,
  path,
  kind,
  onError,
}: {
  title: string;
  path: string;
  kind: 'video' | 'audio';
  onError: (message: string) => void;
}) {
  const t = useTheme();
  const ref = useRef<VideoRef>(null);

  const [playing, setPlaying] = useState(true);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [muted, setMuted] = useState(false);
  const [loop, setLoop] = useState(false);
  const [rate, setRate] = useState(1);
  const [chrome, setChrome] = useState(true);
  const [menu, setMenu] = useState<'rate' | 'subs' | null>(null);
  const [sidecars, setSidecars] = useState<SubtitleTrack[]>([]);
  const [embedded, setEmbedded] = useState<SubtitleTrack[]>([]);
  const [track, setTrack] = useState<string | null>(null);
  const [scrubbing, setScrubbing] = useState(false);
  const [barWidth, setBarWidth] = useState(1);

  useEffect(() => {
    let alive = true;
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

  const tracks = useMemo(() => [...embedded, ...sidecars.filter(s => SIDECAR[extOf(s.id)])], [
    embedded,
    sidecars,
  ]);

  // Chrome fades out during playback, like the desktop HUD.
  useEffect(() => {
    if (!chrome || !playing || menu) return;
    const id = setTimeout(() => setChrome(false), 3200);
    return () => clearTimeout(id);
  }, [chrome, playing, menu, time]);

  const seekTo = useCallback((seconds: number) => {
    const clamped = Math.max(0, seconds);
    setTime(clamped);
    ref.current?.seek(clamped);
  }, []);

  const bump = useCallback((seconds: number) => seekTo(time + seconds), [seekTo, time]);

  const percent = duration ? Math.min(100, (time / duration) * 100) : 0;

  const scrubAt = (x: number) => {
    if (!duration) return;
    seekTo((Math.max(0, Math.min(barWidth, x)) / barWidth) * duration);
  };

  const selectedTrack = useMemo(() => {
    if (!track) return {type: SelectedTrackType.DISABLED} as const;
    const index = tracks.findIndex(x => x.id === track);
    return {type: SelectedTrackType.INDEX, value: Math.max(0, index)} as const;
  }, [track, tracks]);

  const player = (
    <Video
      ref={ref}
      source={{uri: fileUrl(path)}}
      paused={!playing}
      muted={muted}
      repeat={loop}
      rate={rate}
      resizeMode="contain"
      textTracks={textTracks}
      selectedTextTrack={selectedTrack}
      progressUpdateInterval={400}
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
      }}
      onProgress={e => {
        if (!scrubbing) setTime(e.currentTime);
      }}
      onEnd={() => setPlaying(false)}
      onError={e =>
        onError(
          e.error?.errorString ||
            'Playback failed — try opening this one with another app',
        )
      }
    />
  );

  return (
    <View style={{flex: 1, backgroundColor: '#000'}}>
      <Pressable style={{flex: 1}} onPress={() => setChrome(v => !v)}>
        {kind === 'video' ? (
          player
        ) : (
          <View style={{flex: 1, alignItems: 'center', justifyContent: 'center', gap: 18}}>
            <View
              style={{
                width: 132,
                height: 132,
                borderRadius: radius.lg,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: t.ft.audio,
              }}>
              <Icon name="music" size={56} color="#fff" strokeWidth={1.4} />
            </View>
            <Text style={{color: '#fff', fontSize: 16, fontWeight: '600'}} numberOfLines={2}>
              {title}
            </Text>
            {player}
          </View>
        )}
      </Pressable>

      {!playing && kind === 'video' ? (
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
              width: 76,
              height: 76,
              borderRadius: 38,
              backgroundColor: 'rgba(0,0,0,0.55)',
              alignItems: 'center',
              justifyContent: 'center',
            }}>
            <Icon name="play" size={30} color="#fff" />
          </View>
        </Pressable>
      ) : null}

      {chrome ? (
        <>
          <View
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              padding: 14,
              backgroundColor: 'rgba(0,0,0,0.45)',
            }}>
            <Text style={{color: '#fff', fontSize: 14.5, fontWeight: '600'}} numberOfLines={1}>
              {title}
            </Text>
          </View>

          <View
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              bottom: 0,
              padding: 12,
              gap: 8,
              backgroundColor: 'rgba(0,0,0,0.55)',
            }}>
            <View
              onLayout={e => setBarWidth(Math.max(1, e.nativeEvent.layout.width))}
              onStartShouldSetResponder={() => true}
              onMoveShouldSetResponder={() => true}
              onResponderGrant={e => {
                setScrubbing(true);
                scrubAt(e.nativeEvent.locationX);
              }}
              onResponderMove={e => scrubAt(e.nativeEvent.locationX)}
              onResponderRelease={() => setScrubbing(false)}
              style={{paddingVertical: 10}}>
              <View style={{height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.28)'}}>
                <View
                  style={{
                    width: `${percent}%`,
                    height: '100%',
                    borderRadius: 2,
                    backgroundColor: t.accent,
                  }}
                />
              </View>
              <View
                style={{
                  position: 'absolute',
                  left: `${percent}%`,
                  top: 5,
                  width: 14,
                  height: 14,
                  marginLeft: -7,
                  borderRadius: 7,
                  backgroundColor: t.accent,
                }}
              />
            </View>

            <View style={{flexDirection: 'row', alignItems: 'center', gap: 2}}>
              <IconBtn
                icon={playing ? 'pause' : 'play'}
                color="#fff"
                label={playing ? 'Pause' : 'Play'}
                onPress={() => setPlaying(v => !v)}
              />
              <IconBtn
                icon="skipBack"
                color="#fff"
                label="Back 10 seconds"
                onPress={() => bump(-10)}
              />
              <IconBtn
                icon="skipFwd"
                color="#fff"
                label="Forward 10 seconds"
                onPress={() => bump(10)}
              />
              <Text style={{color: '#fff', fontSize: 12, marginHorizontal: 6}}>
                {formatDuration(time)} / {formatDuration(duration)}
              </Text>
              <View style={{flex: 1}} />
              <IconBtn
                icon={muted ? 'volumeOff' : 'volume'}
                color="#fff"
                label="Mute"
                onPress={() => setMuted(v => !v)}
              />
              <Pressable
                onPress={() => setMenu(m => (m === 'rate' ? null : 'rate'))}
                style={{paddingHorizontal: 10, paddingVertical: 9}}>
                <Text style={{color: '#fff', fontSize: 12.5, fontWeight: '700'}}>{rate}×</Text>
              </Pressable>
              <IconBtn
                icon="captions"
                color={track ? t.accent : '#fff'}
                label="Subtitles"
                onPress={() => setMenu(m => (m === 'subs' ? null : 'subs'))}
              />
              <IconBtn
                icon="loop"
                color={loop ? t.accent : '#fff'}
                label="Loop"
                onPress={() => setLoop(v => !v)}
              />
              <IconBtn
                icon="external"
                color="#fff"
                label="Open in system player"
                onPress={() =>
                  api
                    .openSystem(path)
                    .catch(e => onError(e instanceof Error ? e.message : String(e)))
                }
              />
            </View>
          </View>
        </>
      ) : null}

      <Modal visible={!!menu} transparent animationType="fade" onRequestClose={() => setMenu(null)}>
        <Pressable
          onPress={() => setMenu(null)}
          style={{flex: 1, backgroundColor: t.scrim, justifyContent: 'flex-end'}}>
          <Pressable
            onPress={() => undefined}
            style={{
              backgroundColor: t.bg,
              borderTopLeftRadius: 18,
              borderTopRightRadius: 18,
              padding: 16,
              gap: 8,
              maxHeight: '60%',
            }}>
            {menu === 'rate' ? (
              <ScrollView contentContainerStyle={{gap: 6}}>
                {RATES.map(r => (
                  <Pressable
                    key={r}
                    onPress={() => {
                      setRate(r);
                      setMenu(null);
                    }}
                    style={{
                      paddingVertical: 13,
                      paddingHorizontal: 14,
                      borderRadius: radius.md,
                      backgroundColor: r === rate ? t.accent100 : t.raised,
                    }}>
                    <Text
                      style={{
                        color: r === rate ? t.accent : t.text,
                        fontWeight: '600',
                        fontSize: 14.5,
                      }}>
                      {r}× speed
                    </Text>
                  </Pressable>
                ))}
              </ScrollView>
            ) : (
              <ScrollView contentContainerStyle={{gap: 6}}>
                <Pressable
                  onPress={() => {
                    setTrack(null);
                    setMenu(null);
                  }}
                  style={{
                    paddingVertical: 13,
                    paddingHorizontal: 14,
                    borderRadius: radius.md,
                    backgroundColor: !track ? t.accent100 : t.raised,
                  }}>
                  <Text style={{color: !track ? t.accent : t.text, fontWeight: '600'}}>
                    Subtitles off
                  </Text>
                </Pressable>
                {!tracks.length ? (
                  <Text style={{color: t.neutral600, padding: 14}}>
                    No subtitle tracks in this file, and no .srt or .vtt beside it
                  </Text>
                ) : null}
                {tracks.map(x => (
                  <Pressable
                    key={x.id}
                    onPress={() => {
                      setTrack(x.id);
                      setMenu(null);
                    }}
                    style={{
                      paddingVertical: 13,
                      paddingHorizontal: 14,
                      borderRadius: radius.md,
                      backgroundColor: x.id === track ? t.accent100 : t.raised,
                    }}>
                    <Text style={{color: x.id === track ? t.accent : t.text, fontWeight: '600'}}>
                      {x.label}
                    </Text>
                    <Text style={{color: t.neutral600, fontSize: 11.5}}>
                      {x.kind === 'embedded' ? 'In this file' : 'Sidecar file'}
                    </Text>
                  </Pressable>
                ))}
                <Btn
                  label="Open in a system player instead"
                  block
                  onPress={() => {
                    setMenu(null);
                    void api.openSystem(path).catch(e => onError(String(e)));
                  }}
                />
              </ScrollView>
            )}
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
});
