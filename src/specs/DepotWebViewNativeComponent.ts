import type {HostComponent, ViewProps} from 'react-native';
import type {
  DirectEventHandler,
  Int32,
  WithDefault,
} from 'react-native/Libraries/Types/CodegenTypes';
import codegenNativeCommands from 'react-native/Libraries/Utilities/codegenNativeCommands';
import codegenNativeComponent from 'react-native/Libraries/Utilities/codegenNativeComponent';

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

/**
 * A real Android WebView. The desktop app parks a native child webview over the
 * pane so `X-Frame-Options` never decides what can open; this is the same idea
 * with the platform's own view instead of an OS window.
 */
export interface NativeProps extends ViewProps {
  url?: string;
  /** Keeps a per-app cookie jar so social tabs stay signed in. */
  userAgent?: string;
  incognito?: WithDefault<boolean, false>;
  onNavigation?: DirectEventHandler<NavigationEvent>;
  onWebError?: DirectEventHandler<ErrorEvent>;
}

export type DepotWebViewType = HostComponent<NativeProps>;

interface NativeCommands {
  goBack: (viewRef: React.ElementRef<DepotWebViewType>) => void;
  goForward: (viewRef: React.ElementRef<DepotWebViewType>) => void;
  reload: (viewRef: React.ElementRef<DepotWebViewType>) => void;
  loadUrl: (viewRef: React.ElementRef<DepotWebViewType>, url: string) => void;
}

export const Commands: NativeCommands = codegenNativeCommands<NativeCommands>({
  supportedCommands: ['goBack', 'goForward', 'reload', 'loadUrl'],
});

export default codegenNativeComponent<NativeProps>('DepotWebView') as DepotWebViewType;
