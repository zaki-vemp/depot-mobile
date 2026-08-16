import React, {useEffect, useState} from 'react';
import {Modal, Pressable, ScrollView, View} from 'react-native';
import {api} from '../api';
import {Btn, Heading, Muted, useTheme} from '../ui/kit';
import {radius} from '../theme';
import type {OpenApp} from '../types';

/**
 * The desktop's "Open with" fly-out, as a sheet. `bar` mirrors the inline
 * Default-app / Open-with pair the desktop shows above previews.
 */
export function OpenWithMenu({
  path,
  onError,
  onPicked,
  variant = 'bar',
}: {
  path: string;
  onError: (message: string) => void;
  onPicked?: () => void;
  variant?: 'bar' | 'button';
}) {
  const t = useTheme();
  const [apps, setApps] = useState<OpenApp[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!path || !open) {
      return;
    }
    let alive = true;
    api
      .listOpenWith(path)
      .then(list => alive && setApps(list))
      .catch(() => alive && setApps([]));
    return () => {
      alive = false;
    };
  }, [path, open]);

  const run = async (app: string) => {
    setOpen(false);
    try {
      if (app === '__pick__') {
        await api.pickOpenWith(path);
      } else {
        await api.openWithApp(path, app);
      }
      onPicked?.();
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <>
      {variant === 'bar' ? (
        <View style={{flexDirection: 'row', gap: 8}}>
          <Btn
            label="Default app"
            small
            onPress={() =>
              api.openSystem(path).catch(e => onError(e instanceof Error ? e.message : String(e)))
            }
          />
          <Btn label="Open with" small onPress={() => setOpen(true)} />
        </View>
      ) : (
        <Btn label="Open with…" block onPress={() => setOpen(true)} />
      )}

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable
          onPress={() => setOpen(false)}
          style={{flex: 1, backgroundColor: t.scrim, justifyContent: 'flex-end'}}>
          <Pressable
            onPress={() => undefined}
            style={{
              backgroundColor: t.bg,
              borderTopLeftRadius: 18,
              borderTopRightRadius: 18,
              paddingTop: 16,
              paddingBottom: 24,
              maxHeight: '72%',
            }}>
            <View style={{paddingHorizontal: 18, paddingBottom: 10}}>
              <Heading size={17}>Open with</Heading>
              <Muted numberOfLines={1}>{path}</Muted>
            </View>
            <ScrollView contentContainerStyle={{paddingHorizontal: 14, gap: 6}}>
              {apps.map(a => (
                <Pressable
                  key={a.path}
                  onPress={() => void run(a.path)}
                  android_ripple={{color: t.divider}}
                  style={{
                    paddingVertical: 13,
                    paddingHorizontal: 14,
                    borderRadius: radius.md,
                    backgroundColor: t.raised,
                    borderWidth: 1,
                    borderColor: t.divider,
                  }}>
                  <Heading size={14.5}>
                    {a.name}
                    {a.isDefault ? ' · Default' : ''}
                  </Heading>
                </Pressable>
              ))}
              <Btn label="Other…" block onPress={() => void run('__pick__')} />
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}
