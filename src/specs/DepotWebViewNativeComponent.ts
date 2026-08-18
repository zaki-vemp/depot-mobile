// Values come from the package root; only the codegen type names keep the deep
// path, and type imports are erased before they can warn at runtime.
import {codegenNativeCommands, codegenNativeComponent} from 'react-native';
import type {HostComponent, ViewProps} from 'react-native';
import type {
  DirectEventHandler,
  Int32,
  WithDefault,
} from 'react-native/Libraries/Types/CodegenTypes';

type NavigationEvent = Readonly<{
  url: string;
  title: string;
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  progress: Int32;
}>;

type ErrorEvent = Readonly<{
  message: string;
}>;

type PopupEvent = Readonly<{
  open: boolean;
}>;

type DownloadEvent = Readonly<{
  name: string;
  path: string;
}>;

/** A picture the user long-pressed, offered for saving. */
type ImageEvent = Readonly<{
  url: string;
}>;

/**
 * A real Android WebView. The desktop app parks a native child webview over the
 * pane so `X-Frame-Options` never decides what can open; this is the same idea
 * with the platform's own view instead of an OS window.
 */
export interface NativeProps extends ViewProps {
  url?: string;
  /**
   * Which user agent every WebView in this tab reports, popups included.
   *
   * - `default` — the platform's own, which carries `wv`. Meta degrades pages
   *   that send it and Google's sign-in refuses them outright.
   * - `chrome` — this device's agent with `wv` and `Version/4.0` removed.
   * - `desktop` — `chrome` with the Android and Mobile tokens swapped out, for
   *   "request desktop site".
   *
   * Cookies are not affected either way: `CookieManager` is process-global, so
   * all tabs share one jar.
   */
  userAgent?: WithDefault<string, 'default'>;
  incognito?: WithDefault<boolean, false>;
  onNavigation?: DirectEventHandler<NavigationEvent>;
  onWebError?: DirectEventHandler<ErrorEvent>;
  /** A `window.open` popup — a real child webview — opened or closed. */
  onPopup?: DirectEventHandler<PopupEvent>;
  /** A file from the page was queued into Depot's download folder. */
  onDownload?: DirectEventHandler<DownloadEvent>;
  onImage?: DirectEventHandler<ImageEvent>;
}

export type DepotWebViewType = HostComponent<NativeProps>;

interface NativeCommands {
  goBack: (viewRef: React.ElementRef<DepotWebViewType>) => void;
  goForward: (viewRef: React.ElementRef<DepotWebViewType>) => void;
  reload: (viewRef: React.ElementRef<DepotWebViewType>) => void;
  loadUrl: (viewRef: React.ElementRef<DepotWebViewType>, url: string) => void;
  closePopup: (viewRef: React.ElementRef<DepotWebViewType>) => void;
  saveUrl: (viewRef: React.ElementRef<DepotWebViewType>, url: string) => void;
}

export const Commands: NativeCommands = codegenNativeCommands<NativeCommands>({
  supportedCommands: ['goBack', 'goForward', 'reload', 'loadUrl', 'closePopup', 'saveUrl'],
});

export default codegenNativeComponent<NativeProps>('DepotWebView') as DepotWebViewType;
