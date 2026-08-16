import React, {memo} from 'react';
import {View} from 'react-native';
import {Btn, Field, Heading, Muted, Page, Stack, Toggle, useTheme} from '../ui/kit';
import {ProviderHeading} from './Connections';
import type {AppSettings, UiPrefs} from '../types';

export const SettingsView = memo(function SettingsView({
  settings,
  prefs,
  footer,
  onChange,
  onSave,
  onPref,
}: {
  settings: AppSettings;
  prefs: UiPrefs;
  footer: number;
  onChange: (next: AppSettings) => void;
  onSave: () => void;
  onPref: <K extends keyof UiPrefs>(key: K, value: UiPrefs[K]) => void;
}) {
  const t = useTheme();
  const set = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) =>
    onChange({...settings, [key]: value});

  const card = {
    gap: 12,
    padding: 16,
    borderRadius: 12,
    backgroundColor: t.raised,
    borderWidth: 1,
    borderColor: t.divider,
  } as const;

  return (
    <Page footer={footer}>
      <Stack gap={14}>
        <View>
          <Heading size={22}>Provider credentials</Heading>
          <Muted>Saved in Depot's app storage on this device, never in the repository.</Muted>
        </View>
        <Btn label="Save provider settings" kind="primary" block onPress={onSave} />

        <View style={card}>
          <ProviderHeading mark="G" tone="google" title="Google Drive" />
          <Field
            label="Client ID"
            value={settings.googleClientId}
            onChangeText={v => set('googleClientId', v)}
            placeholder="…apps.googleusercontent.com"
          />
          <Field
            label="Client secret"
            value={settings.googleClientSecret}
            onChangeText={v => set('googleClientSecret', v)}
            secure
          />
          <Muted size={12}>
            Create a Desktop OAuth client, enable the Drive API, then add
            http://127.0.0.1:17843/callback — the same client the desktop app uses.
          </Muted>
        </View>

        <View style={card}>
          <ProviderHeading mark="M" tone="microsoft" title="OneDrive" />
          <Field
            label="Application (client) ID"
            value={settings.oneDriveClientId}
            onChangeText={v => set('oneDriveClientId', v)}
          />
          <Field
            label="Client secret"
            value={settings.oneDriveClientSecret}
            onChangeText={v => set('oneDriveClientSecret', v)}
            secure
          />
          <Muted size={12}>
            Register a desktop/public client in Microsoft Entra. Native OneDrive browsing is the next
            adapter.
          </Muted>
        </View>

        <View style={card}>
          <ProviderHeading mark="D" tone="dropbox" title="Dropbox" />
          <Field
            label="App key / client ID"
            value={settings.dropboxClientId}
            onChangeText={v => set('dropboxClientId', v)}
          />
          <Field
            label="App secret"
            value={settings.dropboxClientSecret}
            onChangeText={v => set('dropboxClientSecret', v)}
            secure
          />
          <Muted size={12}>
            Create a scoped Dropbox app with file read access. Native Dropbox browsing is the next
            adapter.
          </Muted>
        </View>

        <View style={card}>
          <ProviderHeading icon="bucket" title="Amazon S3 / S3-compatible" />
          <Field
            label="Endpoint (optional)"
            value={settings.s3Endpoint}
            onChangeText={v => set('s3Endpoint', v)}
            placeholder="https://s3.amazonaws.com"
          />
          <Field
            label="Region"
            value={settings.s3Region}
            onChangeText={v => set('s3Region', v)}
            placeholder="us-east-1"
          />
          <Field label="Bucket" value={settings.s3Bucket} onChangeText={v => set('s3Bucket', v)} />
          <Field
            label="Access key ID"
            value={settings.s3AccessKeyId}
            onChangeText={v => set('s3AccessKeyId', v)}
          />
          <Field
            label="Secret access key"
            value={settings.s3SecretAccessKey}
            onChangeText={v => set('s3SecretAccessKey', v)}
            secure
          />
          <Muted size={12}>
            Prefer a least-privilege IAM user restricted to the selected bucket. S3 does not use
            social OAuth.
          </Muted>
        </View>
      </Stack>

      <Stack gap={12}>
        <Heading size={22}>Places</Heading>
        <View style={card}>
          <Field
            label="Torrent download folder"
            value={settings.torrentDownloadDir}
            onChangeText={v => set('torrentDownloadDir', v)}
            placeholder="Leave empty for the system Downloads folder"
          />
        </View>
      </Stack>

      <Stack gap={12}>
        <Heading size={22}>Behaviour</Heading>
        <Toggle
          label="Show hidden files"
          on={prefs.showHidden}
          onPress={() => onPref('showHidden', !prefs.showHidden)}
        />
        <Toggle
          label="Move to Trash instead of deleting"
          on={prefs.useTrash}
          onPress={() => onPref('useTrash', !prefs.useTrash)}
        />
        <Toggle
          label="Ask before removing files"
          on={prefs.confirmDelete}
          onPress={() => onPref('confirmDelete', !prefs.confirmDelete)}
        />
        <Toggle
          label="Hand unsupported codecs to the system player"
          on={prefs.systemFallback}
          onPress={() => onPref('systemFallback', !prefs.systemFallback)}
        />
      </Stack>

      <Stack gap={10}>
        <Heading size={22}>About</Heading>
        <View style={card}>
          <Muted size={12.5}>Depot Mobile 0.1.0 · com.depot.mobile</Muted>
          <Muted size={12.5}>React Native 0.87 · shared C++ core</Muted>
        </View>
      </Stack>
    </Page>
  );
});
