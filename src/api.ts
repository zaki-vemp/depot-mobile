import {NativeEventEmitter, NativeModules} from 'react-native';
import type {
  AppSettings,
  DirEntry,
  DiskUsage,
  DriveAccount,
  OfficePreview,
  OpenApp,
  PdfPage,
  Place,
  SubtitleTrack,
  TorrentInfo,
  TransferEvent,
  UiPrefs,
} from './types';

type DepotNative = {
  /** Single JSON bridge: Kotlin answers what it owns, the C++ core answers the rest. */
  call(method: string, args: string): Promise<string>;
  startTransfer(id: string, from: string, to: string, op: string): Promise<void>;
  cancelTransfer(id: string): Promise<void>;
  addListener(eventName: string): void;
  removeListeners(count: number): void;
};

const native = NativeModules.DepotCore as DepotNative | undefined;
const emitter = native ? new NativeEventEmitter(native as never) : null;

const MISSING = 'Depot core is not linked. Rebuild the Android app.';

async function call<T>(method: string, args: Record<string, unknown> = {}): Promise<T> {
  if (!native) {
    throw new Error(MISSING);
  }
  const raw = await native.call(method, JSON.stringify(args));
  const parsed = JSON.parse(raw) as {ok: boolean; data?: T; error?: string};
  if (!parsed.ok) {
    throw new Error(parsed.error || 'Native call failed');
  }
  return parsed.data as T;
}

export const api = {
  /* ── local files (C++ core) ─────────────────────────────── */
  places: () => call<Place[]>('getPlaces'),
  home: () => call<string>('getHome'),
  listDir: (path: string) => call<DirEntry[]>('listDir', {path}),
  readText: (path: string) => call<string>('readText', {path}),
  mkdir: (path: string) => call<void>('mkdir', {path}),
  rename: (from: string, to: string) => call<void>('rename', {from, to}),
  remove: (path: string) => call<void>('remove', {path}),
  trash: (path: string) => call<void>('trash', {path}),
  copy: (from: string, to: string) => call<void>('copy', {from, to}),
  move: (from: string, to: string) => call<void>('move', {from, to}),
  parent: (path: string) => call<string | null>('parent', {path}),
  diskUsage: (path: string) => call<DiskUsage>('diskUsage', {path}),
  /** Server-side search under a root; the core walks the tree off the JS thread. */
  search: (root: string, query: string, limit = 400) =>
    call<DirEntry[]>('search', {root, query, limit}),

  /* ── Android shell ──────────────────────────────────────── */
  hasAllFilesAccess: () => call<boolean>('hasAllFilesAccess'),
  openAllFilesSettings: () => call<void>('openAllFilesSettings'),
  openSystem: (path: string) => call<void>('openInSystem', {path}),
  /** The mobile stand-in for "Reveal in Finder": hands the folder to a system browser. */
  reveal: (path: string) => call<void>('revealInSystem', {path}),
  share: (path: string) => call<void>('sharePath', {path}),
  listOpenWith: (path: string) => call<OpenApp[]>('listOpenWith', {path}),
  openWithApp: (path: string, app: string) => call<void>('openWithApp', {path, app}),
  pickOpenWith: (path: string) => call<void>('pickOpenWith', {path}),
  openUrl: (url: string) => call<void>('openUrl', {url}),

  /* ── viewers ────────────────────────────────────────────── */
  previewOffice: (path: string) => call<OfficePreview>('previewOffice', {path}),
  /** Renders PDF pages to cached bitmaps via Android's own PdfRenderer. */
  renderPdf: (path: string, from = 0, count = 6) =>
    call<{pages: PdfPage[]; total: number}>('renderPdf', {path, from, count}),
  listSubtitles: (path: string) => call<SubtitleTrack[]>('listSubtitles', {path}),

  /* ── settings ───────────────────────────────────────────── */
  settings: () => call<AppSettings>('getSettings'),
  saveSettings: (settings: AppSettings) => call<void>('saveSettings', {settings}),
  /** UI preferences live natively so the first frame already has the right theme. */
  uiPrefs: () => call<Partial<UiPrefs>>('getUiPrefs'),
  saveUiPrefs: (prefs: UiPrefs) => call<void>('saveUiPrefs', {prefs}),

  /* ── Google Drive ───────────────────────────────────────── */
  driveAccounts: () => call<DriveAccount[]>('listDriveAccounts'),
  connectDrive: () => call<DriveAccount>('connectGoogleDrive'),
  disconnectDrive: (accountId: string) => call<void>('disconnectGoogleDrive', {accountId}),
  listDrive: (accountId: string, folderId?: string | null) =>
    call<DirEntry[]>('listDrive', {accountId, folderId: folderId || null}),
  mkdirDrive: (accountId: string, folderId: string | null | undefined, name: string) =>
    call<string>('mkdirDrive', {accountId, folderId: folderId || null, name}),
  cacheDrive: (path: string, name: string) => call<string>('cacheDriveFile', {path, name}),
  driveQuota: (accountId: string) => call<DiskUsage>('driveQuota', {accountId}),

  /* ── torrents ───────────────────────────────────────────── */
  addTorrent: (magnet: string) => call<string>('addTorrent', {magnet}),
  torrents: () => call<TorrentInfo[]>('listTorrents'),
  pauseTorrent: (id: number) => call<void>('pauseTorrent', {id}),
  resumeTorrent: (id: number) => call<void>('resumeTorrent', {id}),
  removeTorrent: (id: number) => call<void>('removeTorrent', {id}),

  /* ── transfers ──────────────────────────────────────────── */
  startTransfer: (id: string, from: string, to: string, op: string) => {
    if (!native) {
      return Promise.reject(new Error(MISSING));
    }
    return native.startTransfer(id, from, to, op);
  },
  cancelTransfer: (id: string) => {
    if (!native) {
      return Promise.reject(new Error(MISSING));
    }
    return native.cancelTransfer(id);
  },
};

export function onTransfer(handler: (e: TransferEvent) => void) {
  if (!emitter) {
    return () => undefined;
  }
  const sub = emitter.addListener('transfer', payload => handler(payload as TransferEvent));
  return () => sub.remove();
}

export function fileUrl(path: string) {
  if (path.startsWith('file://') || path.startsWith('http')) {
    return path;
  }
  return `file://${encodeURI(path).replace(/#/g, '%23')}`;
}

export function joinPath(dir: string, name: string) {
  if (dir.endsWith('/')) {
    return `${dir}${name}`;
  }
  return `${dir}/${name}`;
}

export function baseName(path: string) {
  return path.split('/').filter(Boolean).pop() || path;
}

export function driveDestPath(accountId: string, folderId: string | undefined, name: string) {
  return `gdrive://${accountId}/${folderId || 'root'}/${encodeURIComponent(name)}`;
}
