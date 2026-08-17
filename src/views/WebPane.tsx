import React, {memo, useCallback, useRef, useState} from 'react';
import {Text, TextInput, View} from 'react-native';
import {api} from '../api';
import {Icon, type IconName} from '../lib/icons';
import {BRAND, radius} from '../theme';
import {Btn, IconBtn, Progress, useTheme} from '../ui/kit';
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
  {title: string; url: string; icon: IconName; tint: string}
> = {
  facebook: {
    title: 'Facebook',
    url: 'https://www.facebook.com/',
    icon: 'facebook',
    tint: BRAND.facebook,
  },
  instagram: {
    title: 'Instagram',
    url: 'https://www.instagram.com/',
    icon: 'instagram',
    tint: BRAND.instagram,
  },
};

/**
 * A browser tab, or a dedicated web-app tab. App mode keeps the URL fixed
 * behind branded chrome exactly like the desktop build.
 */
export const WebPane = memo(function WebPane({
  url,
  app,
  onUrl,
  onError,
}: {
  url: string;
  app?: SocialAppKind;
  onUrl: (url: string) => void;
  onError: (message: string) => void;
}) {
  const t = useTheme();
  const ref = useRef<React.ElementRef<DepotWebViewType> | null>(null);
  const config = app ? SOCIAL_APPS[app] : null;

  const [address, setAddress] = useState(url);
  const [draft, setDraft] = useState(url);
  const [nav, setNav] = useState({canGoBack: false, canGoForward: false, loading: false, progress: 0});
  const [popup, setPopup] = useState(false);
  const editing = useRef(false);

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

  const go = useCallback(
    (raw: string) => {
      const target = normalizeWebUrl(raw);
      if (!target || !ref.current) {
        return;
      }
      editing.current = false;
      setAddress(target);
      setDraft(target);
      Commands.loadUrl(ref.current, target);
    },
    [],
  );

  return (
    <View style={{flex: 1, backgroundColor: t.bg}}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 4,
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
        <IconBtn
          icon="forward"
          label="Forward"
          disabled={!nav.canGoForward}
          onPress={() => ref.current && Commands.goForward(ref.current)}
        />
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
            <Text
              style={{color: t.neutral600, fontSize: 11.5, flex: 1, textAlign: 'right'}}
              numberOfLines={1}>
              {webUrlHost(address)}
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

        <Btn
          label={app ? 'Open' : 'Browser'}
          small
          onPress={() =>
            api.openUrl(address).catch(e => onError(e instanceof Error ? e.message : String(e)))
          }
        />
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
          <Btn
            label="Close"
            small
            onPress={() => ref.current && Commands.closePopup(ref.current)}
          />
        </View>
      ) : null}

      <DepotWebView
        ref={ref}
        url={url}
        style={{flex: 1}}
        onNavigation={onNavigation}
        onPopup={e => setPopup(e.nativeEvent.open)}
        onWebError={e => onError(e.nativeEvent.message)}
      />
    </View>
  );
});
