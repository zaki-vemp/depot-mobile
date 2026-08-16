import React, {memo, useState} from 'react';
import {Pressable, Text, View} from 'react-native';
import {formatBytes} from '../lib/files';
import {Icon, type IconName} from '../lib/icons';
import {BRAND, radius} from '../theme';
import {Btn, Heading, Muted, Page, Progress, Stack, Tag, useTheme} from '../ui/kit';
import type {AppSettings, DiskUsage, DriveAccount, Place, SocialAppKind} from '../types';

const TONES: Record<string, string> = {
  google: BRAND.google,
  microsoft: BRAND.microsoft,
  dropbox: BRAND.dropbox,
  facebook: BRAND.facebook,
  instagram: BRAND.instagram,
};

function ProviderMark({label, tone}: {label: string; tone?: string}) {
  const t = useTheme();
  const bg = tone ? TONES[tone] : undefined;
  return (
    <View
      style={{
        width: 34,
        height: 34,
        borderRadius: radius.md,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: bg ?? t.neutral300,
      }}>
      <Text style={{color: bg ? '#fff' : t.neutral800, fontWeight: '700', fontSize: 15}}>
        {label}
      </Text>
    </View>
  );
}

export function ProviderHeading({
  mark,
  tone,
  title,
  icon,
  status,
}: {
  mark?: string;
  tone?: string;
  title: string;
  icon?: IconName;
  status?: string;
}) {
  const t = useTheme();
  return (
    <View style={{flexDirection: 'row', alignItems: 'center', gap: 11}}>
      {mark ? (
        <ProviderMark label={mark} tone={tone} />
      ) : (
        <View
          style={{
            width: 34,
            height: 34,
            borderRadius: radius.md,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: t.neutral300,
          }}>
          <Icon name={icon || 'cloud'} size={19} color={t.neutral800} />
        </View>
      )}
      <View style={{flex: 1}}>
        <Heading size={15.5}>{title}</Heading>
        {status ? <Muted size={12}>{status}</Muted> : null}
      </View>
    </View>
  );
}

export const ConnectionsView = memo(function ConnectionsView({
  accounts,
  driveQuota,
  places,
  settings,
  volumeUsage,
  footer,
  onConfigure,
  onConnectGoogle,
  onDisconnectGoogle,
  onOpenGoogle,
  onOpenLocal,
  onOpenWeb,
  onOpenSocial,
  onError,
}: {
  accounts: DriveAccount[];
  driveQuota: Record<string, DiskUsage>;
  places: Place[];
  settings: AppSettings;
  volumeUsage: Record<string, DiskUsage>;
  footer: number;
  onConfigure: () => void;
  onConnectGoogle: () => Promise<void>;
  onDisconnectGoogle: (accountId: string) => Promise<void>;
  onOpenGoogle: (account: DriveAccount) => void;
  onOpenLocal: (place: Place) => void;
  onOpenWeb: (url: string) => void;
  onOpenSocial: (app: SocialAppKind) => void;
  onError: (message: string) => void;
}) {
  const t = useTheme();
  const [connecting, setConnecting] = useState(false);

  const googleReady = Boolean(settings.googleClientId.trim() && settings.googleClientSecret.trim());
  const oneDriveReady = Boolean(settings.oneDriveClientId.trim());
  const dropboxReady = Boolean(settings.dropboxClientId.trim());
  const s3Ready = Boolean(
    settings.s3Region.trim() &&
      settings.s3Bucket.trim() &&
      settings.s3AccessKeyId.trim() &&
      settings.s3SecretAccessKey.trim(),
  );

  const card = {
    gap: 12,
    padding: 16,
    borderRadius: radius.lg,
    backgroundColor: t.raised,
    borderWidth: 1,
    borderColor: t.divider,
  } as const;

  const connectGoogle = async () => {
    setConnecting(true);
    try {
      await onConnectGoogle();
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setConnecting(false);
    }
  };

  return (
    <Page footer={footer}>
      <View style={{gap: 10}}>
        <Heading size={24}>Connections</Heading>
        <Muted>
          Keep several Google accounts beside web access to your other storage and social apps.
        </Muted>
        <Btn label="Provider settings" onPress={onConfigure} />
      </View>

      <Stack gap={12}>
        <View style={{flexDirection: 'row', alignItems: 'center', gap: 10}}>
          <Heading size={18} style={{flex: 1}}>
            Cloud storage
          </Heading>
          <Tag
            label={`${accounts.length} Google account${accounts.length === 1 ? '' : 's'}`}
            tone="accent2"
          />
        </View>

        <View style={card}>
          <ProviderHeading
            mark="G"
            tone="google"
            title="Google Drive"
            status={googleReady ? 'OAuth ready' : 'Add OAuth credentials'}
          />
          <Muted size={12.5}>
            Browse, preview and copy files between Google accounts and this device. Sign in again to
            add another account; reconnecting the same email refreshes it without creating a
            duplicate.
          </Muted>
          <Btn
            label={connecting ? 'Waiting for Google…' : 'Sign in with Google'}
            kind="primary"
            block
            disabled={!googleReady || connecting}
            onPress={() => void connectGoogle()}
          />
          {!googleReady ? <Btn label="Add client ID" block onPress={onConfigure} /> : null}

          {!accounts.length ? <Muted size={12.5}>No Google accounts connected yet.</Muted> : null}
          {accounts.map(account => {
            const quota = driveQuota[account.id];
            const used = quota ? quota.total - quota.free : 0;
            const percent = quota?.total ? Math.round((used / quota.total) * 100) : 0;
            return (
              <View key={account.id} style={{gap: 8, paddingTop: 4}}>
                <View style={{flexDirection: 'row', alignItems: 'center', gap: 10}}>
                  <ProviderMark label={account.email.slice(0, 1).toUpperCase()} />
                  <View style={{flex: 1}}>
                    <Heading size={14}>{account.email}</Heading>
                    <Muted size={12}>
                      {quota
                        ? `${formatBytes(used)} of ${formatBytes(quota.total)} used`
                        : 'Connected'}
                    </Muted>
                  </View>
                </View>
                {quota ? <Progress percent={percent} /> : null}
                <View style={{flexDirection: 'row', gap: 8}}>
                  <Btn label="Open" small onPress={() => onOpenGoogle(account)} />
                  <Btn
                    label="Disconnect"
                    kind="danger"
                    small
                    onPress={() =>
                      void onDisconnectGoogle(account.id).catch(e =>
                        onError(e instanceof Error ? e.message : String(e)),
                      )
                    }
                  />
                </View>
              </View>
            );
          })}
        </View>

        <View style={card}>
          <ProviderHeading
            mark="M"
            tone="microsoft"
            title="OneDrive"
            status={oneDriveReady ? 'Credentials saved' : 'Setup available'}
          />
          <Muted size={12.5}>
            Use OneDrive in a Depot web tab now. Client credentials are stored for the native
            file-browser adapter.
          </Muted>
          <Btn
            label="Open & sign in"
            kind="primary"
            block
            onPress={() => onOpenWeb('https://onedrive.live.com/')}
          />
          <Btn
            label={oneDriveReady ? 'Edit API setup' : 'Configure API'}
            block
            onPress={onConfigure}
          />
        </View>

        <View style={card}>
          <ProviderHeading
            mark="D"
            tone="dropbox"
            title="Dropbox"
            status={dropboxReady ? 'Credentials saved' : 'Setup available'}
          />
          <Muted size={12.5}>
            Open the Dropbox website inside Depot. OAuth values can be added now without committing
            secrets to the repo.
          </Muted>
          <Btn
            label="Open & sign in"
            kind="primary"
            block
            onPress={() => onOpenWeb('https://www.dropbox.com/home')}
          />
          <Btn
            label={dropboxReady ? 'Edit API setup' : 'Configure API'}
            block
            onPress={onConfigure}
          />
        </View>

        <View style={card}>
          <ProviderHeading
            icon="bucket"
            title="Amazon S3"
            status={s3Ready ? 'Profile saved' : 'Access-key setup'}
          />
          <Muted size={12.5}>
            S3 uses a bucket, region and access-key profile instead of browser OAuth. A custom
            endpoint supports compatible services.
          </Muted>
          <Btn label={s3Ready ? 'Edit S3 profile' : 'Configure S3'} block onPress={onConfigure} />
        </View>
      </Stack>

      <Stack gap={12}>
        <Heading size={18}>Social apps</Heading>
        <Muted size={12.5}>
          These open as dedicated Depot apps with their own tabs and persistent web sessions. Depot
          never sees your password.
        </Muted>
        <View style={card}>
          <ProviderHeading mark="f" tone="facebook" title="Facebook" status="Depot app" />
          <Btn
            label="Open Facebook app"
            kind="primary"
            block
            onPress={() => onOpenSocial('facebook')}
          />
        </View>
        <View style={card}>
          <ProviderHeading mark="◎" tone="instagram" title="Instagram" status="Depot app" />
          <Btn
            label="Open Instagram app"
            kind="primary"
            block
            onPress={() => onOpenSocial('instagram')}
          />
        </View>
      </Stack>

      <Stack gap={12}>
        <Heading size={18}>Local storage</Heading>
        <Muted size={12.5}>
          Internal storage and mounted cards stay available without an account.
        </Muted>
        {places.map(place => {
          const usage = volumeUsage[place.path];
          const used = usage ? usage.total - usage.free : 0;
          const percent = usage?.total ? Math.round((used / usage.total) * 100) : 0;
          return (
            <Pressable
              key={place.path}
              onPress={() => onOpenLocal(place)}
              android_ripple={{color: t.divider}}
              style={card}>
              <View style={{flexDirection: 'row', alignItems: 'center', gap: 11}}>
                <View
                  style={{
                    width: 34,
                    height: 34,
                    borderRadius: radius.md,
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: t.neutral300,
                  }}>
                  <Icon
                    name={place.kind === 'home' ? 'home' : 'disk'}
                    size={18}
                    color={t.neutral800}
                  />
                </View>
                <View style={{flex: 1}}>
                  <Heading size={14.5}>{place.name}</Heading>
                  <Muted size={12} numberOfLines={1}>
                    {usage
                      ? `${formatBytes(usage.free)} free of ${formatBytes(usage.total)}`
                      : place.path}
                  </Muted>
                </View>
                <Icon name="forward" size={16} color={t.neutral600} />
              </View>
              {usage ? <Progress percent={percent} /> : null}
            </Pressable>
          );
        })}
      </Stack>
    </Page>
  );
});
