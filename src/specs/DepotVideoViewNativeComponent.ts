import type {HostComponent, ViewProps} from 'react-native';
import type {
  DirectEventHandler,
  Double,
  Int32,
  WithDefault,
} from 'react-native/Libraries/Types/CodegenTypes';
import codegenNativeCommands from 'react-native/Libraries/Utilities/codegenNativeCommands';
import codegenNativeComponent from 'react-native/Libraries/Utilities/codegenNativeComponent';

type LoadEvent = Readonly<{
  durationMs: Int32;
  width: Int32;
  height: Int32;
}>;

type ProgressEvent = Readonly<{
  timeMs: Int32;
  durationMs: Int32;
  bufferedMs: Int32;
}>;

type PlaybackEvent = Readonly<{
  playing: boolean;
}>;

type ErrorEvent = Readonly<{
  message: string;
}>;

/**
 * Video and audio surface backed by Android's own MediaPlayer, so no extra
 * playback library ships with the app. The transport controls are drawn in
 * React Native, matching the desktop player's chrome.
 */
export interface NativeProps extends ViewProps {
  source?: string;
  paused?: WithDefault<boolean, false>;
  muted?: WithDefault<boolean, false>;
  loop?: WithDefault<boolean, false>;
  /** 0…1 */
  volume?: WithDefault<Double, 1.0>;
  /** 0.25…3.0 — ignored below API 23. */
  rate?: WithDefault<Double, 1.0>;
  /** Bumping this value seeks; the same value twice is a no-op. */
  seekMs?: WithDefault<Int32, -1>;
  onVideoLoad?: DirectEventHandler<LoadEvent>;
  onVideoProgress?: DirectEventHandler<ProgressEvent>;
  onVideoEnd?: DirectEventHandler<PlaybackEvent>;
  onVideoError?: DirectEventHandler<ErrorEvent>;
}

export type DepotVideoViewType = HostComponent<NativeProps>;

interface NativeCommands {
  seek: (viewRef: React.ElementRef<DepotVideoViewType>, ms: Int32) => void;
}

export const Commands: NativeCommands = codegenNativeCommands<NativeCommands>({
  supportedCommands: ['seek'],
});

export default codegenNativeComponent<NativeProps>('DepotVideoView') as DepotVideoViewType;
