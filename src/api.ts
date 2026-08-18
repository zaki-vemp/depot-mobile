import {NativeEventEmitter, NativeModules} from 'react-native';
import type {
  AppSettings,
  DirEntry,
  DiskUsage,
  DriveAccount,
  GitRepo,
  OfficePreview,
  OcrResult,
  OpenApp,
  PdfPage,
  PlaybackMark,
  Place,
  ShareDone,
  ShareOffer,
  SharePeer,
  ShareProgress,
  ShareStatus,
  SubtitleTrack,
  TermData,
  TermExit,
  TorrentInfo,
  TransferEvent,
  UiPrefs,
} from './types';

type DepotNative = {
  /** Single JSON bridge: Kotlin answers what it owns, the C++ core answers the rest. */
  call(method: string, args: string): Promise<string>;
  startTransfer(id: string, from: string, to: string, op: string): Promise<void>;
  cancelTransfer(id: string): Promise<void>;
  termOpen(id: string, cwd: string, cols: number, rows: number): Promise<void>;
  termWrite(id: string, data: string): Promise<void>;
  termResize(id: string, cols: number, rows: number): Promise<void>;
  termClose(id: string): Promise<void>;
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
  readText: (path: string, maxBytes = 2 * 1024 * 1024) => call<string>('readText', {path, maxBytes}),
  writeText: (path: string, contents: string) => call<void>('writeText', {path, contents}),
  createFile: (path: string) => call<void>('createFile', {path}),
  isTextFile: (path: string) => call<boolean>('isTextFile', {path}),
  mkdir: (path: string) => call<void>('mkdir', {path}),
  rename: (from: string, to: string) => call<void>('rename', {from, to}),
  remove: (path: string) => call<void>('remove', {path}),
  trash: (path: string) => call<void>('trash', {path}),
  emptyTrash: () => call<void>('emptyTrash'),
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
  /** Needs a matching `<queries><package>` entry in the manifest to ever be true. */
  hasInstalledApp: (pkg: string) => call<boolean>('hasInstalledApp', {package: pkg}),
  /** False when the app is not installed, so the caller can stay in Depot. */
  openInstalledApp: (pkg: string, url: string) =>
    call<boolean>('openInstalledApp', {package: pkg, url}),

  /* ── viewers ────────────────────────────────────────────── */
  previewOffice: (path: string) => call<OfficePreview>('previewOffice', {path}),
  /** Renders PDF pages to cached bitmaps via Android's own PdfRenderer. */
  renderPdf: (path: string, from = 0, count = 6) =>
    call<{pages: PdfPage[]; total: number}>('renderPdf', {path, from, count}),
  listSubtitles: (path: string) => call<SubtitleTrack[]>('listSubtitles', {path}),
  /** On-device OCR; the image never leaves the phone. */
  ocrImage: (path: string) => call<OcrResult>('ocrImage', {path}),
  setClipboard: (text: string) => call<void>('setClipboard', {text}),

  /* ── player ─────────────────────────────────────────────── */
  /** Where playback of this file left off, or null if it was never played. */
  playback: (path: string) => call<PlaybackMark | null>('getPlayback', {path}),
  savePlayback: (path: string, position: number, duration: number) =>
    call<void>('savePlayback', {path, position, duration}),
  forgetPlayback: (path: string) => call<void>('forgetPlayback', {path}),
  /** Pins the activity while a video plays; `auto` hands rotation back to Android. */
  setOrientation: (mode: 'auto' | 'landscape' | 'portrait') =>
    call<void>('setOrientation', {mode}),
  /** Window-local brightness, 0–1; a negative value restores the system setting. */
  setBrightness: (value: number) => call<void>('setBrightness', {value}),
  /** Needed on Android 13+ before the media transport notification can show. */
  requestNotifications: () => call<void>('requestNotifications'),

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
  trashDrive: (path: string) => call<void>('trashDrive', {path}),
  renameDrive: (path: string, name: string) => call<void>('renameDrive', {path, name}),

  /* ── git (C++ spawn of the system git, same contract as desktop) ── */
  gitInfo: (cwd: string) => call<GitRepo | null>('gitInfo', {cwd}),
  gitShow: (root: string, rev: string, path: string) => call<string>('gitShow', {root, rev, path}),
  gitStage: (root: string, paths: string[]) => call<void>('gitStage', {root, paths}),
  gitUnstage: (root: string, paths: string[]) => call<void>('gitUnstage', {root, paths}),
  gitDiscard: (root: string, paths: string[]) => call<void>('gitDiscard', {root, paths}),
  gitCommit: (root: string, message: string, amend = false) =>
    call<string>('gitCommit', {root, message, amend}),

  /* ── nearby sharing ─────────────────────────────────────── */
  /** Starts advertising on the local network and listening for offers. */
  shareStart: () => call<ShareStatus>('shareStart'),
  shareStop: () => call<void>('shareStop'),
  shareStatus: () => call<ShareStatus>('shareStatus'),
  sharePeers: () => call<SharePeer[]>('sharePeers'),
  /** Folders are walked natively; returns a transfer id, progress is an event. */
  shareSend: (peerId: string, paths: string[]) => call<string>('shareSend', {peerId, paths}),
  shareRespond: (id: string, accept: boolean) => call<void>('shareRespond', {id, accept}),

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
  termOpen: (id: string, cwd: string, cols: number, rows: number) => {
    if (!native) {
      return Promise.reject(new Error(MISSING));
    }
    return native.termOpen(id, cwd, cols, rows);
  },
  termWrite: (id: string, data: string) => {
    if (!native) {
      return Promise.reject(new Error(MISSING));
    }
    return native.termWrite(id, data);
  },
  termResize: (id: string, cols: number, rows: number) => {
    if (!native) {
      return Promise.reject(new Error(MISSING));
    }
    return native.termResize(id, cols, rows);
  },
  termClose: (id: string) => {
    if (!native) {
      return Promise.reject(new Error(MISSING));
    }
    return native.termClose(id);
  },
};

export function onTransfer(handler: (e: TransferEvent) => void) {
  if (!emitter) {
    return () => undefined;
  }
  const sub = emitter.addListener('transfer', payload => handler(payload as TransferEvent));
  return () => sub.remove();
}

export function onTermData(handler: (e: TermData) => void) {
  if (!emitter) {
    return () => undefined;
  }
  const sub = emitter.addListener('term:data', payload => handler(payload as TermData));
  return () => sub.remove();
}

export function onTermExit(handler: (e: TermExit) => void) {
  if (!emitter) {
    return () => undefined;
  }
  const sub = emitter.addListener('term:exit', payload => handler(payload as TermExit));
  return () => sub.remove();
}

export type ShareEvent =
  | {kind: 'peers'; peers: SharePeer[]}
  | {kind: 'offer'; offer: ShareOffer}
  | {kind: 'progress'; progress: ShareProgress}
  | {kind: 'done'; done: ShareDone};

/**
 * The share engine's four events, folded into one stream. Their payloads are
 * already JSON on the native side, so they cross the bridge as a string rather
 * than through a hand-written map converter.
 */
export function onShare(handler: (e: ShareEvent) => void) {
  if (!emitter) {
    return () => undefined;
  }
  const read = (payload: unknown) => {
    try {
      return JSON.parse((payload as {json: string}).json);
    } catch {
      return null;
    }
  };
  const subs = [
    emitter.addListener('share:peers', p => {
      const v = read(p);
      if (v) handler({kind: 'peers', peers: v.peers as SharePeer[]});
    }),
    emitter.addListener('share:offer', p => {
      const v = read(p);
      if (v) handler({kind: 'offer', offer: v as ShareOffer});
    }),
    emitter.addListener('share:progress', p => {
      const v = read(p);
      if (v) handler({kind: 'progress', progress: v as ShareProgress});
    }),
    emitter.addListener('share:done', p => {
      const v = read(p);
      if (v) handler({kind: 'done', done: v as ShareDone});
    }),
  ];
  return () => subs.forEach(s => s.remove());
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

export function parentDir(path: string) {
  const trimmed = path.replace(/\/+$/, '');
  const cut = trimmed.lastIndexOf('/');
  if (cut <= 0) {
    return '/';
  }
  return trimmed.slice(0, cut);
}

export function driveDestPath(accountId: string, folderId: string | undefined, name: string) {
  return `gdrive://${accountId}/${folderId || 'root'}/${encodeURIComponent(name)}`;
}
