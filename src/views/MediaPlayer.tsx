import React, {memo, useCallback, useEffect, useRef, useState} from 'react';
import {Modal, Pressable, ScrollView, Text, View} from 'react-native';
import {api, fileUrl} from '../api';
import {formatDuration} from '../lib/files';
import {Icon} from '../lib/icons';
import {radius} from '../theme';
import {Btn, IconBtn, useTheme} from '../ui/kit';
import DepotVideoView, {Commands} from '../specs/DepotVideoViewNativeComponent';
import type {DepotVideoViewType} from '../specs/DepotVideoViewNativeComponent';
import type {SubtitleTrack} from '../types';

const RATES = [0.5, 0.75, 1, 1.25, 1.5, 2];

/**
 * The desktop player's HUD, on a surface driven by Android's MediaPlayer:
 * scrub bar, ±10s, rate, volume, loop, subtitle picker, hand-off to a system
 * app. Audio files get the same chrome over a static sheet.
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
  const ref = useRef<React.ElementRef<DepotVideoViewType> | null>(null);

  const [playing, setPlaying] = useState(true);
  const [timeMs, setTimeMs] = useState(0);
  const [durationMs, setDurationMs] = useState(0);
  const [muted, setMuted] = useState(false);
  const [loop, setLoop] = useState(false);
  const [rate, setRate] = useState(1);
  const [chrome, setChrome] = useState(true);
  const [menu, setMenu] = useState<'rate' | 'subs' | null>(null);
  const [tracks, setTracks] = useState<SubtitleTrack[]>([]);
  const [track, setTrack] = useState<string | null>(null);
  const [scrubbing, setScrubbing] = useState(false);
  const [barWidth, setBarWidth] = useState(1);

  useEffect(() => {
    let alive = true;
    api
      .listSubtitles(path)
      .then(list => alive && setTracks(list))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [path]);

  // Chrome fades out during playback, like the desktop HUD.
  useEffect(() => {
    if (!chrome || !playing || menu) {
      return;
    }
    const id = setTimeout(() => setChrome(false), 3200);
    return () => clearTimeout(id);
  }, [chrome, playing, menu, timeMs]);

  const seekTo = useCallback((ms: number) => {
    const clamped = Math.max(0, ms);
    setTimeMs(clamped);
    if (ref.current) {
      Commands.seek(ref.current, Math.round(clamped));
    }
  }, []);

  const bump = useCallback((seconds: number) => seekTo(timeMs + seconds * 1000), [seekTo, timeMs]);

  const percent = durationMs ? Math.min(100, (timeMs / durationMs) * 100) : 0;

  const scrubAt = (x: number) => {
    if (!durationMs) {
      return;
    }
    seekTo((Math.max(0, Math.min(barWidth, x)) / barWidth) * durationMs);
  };

  return (
    <View style={{flex: 1, backgroundColor: '#000'}}>
      <Pressable style={{flex: 1}} onPress={() => setChrome(v => !v)}>
        {kind === 'video' ? (
          <DepotVideoView
            ref={ref}
            source={fileUrl(path)}
            paused={!playing}
            muted={muted}
            loop={loop}
            rate={rate}
            style={{flex: 1}}
            onVideoLoad={e => setDurationMs(e.nativeEvent.durationMs)}
            onVideoProgress={e => {
              if (!scrubbing) {
                setTimeMs(e.nativeEvent.timeMs);
              }
              if (e.nativeEvent.durationMs) {
                setDurationMs(e.nativeEvent.durationMs);
              }
            }}
            onVideoEnd={() => setPlaying(false)}
            onVideoError={e => onError(e.nativeEvent.message)}
          />
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
            <DepotVideoView
              ref={ref}
              source={fileUrl(path)}
              paused={!playing}
              muted={muted}
              loop={loop}
              rate={rate}
              style={{width: 1, height: 1, opacity: 0}}
              onVideoLoad={e => setDurationMs(e.nativeEvent.durationMs)}
              onVideoProgress={e => {
                if (!scrubbing) {
                  setTimeMs(e.nativeEvent.timeMs);
                }
                if (e.nativeEvent.durationMs) {
                  setDurationMs(e.nativeEvent.durationMs);
                }
              }}
              onVideoEnd={() => setPlaying(false)}
              onVideoError={e => onError(e.nativeEvent.message)}
            />
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
                {formatDuration(timeMs / 1000)} / {formatDuration(durationMs / 1000)}
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
                  <Text style={{color: t.neutral600, padding: 14}}>No subtitle files found</Text>
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
