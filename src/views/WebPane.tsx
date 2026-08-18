import React, {memo, useCallback, useEffect, useRef, useState} from 'react';
import {BackHandler, Modal, Pressable, ScrollView, Text, TextInput, View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {api} from '../api';
import {Icon, type IconName} from '../lib/icons';
import {BRAND, radius} from '../theme';
import {Btn, Divider, IconBtn, Progress, useTheme} from '../ui/kit';
import DepotWebView, {Commands} from '../specs/DepotWebViewNativeComponent';
import type {DepotWebViewType} from '../specs/DepotWebViewNativeComponent';
import type {SocialAppKind} from '../types';

export function normalizeWebUrl(raw: string) {
  const t = raw.trim();
  if (!t) return '';
  if (/^[a-z][a-z0-9+.-]*:/i.test(t)) return t;
  if (t.startsWith('//')) return `https:${t}`;
  return `https://${t}`;
}

export function webUrlHost(value: string) {
  const m = /^[a-z][a-z0-9+.-]*:\/\/([^/?#]+)/i.exec(normalizeWebUrl(value));
  return m ? m[1].replace(/^www\./, '') : value;
}

export const SOCIAL_APPS: Record<
  SocialAppKind,
  {title: string; url: string; icon: IconName; tint: string; pkg: string}
> = {
  facebook: {
    title: 'Facebook',
    url: 'https://www.facebook.com/',
    icon: 'facebook',
    tint: BRAND.facebook,
    pkg: 'com.facebook.katana',
  },
  instagram: {
    title: 'Instagram',
    url: 'https://www.instagram.com/',
    icon: 'instagram',
    tint: BRAND.instagram,
    pkg: 'com.instagram.android',
  },
};

/**
 * A browser tab, or a dedicated web-app tab. App mode drops the address bar for
 * branded chrome and takes over the hardware back button, so a social tab reads
 * as its own app rather than a page parked inside a file manager.
 */
export const WebPane = memo(function WebPane({
  url,
  app,
  focused = true,
  onUrl,
  onError,
  onClose,
  onExitImmersive,
}: {
  url: string;
  app?: SocialAppKind;
  /** Only the focused tab may claim the hardware back button. */
  focused?: boolean;
  onUrl: (url: string) => void;
  onError: (message: string) => void;
  onClose?: () => void;
  /** Leaves full-screen app chrome without closing the tab. */
  onExitImmersive?: () => void;
}) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const ref = useRef<React.ElementRef<DepotWebViewType> | null>(null);
  const config = app ? SOCIAL_APPS[app] : null;

  const [address, setAddress] = useState(url);
  const [draft, setDraft] = useState(url);
  const [nav, setNav] = useState({canGoBack: false, canGoForward: false, loading: false, progress: 0});
  const [popup, setPopup] = useState(false);
  const [menu, setMenu] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [image, setImage] = useState<string | null>(null);
  const [installed, setInstalled] = useState(false);
  const [desktop, setDesktop] = useState(false);
  const editing = useRef(false);

  useEffect(() => {
    if (!config) return;
    let alive = true;
    api
      .hasInstalledApp(config.pkg)
      .then(has => alive && setInstalled(has))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [config]);

  useEffect(() => {
    if (!note) return;
    const id = setTimeout(() => setNote(null), 4000);
    return () => clearTimeout(id);
  }, [note]);

  useEffect(() => {
    if (!image) return;
    const id = setTimeout(() => setImage(null), 6000);
    return () => clearTimeout(id);
  }, [image]);

  /**
   * Back walks the page before it touches Depot. The native `goBack` already
   * prefers dismissing a sign-in popup, so the order ends up: popup, page
   * history, then the shell.
   */
  const goBack = useCallback(() => {
    if (popup || nav.canGoBack) {
      if (ref.current) Commands.goBack(ref.current);
      return true;
    }
    if (onExitImmersive) {
      onExitImmersive();
      return true;
    }
    if (onClose) {
      onClose();
      return true;
    }
    return false;
  }, [nav.canGoBack, onClose, onExitImmersive, popup]);

  useEffect(() => {
    if (!focused) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', goBack);
    return () => sub.remove();
  }, [focused, goBack]);

  const onNavigation = useCallback(
    (e: {
      nativeEvent: {
        url: string;
        title: string;
        loading: boolean;
        canGoBack: boolean;
        canGoForward: boolean;
        progress: number;
      };
    }) => {
      const n = e.nativeEvent;
      setNav({
        canGoBack: n.canGoBack,
        canGoForward: n.canGoForward,
        loading: n.loading,
        progress: n.progress,
      });
      if (!n.url || n.url === address) {
        return;
      }
      setAddress(n.url);
      if (!editing.current) {
        setDraft(n.url);
      }
      onUrl(n.url);
    },
    [address, onUrl],
  );

  const go = useCallback((raw: string) => {
    const target = normalizeWebUrl(raw);
    if (!target || !ref.current) {
      return;
    }
    editing.current = false;
    setAddress(target);
    setDraft(target);
    Commands.loadUrl(ref.current, target);
  }, []);

  const handOff = useCallback(async () => {
    if (!config) return;
    const opened = await api.openInstalledApp(config.pkg, address).catch(() => false);
    // Missing app is not a failure — the page stays right here.
    if (!opened) setNote(`${config.title} is not installed, so this stays in Depot`);
  }, [address, config]);

  return (
    <View style={{flex: 1, backgroundColor: t.bg}}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 4,
          paddingTop: config ? insets.top : 0,
          paddingHorizontal: 6,
          paddingVertical: 6,
          borderBottomWidth: 1,
          borderBottomColor: t.divider,
          backgroundColor: t.surface,
        }}>
        <IconBtn
          icon="back"
          label="Back"
          disabled={!nav.canGoBack && !popup}
          onPress={() => ref.current && Commands.goBack(ref.current)}
        />
        {config ? null : (
          <IconBtn
            icon="forward"
            label="Forward"
            disabled={!nav.canGoForward}
            onPress={() => ref.current && Commands.goForward(ref.current)}
          />
        )}
        <IconBtn
          icon="reload"
          label="Reload"
          onPress={() => ref.current && Commands.reload(ref.current)}
        />

        {config ? (
          <View
            style={{
              flex: 1,
              flexDirection: 'row',
              alignItems: 'center',
              gap: 8,
              paddingHorizontal: 4,
            }}>
            <View
              style={{
                width: 24,
                height: 24,
                borderRadius: radius.sm,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: config.tint,
              }}>
              <Icon name={config.icon} size={14} color="#fff" />
            </View>
            <Text style={{color: t.text, fontWeight: '700', fontSize: 14}} numberOfLines={1}>
              {config.title}
            </Text>
          </View>
        ) : (
          <TextInput
            value={draft}
            onChangeText={setDraft}
            onFocus={() => {
              editing.current = true;
            }}
            onBlur={() => {
              editing.current = false;
              setDraft(address);
            }}
            onSubmitEditing={() => go(draft)}
            placeholder="Type a URL"
            placeholderTextColor={t.neutral600}
            selectTextOnFocus
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            returnKeyType="go"
            style={{
              flex: 1,
              minHeight: 38,
              paddingHorizontal: 12,
              fontSize: 13.5,
              color: t.text,
              backgroundColor: t.raised,
              borderWidth: 1,
              borderColor: t.divider,
              borderRadius: radius.pill,
            }}
          />
        )}

        {config ? (
          <>
            {onExitImmersive ? (
              <Pressable
                onPress={onExitImmersive}
                accessibilityLabel="Back to Depot"
                style={{
                  paddingHorizontal: 10,
                  paddingVertical: 6,
                  borderRadius: radius.pill,
                  borderWidth: 1,
                  borderColor: t.divider,
                  backgroundColor: t.raised,
                }}>
                <Text style={{color: t.neutral700, fontSize: 11.5, fontWeight: '700'}}>Depot</Text>
              </Pressable>
            ) : null}
            <IconBtn icon="more" label="More" onPress={() => setMenu(true)} />
          </>
        ) : (
          <Btn
            label="Browser"
            small
            onPress={() =>
              api.openUrl(address).catch(e => onError(e instanceof Error ? e.message : String(e)))
            }
          />
        )}
      </View>

      {nav.loading ? <Progress percent={nav.progress} /> : null}

      {/* A sign-in popup is a real child webview parked over the page, so it
          keeps `window.opener` and the provider can hand the result back. */}
      {popup ? (
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 10,
            paddingHorizontal: 12,
            paddingVertical: 8,
            backgroundColor: t.accent100,
          }}>
          <Icon name="warn" size={15} color={t.accent700} />
          <Text style={{color: t.accent700, fontSize: 12, flex: 1}}>Sign-in window</Text>
          <Btn label="Close" small onPress={() => ref.current && Commands.closePopup(ref.current)} />
        </View>
      ) : null}

      {image ? (
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 10,
            paddingLeft: 12,
            paddingRight: 6,
            paddingVertical: 6,
            backgroundColor: t.accent2_100,
          }}>
          <Icon name="image" size={15} color={t.accent2_700} />
          <Text style={{color: t.accent2_700, fontSize: 12, flex: 1}} numberOfLines={1}>
            Picture
          </Text>
          <Btn
            label="Save to Depot"
            small
            kind="primary"
            onPress={() => {
              if (ref.current && image) Commands.saveUrl(ref.current, image);
              setImage(null);
            }}
          />
          <IconBtn icon="close" size={15} label="Dismiss" onPress={() => setImage(null)} />
        </View>
      ) : null}

      {note ? (
        <View style={{paddingHorizontal: 12, paddingVertical: 7, backgroundColor: t.neutral200}}>
          <Text style={{color: t.neutral800, fontSize: 12}} numberOfLines={2}>
            {note}
          </Text>
        </View>
      ) : null}

      <DepotWebView
        ref={ref}
        url={url}
        // Only app tabs need to stop looking like an embedded view; a plain
        // browser tab has no reason to hide what it is.
        userAgent={desktop ? 'desktop' : config ? 'chrome' : 'default'}
        style={{flex: 1}}
        onNavigation={onNavigation}
        onPopup={e => setPopup(e.nativeEvent.open)}
        onDownload={e => setNote(`Saved ${e.nativeEvent.name} to your Download folder`)}
        onImage={e => setImage(e.nativeEvent.url)}
        onWebError={e => onError(e.nativeEvent.message)}
      />

      <Modal visible={menu} transparent animationType="fade" onRequestClose={() => setMenu(false)}>
        <Pressable
          onPress={() => setMenu(false)}
          style={{flex: 1, backgroundColor: t.scrim, justifyContent: 'flex-end'}}>
          <Pressable
            onPress={() => undefined}
            style={{
              backgroundColor: t.bg,
              borderTopLeftRadius: 18,
              borderTopRightRadius: 18,
              paddingTop: 14,
              paddingBottom: insets.bottom + 12,
            }}>
            <ScrollView contentContainerStyle={{paddingVertical: 4}}>
              {installed && config ? (
                <MenuRow
                  icon={config.icon}
                  label={`Open in ${config.title}`}
                  onPress={() => {
                    setMenu(false);
                    void handOff();
                  }}
                />
              ) : null}
              <MenuRow
                icon="external"
                label="Open in system browser"
                onPress={() => {
                  setMenu(false);
                  void api.openUrl(address).catch(e => onError(String(e)));
                }}
              />
              <MenuRow
                icon="reload"
                label="Reload"
                onPress={() => {
                  setMenu(false);
                  if (ref.current) Commands.reload(ref.current);
                }}
              />
              <MenuRow
                icon={desktop ? 'desktop' : 'panelRight'}
                label={desktop ? 'Back to the mobile site' : 'Request desktop site'}
                onPress={() => {
                  setMenu(false);
                  // Changing the agent reloads the page natively.
                  setDesktop(v => !v);
                }}
              />
              <Divider />
              <MenuRow
                icon="panelLeft"
                label="Back to Depot"
                onPress={() => {
                  setMenu(false);
                  onExitImmersive?.();
                }}
              />
              {onClose ? (
                <MenuRow
                  icon="close"
                  label="Close this app"
                  onPress={() => {
                    setMenu(false);
                    onClose();
                  }}
                />
              ) : null}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
});

const MenuRow = memo(function MenuRow({
  icon,
  label,
  onPress,
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
}) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      android_ripple={{color: t.divider}}
      style={{flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 18, paddingVertical: 14}}>
      <Icon name={icon} size={18} color={t.neutral700} />
      <Text style={{color: t.text, fontSize: 15}}>{label}</Text>
    </Pressable>
  );
});
