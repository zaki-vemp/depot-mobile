import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {
  ActivityIndicator,
  Modal,
  PermissionsAndroid,
  Platform,
  Pressable,
  ScrollView,
  StatusBar,
  Text,
  TextInput,
  View,
} from 'react-native';
import {SafeAreaProvider, useSafeAreaInsets} from 'react-native-safe-area-context';
import {api, baseName, driveDestPath, joinPath, onShare, onTransfer, parentDir} from './api';
import {
  chromeIconFor,
  extOf,
  formatBytes,
  formatDate,
  formatSpeed,
  iconFor,
  kindLabel,
  playsInPlayer,
  viewerKind,
} from './lib/files';
import {FileIcon, Icon, type IconName} from './lib/icons';
import {radius} from './theme';
import {
  Btn,
  Divider,
  Heading,
  IconBtn,
  KV,
  Muted,
  SideGroup,
  SideItem,
  Stack,
  Tag,
  ThemeProvider,
  useTheme,
} from './ui/kit';
import {ConnectionsView} from './views/Connections';
import {CodeEditor} from './views/CodeEditor';
import {FilesView} from './views/FilesView';
import {PreviewPane} from './views/Preview';
import {SettingsView} from './views/Settings';
import {ShareView} from './views/Share';
import {TorrentsView} from './views/Torrents';
import {TransfersView} from './views/Transfers';
import {SOCIAL_APPS, WebPane} from './views/WebPane';
import type {
  AppSettings,
  DirEntry,
  DiskUsage,
  DriveAccount,
  Place,
  ShareJob,
  ShareOffer,
  SharePeer,
  ShareStatus,
  SocialAppKind,
  SourceKind,
  Tab,
  TorrentInfo,
  Transfer,
  UiPrefs,
} from './types';

let seq = 1;
const uid = (prefix: string) => `${prefix}-${seq++}-${Date.now()}`;

/** Drawer mark for each well-known place the core reports. */
const PLACE_ICONS: Record<string, IconName> = {
  home: 'home',
  desktop: 'desktop',
  documents: 'documents',
  downloads: 'download',
  pictures: 'image',
  music: 'music',
  movies: 'film',
  videos: 'film',
  trash: 'trash',
};

const DEFAULT_PREFS: UiPrefs = {
  theme: 'light',
  view: 'grid',
  showHidden: false,
  useTrash: true,
  systemFallback: true,
  confirmDelete: true,
  sidebarOpen: false,
  inspectorOpen: false,
};

const EMPTY_SETTINGS: AppSettings = {
  googleClientId: '',
  googleClientSecret: '',
  oneDriveClientId: '',
  oneDriveClientSecret: '',
  dropboxClientId: '',
  dropboxClientSecret: '',
  s3Endpoint: '',
  s3Region: '',
  s3Bucket: '',
  s3AccessKeyId: '',
  s3SecretAccessKey: '',
  torrentDownloadDir: '',
};

function duplicateName(name: string) {
  const i = name.lastIndexOf('.');
  if (i > 0) return `${name.slice(0, i)} copy${name.slice(i)}`;
  return `${name} copy`;
}

function transferRoute(
  item: DirEntry,
  destSource: SourceKind,
  destAccountId: string | undefined,
  cut: boolean,
) {
  const fromDrive = item.source === 'gdrive';
  const toDrive = destSource === 'gdrive';
  if (fromDrive && toDrive) {
    const cross = Boolean(item.accountId && destAccountId && item.accountId !== destAccountId);
    if (cut) return cross ? 'Move Drive accounts' : 'Move on Drive';
    return cross ? 'Drive → Drive' : 'Copy on Drive';
  }
  if (fromDrive) return 'Drive → Local';
  if (toDrive) return 'Local → Drive';
  return cut ? 'Move' : 'Copy';
}

function transferOp(item: DirEntry, destSource: SourceKind, cut: boolean): Transfer['op'] {
  if (cut) return 'move';
  if (item.source === 'gdrive' && destSource === 'local') return 'download';
  if (item.source === 'local' && destSource === 'gdrive') return 'upload';
  return 'copy';
}

interface Prompt {
  title: string;
  label?: string;
  value: string;
  okLabel: string;
  danger?: boolean;
  requireExact?: string;
  onOk: (value: string) => void | Promise<void>;
}

/* ══ shell ══════════════════════════════════════════════════ */

function Shell({
  prefs,
  setPrefs,
}: {
  prefs: UiPrefs;
  setPrefs: React.Dispatch<React.SetStateAction<UiPrefs>>;
}) {
  const t = useTheme();
  const insets = useSafeAreaInsets();

  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [places, setPlaces] = useState<Place[]>([]);
  const [accounts, setAccounts] = useState<DriveAccount[]>([]);
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [activeId, setActiveId] = useState('');
  const [entries, setEntries] = useState<DirEntry[]>([]);
  const [showChrome, setShowChrome] = useState(false);
  /**
   * Which audio tab owns playback. They all stay mounted, so without an owner
   * opening a second track would leave both sounding at once. Ownership moves
   * on focus and stays put when the shell goes back to browsing files.
   */
  const [audioTab, setAudioTab] = useState<string | null>(null);
  // `openEntry` is handed to memoised rows, so it reads the listing through a
  // ref rather than taking a new identity every time the folder reloads.
  const entriesRef = useRef<DirEntry[]>([]);
  entriesRef.current = entries;
  const [selected, setSelected] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  /** Results of a recursive core search; null means "just filter this folder". */
  const [deep, setDeep] = useState<DirEntry[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [clipboard, setClipboard] = useState<{mode: 'copy' | 'cut'; items: DirEntry[]} | null>(null);
  const [quickLook, setQuickLook] = useState<DirEntry | null>(null);
  const [torrents, setTorrents] = useState<TorrentInfo[]>([]);
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [usage, setUsage] = useState<DiskUsage | null>(null);
  const [volumeUsage, setVolumeUsage] = useState<Record<string, DiskUsage>>({});
  const [driveQuota, setDriveQuota] = useState<Record<string, DiskUsage>>({});
  const [settings, setSettings] = useState<AppSettings>(EMPTY_SETTINGS);
  const [prompt, setPrompt] = useState<Prompt | null>(null);
  const [promptDraft, setPromptDraft] = useState('');
  const [menuFor, setMenuFor] = useState<DirEntry | null>(null);
  const [torrentBusy, setTorrentBusy] = useState(false);
  const [shareStatus, setShareStatus] = useState<ShareStatus>({running: false});
  const [sharePeers, setSharePeers] = useState<SharePeer[]>([]);
  const [shareJobs, setShareJobs] = useState<ShareJob[]>([]);
  const [shareOffer, setShareOffer] = useState<ShareOffer | null>(null);
  /** Files chosen for sending, waiting on a device to send them to. */
  const [sendTo, setSendTo] = useState<DirEntry[] | null>(null);

  const queueRef = useRef<Promise<void>>(Promise.resolve());
  const active = tabs.find(x => x.id === activeId) ?? tabs[0];
  const activeKind = active?.kind;

  const setPref = useCallback(
    <K extends keyof UiPrefs>(key: K, value: UiPrefs[K]) => {
      setPrefs(p => ({...p, [key]: value}));
    },
    [setPrefs],
  );

  // Each prompt opens with its own seed value.
  useEffect(() => {
    if (prompt) setPromptDraft(prompt.value);
  }, [prompt]);

  /* ── access ─────────────────────────────────────────────── */

  const refreshAccess = useCallback(async () => {
    if (Platform.OS === 'android' && Number(Platform.Version) < 30) {
      await PermissionsAndroid.requestMultiple([
        PermissionsAndroid.PERMISSIONS.READ_EXTERNAL_STORAGE,
        PermissionsAndroid.PERMISSIONS.WRITE_EXTERNAL_STORAGE,
      ]);
    }
    const ok = await api.hasAllFilesAccess().catch(() => false);
    setAllowed(ok);
    return ok;
  }, []);

  useEffect(() => {
    void refreshAccess();
  }, [refreshAccess]);

  /* ── tabs ───────────────────────────────────────────────── */

  const patchTab = useCallback((id: string, patch: Partial<Tab>) => {
    setTabs(all => all.map(x => (x.id === id ? {...x, ...patch} : x)));
  }, []);

  const pushTab = useCallback((tab: Tab) => {
    setTabs(all => [...all, tab]);
    setActiveId(tab.id);
  }, []);

  const openLocal = useCallback(
    (path: string, title?: string) => {
      const name = title || baseName(path);
      pushTab({
        id: uid('tab'),
        kind: 'files',
        title: name,
        path,
        source: 'local',
        history: [{loc: path, title: name}],
        historyIndex: 0,
      });
    },
    [pushTab],
  );

  const openDrive = useCallback(
    (account: DriveAccount) => {
      pushTab({
        id: uid('tab'),
        kind: 'files',
        title: account.email,
        path: `gdrive://${account.id}/root`,
        source: 'gdrive',
        accountId: account.id,
        folderId: 'root',
        history: [{loc: 'root', title: account.email}],
        historyIndex: 0,
      });
    },
    [pushTab],
  );

  const openEditor = useCallback(
    (folder: string, file?: string) => {
      const workspace = file ? parentDir(file) || folder : folder;
      const existing = tabs.find(x => x.kind === 'editor' && x.path === workspace);
      if (existing) {
        setTabs(all =>
          all.map(x => (x.id === existing.id && file ? {...x, file, title: baseName(file)} : x)),
        );
        setActiveId(existing.id);
        return;
      }
      pushTab({
        id: uid('edit'),
        kind: 'editor',
        title: baseName(workspace),
        path: workspace,
        file,
        source: 'local',
        history: [],
        historyIndex: -1,
      });
    },
    [pushTab, tabs],
  );

  const openToolTab = useCallback(
    (kind: Tab['kind'], title: string) => {
      const existing = tabs.find(x => x.kind === kind);
      if (existing) {
        setActiveId(existing.id);
        return;
      }
      pushTab({id: uid('tab'), kind, title, history: [], historyIndex: -1});
    },
    [pushTab, tabs],
  );

  const openWebTab = useCallback(
    (url = 'https://archive.org') => {
      pushTab({
        id: uid('tab'),
        kind: 'web',
        title: url.replace(/^https?:\/\//, ''),
        url,
        history: [],
        historyIndex: -1,
      });
    },
    [pushTab],
  );

  const openSocialApp = useCallback(
    (app: SocialAppKind) => {
      setShowChrome(false);
      const existing = tabs.find(x => x.kind === 'app' && x.app === app);
      if (existing) {
        setActiveId(existing.id);
        return;
      }
      const config = SOCIAL_APPS[app];
      pushTab({
        id: uid(`app-${app}`),
        kind: 'app',
        app,
        title: config.title,
        url: config.url,
        history: [],
        historyIndex: -1,
      });
    },
    [pushTab, tabs],
  );

  /** Next/prev inside a preview tab: same tab, new file. */
  const changeMedia = useCallback(
    (id: string, entry: DirEntry) => {
      patchTab(id, {
        title: entry.name,
        path: entry.path,
        source: entry.source,
        accountId: entry.accountId ?? undefined,
      });
    },
    [patchTab],
  );

  const closeTab = useCallback(
    (id: string) => {
      setAudioTab(owner => (owner === id ? null : owner));
      setTabs(all => {
        if (all.length === 1) return all;
        const next = all.filter(x => x.id !== id);
        if (id === activeId) setActiveId(next[next.length - 1].id);
        return next;
      });
    },
    [activeId],
  );

  /** Navigates the active files tab and records the jump for back/forward. */
  const navigate = useCallback(
    (loc: string, title: string) => {
      if (!active || active.kind !== 'files') return;
      const trimmed = active.history.slice(0, active.historyIndex + 1);
      const history = [...trimmed, {loc, title}];
      patchTab(active.id, {
        title,
        history,
        historyIndex: history.length - 1,
        ...(active.source === 'gdrive' ? {folderId: loc} : {path: loc}),
      });
    },
    [active, patchTab],
  );

  const stepHistory = useCallback(
    (delta: number) => {
      if (!active || active.kind !== 'files') return;
      const index = active.historyIndex + delta;
      const entry = active.history[index];
      if (!entry) return;
      patchTab(active.id, {
        title: entry.title,
        historyIndex: index,
        ...(active.source === 'gdrive' ? {folderId: entry.loc} : {path: entry.loc}),
      });
    },
    [active, patchTab],
  );

  const goUp = useCallback(async () => {
    if (!active || active.kind !== 'files') return;
    if (active.source === 'gdrive') {
      if (active.folderId !== 'root') navigate('root', 'Drive');
      return;
    }
    const parent = await api.parent(active.path || '').catch(() => null);
    if (parent) navigate(parent, baseName(parent));
  }, [active, navigate]);

  // Stepping away from a social tab drops back to full-screen next time it is
  // focused, so the shell chrome is a peek rather than a mode.
  useEffect(() => {
    if (activeKind !== 'app') setShowChrome(false);
  }, [activeKind]);

  useEffect(() => {
    if (activeKind === 'preview' && active && viewerKind(extOf(active.title)) === 'audio') {
      setAudioTab(active.id);
    }
  }, [active, activeKind]);

  /* ── data loading ───────────────────────────────────────── */

  const loadPlaces = useCallback(async () => {
    try {
      setPlaces(await api.places());
      setAccounts(await api.driveAccounts().catch(() => []));
    } catch (e) {
      setError(String(e));
    }
  }, []);

  useEffect(() => {
    if (!allowed) return;
    (async () => {
      await loadPlaces();
      setSettings(await api.settings().catch(() => EMPTY_SETTINGS));
      const home = await api.home().catch(() => '');
      setTabs([
        {
          id: uid('tab'),
          kind: 'files',
          title: 'Home',
          path: home,
          source: 'local',
          history: [{loc: home, title: 'Home'}],
          historyIndex: 0,
        },
      ]);
    })();
  }, [allowed, loadPlaces]);

  useEffect(() => {
    if (tabs.length && !tabs.some(x => x.id === activeId)) setActiveId(tabs[0].id);
  }, [tabs, activeId]);

  const refreshFiles = useCallback(async () => {
    if (!active || active.kind !== 'files') return;
    setBusy(true);
    setError('');
    try {
      const list =
        active.source === 'gdrive' && active.accountId
          ? await api.listDrive(
              active.accountId,
              active.folderId === 'root' ? undefined : active.folderId,
            )
          : await api.listDir(active.path || '');
      setEntries(list);
      setSelected([]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setEntries([]);
    } finally {
      setBusy(false);
    }
  }, [active]);

  useEffect(() => {
    if (activeKind === 'files') void refreshFiles();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active?.id, active?.path, active?.folderId, activeKind]);

  useEffect(
    () =>
      onShare(event => {
        switch (event.kind) {
          case 'peers':
            setSharePeers(event.peers);
            break;
          case 'offer':
            setShareOffer(event.offer);
            break;
          case 'progress':
            setShareJobs(all => {
              const row: ShareJob = {
                id: event.progress.id,
                name: event.progress.name,
                moved: event.progress.moved,
                total: event.progress.total,
                direction: event.progress.direction,
                state: 'running',
              };
              const at = all.findIndex(j => j.id === row.id);
              if (at < 0) return [row, ...all];
              return all.map(j => (j.id === row.id ? {...j, ...row} : j));
            });
            break;
          case 'done':
            setShareJobs(all =>
              all.map(j =>
                j.id === event.done.id
                  ? {
                      ...j,
                      state: event.done.state,
                      error: event.done.error,
                      folder: event.done.folder,
                      moved: event.done.state === 'done' ? j.total : j.moved,
                    }
                  : j,
              ),
            );
            // A finished receive brought new files in; the listing is stale.
            if (event.done.state === 'done') void refreshFiles();
            break;
        }
      }),
    [refreshFiles],
  );

  const toggleShare = useCallback(async (on: boolean) => {
    try {
      if (on) {
        setShareStatus(await api.shareStart());
        setSharePeers(await api.sharePeers().catch(() => []));
      } else {
        await api.shareStop();
        setShareStatus({running: false});
        setSharePeers([]);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  const sendToPeer = useCallback(
    async (peer: SharePeer, items: DirEntry[]) => {
      setSendTo(null);
      try {
        await api.shareSend(
          peer.id,
          items.map(i => i.path),
        );
        openToolTab('share', 'Nearby');
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [openToolTab],
  );


  useEffect(() => {
    if (activeKind !== 'files' || active?.source !== 'local' || !active.path) return;
    api
      .diskUsage(active.path)
      .then(setUsage)
      .catch(() => setUsage(null));
  }, [active?.path, active?.source, activeKind]);

  useEffect(() => {
    const tick = async () => {
      try {
        setTorrents(await api.torrents());
      } catch {
        /* engine idle */
      }
    };
    void tick();
    const id = setInterval(() => void tick(), 2000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (activeKind !== 'drives') return;
    for (const p of places.filter(x => x.kind === 'volume' || x.kind === 'home')) {
      api
        .diskUsage(p.path)
        .then(u => setVolumeUsage(m => ({...m, [p.path]: u})))
        .catch(() => undefined);
    }
    for (const a of accounts) {
      api
        .driveQuota(a.id)
        .then(u => setDriveQuota(m => ({...m, [a.id]: u})))
        .catch(() => undefined);
    }
  }, [activeKind, places, accounts]);

  /* ── transfers ──────────────────────────────────────────── */

  useEffect(
    () =>
      onTransfer(ev => {
        setTransfers(all =>
          all.map(x => {
            if (x.id !== ev.id) return x;
            const now = Date.now();
            const dt = Math.max(1, now - x.updatedAt) / 1000;
            const speed = ev.moved > x.moved ? (ev.moved - x.moved) / dt : x.speed;
            return {
              ...x,
              moved: ev.moved,
              total: ev.total || x.total,
              speed,
              updatedAt: now,
              state: ev.state,
              error: ev.error ?? x.error,
            };
          }),
        );
      }),
    [],
  );

  const enqueueTransfer = useCallback(
    (x: {
      op: Transfer['op'];
      from: string;
      to: string;
      name: string;
      route: string;
      total: number;
    }) => {
      const item: Transfer = {
        id: uid('tx'),
        moved: 0,
        speed: 0,
        state: 'queued',
        startedAt: Date.now(),
        updatedAt: Date.now(),
        ...x,
      };
      setTransfers(all => [item, ...all]);
      queueRef.current = queueRef.current.then(async () => {
        setTransfers(all =>
          all.map(y => (y.id === item.id ? {...y, state: 'running', updatedAt: Date.now()} : y)),
        );
        try {
          await api.startTransfer(item.id, item.from, item.to, item.op);
        } catch (e) {
          setTransfers(all =>
            all.map(y => (y.id === item.id ? {...y, state: 'error', error: String(e)} : y)),
          );
          setError(String(e));
        }
      });
      return queueRef.current;
    },
    [],
  );

  /* ── derived ────────────────────────────────────────────── */

  const visible = useMemo(() => {
    const source = deep ?? entries;
    const needle = deep ? '' : query.trim().toLowerCase();
    if (!needle && prefs.showHidden) return source;
    return source.filter(e => {
      if (!prefs.showHidden && e.name.startsWith('.')) return false;
      if (needle && !e.name.toLowerCase().includes(needle)) return false;
      return true;
    });
  }, [deep, entries, prefs.showHidden, query]);

  // A new query or location retires the previous recursive result set.
  useEffect(() => {
    setDeep(null);
  }, [query, active?.path, active?.id]);

  const searchSubfolders = useCallback(async () => {
    if (!active?.path || active.source === 'gdrive') return;
    setBusy(true);
    try {
      setDeep(await api.search(active.path, query.trim()));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [active?.path, active?.source, query]);

  const selection = useMemo(
    () => entries.filter(e => selected.includes(e.path)),
    [entries, selected],
  );
  const primary = selection[0] ?? null;

  const crumbs = useMemo(
    () =>
      active?.kind === 'files' && active.source === 'local' && active.path
        ? active.path.split('/').filter(Boolean)
        : [],
    [active?.kind, active?.source, active?.path],
  );

  const runningTransfers = transfers.filter(x => x.state === 'running' || x.state === 'queued');
  const activeTorrents = torrents.filter(x => x.progress < 1);
  const torrentSpeed = torrents.reduce((sum, x) => sum + x.downloadSpeed, 0);
  const localPlaces = places.filter(p => p.kind !== 'volume');
  const volumes = places.filter(p => p.kind === 'volume');

  /* ── operations ─────────────────────────────────────────── */

  const toggleSelect = useCallback((item: DirEntry) => {
    setSelected(cur =>
      cur.includes(item.path) ? cur.filter(p => p !== item.path) : [...cur, item.path],
    );
  }, []);

  /**
   * The media siblings of a file, in listing order, so the player and the
   * gallery can skip through the folder they were opened from. Everything here
   * is already loaded — no extra listing, and Drive folders work the same way.
   */
  const queueFor = useCallback(
    (entry: DirEntry, list: DirEntry[]) => {
      const kind = viewerKind(entry.ext);
      const wanted =
        kind === 'image'
          ? (e: DirEntry) => viewerKind(e.ext) === 'image'
          : kind === 'video' || kind === 'audio'
            ? (e: DirEntry) => playsInPlayer(e.ext)
            : null;
      if (!wanted) return undefined;
      const queue = list.filter(e => !e.isDir && wanted(e));
      return queue.length > 1 ? queue : undefined;
    },
    [],
  );

  const openEntry = useCallback(
    async (entry: DirEntry, list?: DirEntry[]) => {
      if (entry.isDir) {
        navigate(entry.source === 'gdrive' ? baseName(entry.path) : entry.path, entry.name);
        return;
      }
      const kind = viewerKind(entry.ext);
      const unplayable =
        (kind === 'video' || kind === 'audio') && !playsInPlayer(entry.ext) && entry.source === 'local';
      if ((kind === 'unknown' || unplayable) && prefs.systemFallback && entry.source === 'local') {
        await api.openSystem(entry.path).catch(e => setError(String(e)));
        return;
      }
      if (kind === 'unknown' && entry.source === 'gdrive') {
        setError('Copy this file to a local folder first, then open it.');
        return;
      }
      pushTab({
        id: uid('tab'),
        kind: 'preview',
        title: entry.name,
        path: entry.path,
        source: entry.source,
        accountId: entry.accountId ?? undefined,
        playlist: queueFor(entry, list ?? entriesRef.current),
        history: [],
        historyIndex: -1,
      });
    },
    [navigate, prefs.systemFallback, pushTab, queueFor],
  );

  /** Starts the folder at `entry`, or at its first media item when given a folder. */
  const playFolder = useCallback(
    async (entry: DirEntry) => {
      if (!entry.isDir) {
        await openEntry(entry);
        return;
      }
      try {
        const list =
          entry.source === 'gdrive'
            ? await api.listDrive(entry.accountId || '', baseName(entry.path))
            : await api.listDir(entry.path);
        const first = list.find(e => !e.isDir && playsInPlayer(e.ext));
        if (!first) {
          setError('Nothing in this folder plays in Depot.');
          return;
        }
        await openEntry(first, list);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [openEntry],
  );

  const paste = useCallback(async () => {
    if (!clipboard || !active || active.kind !== 'files') return;
    const destSource: SourceKind = active.source === 'gdrive' ? 'gdrive' : 'local';
    if (destSource === 'gdrive' && !active.accountId) {
      setError('Open a Google account folder before pasting.');
      return;
    }
    for (const item of clipboard.items) {
      const dest =
        destSource === 'gdrive' && active.accountId
          ? driveDestPath(active.accountId, active.folderId, item.name)
          : joinPath(active.path || '', item.name);
      const cut = clipboard.mode === 'cut';
      void enqueueTransfer({
        op: transferOp(item, destSource, cut),
        from: item.path,
        to: dest,
        name: item.name,
        route: transferRoute(item, destSource, active.accountId, cut),
        total: item.size,
      });
    }
    if (clipboard.mode === 'cut') setClipboard(null);
    await queueRef.current;
    await refreshFiles();
  }, [active, clipboard, enqueueTransfer, refreshFiles]);

  const removeSelected = useCallback(() => {
    const items = selection;
    if (!items.length) {
      return;
    }
    const run = async () => {
      setBusy(true);
      try {
        for (const item of items) {
          if (item.source === 'gdrive') {
            await api.trashDrive(item.path);
          } else if (prefs.useTrash) {
            await api.trash(item.path);
          } else {
            await api.remove(item.path);
          }
        }
        await refreshFiles();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
      }
    };
    if (!prefs.confirmDelete) {
      void run();
      return;
    }
    const drive = items.some(i => i.source === 'gdrive');
    setPrompt({
      title: drive
        ? `Move ${items.length} Drive item${items.length > 1 ? 's' : ''} to Google Trash?`
        : prefs.useTrash
          ? `Move ${items.length} item${items.length > 1 ? 's' : ''} to Trash?`
          : `Type DELETE to permanently remove ${items.length} item${items.length > 1 ? 's' : ''}`,
      label: items.map(i => i.name).join(', '),
      value: '',
      okLabel: drive || prefs.useTrash ? 'Move to Trash' : 'Delete',
      danger: true,
      requireExact: drive || prefs.useTrash ? undefined : 'DELETE',
      onOk: run,
    });
  }, [prefs.confirmDelete, prefs.useTrash, refreshFiles, selection]);

  const renameSelected = useCallback(() => {
    const item = selection[0];
    if (!item) return;
    setPrompt({
      title: 'Rename',
      label: item.path,
      value: item.name,
      okLabel: 'Rename',
      onOk: async name => {
        if (!name || name === item.name) return;
        try {
          if (item.source === 'gdrive') {
            await api.renameDrive(item.path, name);
          } else {
            const parent = (await api.parent(item.path)) || '';
            await api.rename(item.path, joinPath(parent, name));
          }
          await refreshFiles();
        } catch (e) {
          setError(e instanceof Error ? e.message : String(e));
        }
      },
    });
  }, [refreshFiles, selection]);

  const duplicateSelected = useCallback(async () => {
    const items = selection.filter(e => e.source === 'local');
    if (!items.length) return;
    setBusy(true);
    try {
      for (const item of items) {
        const parent = (await api.parent(item.path)) || '';
        await api.copy(item.path, joinPath(parent, duplicateName(item.name)));
      }
      await refreshFiles();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [refreshFiles, selection]);

  const newFolder = useCallback(() => {
    if (!active || active.kind !== 'files') {
      setError('Create folders in a file location.');
      return;
    }
    if (active.source === 'gdrive') {
      const accountId = active.accountId;
      if (!accountId) {
        setError('Open a Google account before creating a folder.');
        return;
      }
      const folderId = active.folderId;
      setPrompt({
        title: 'New folder',
        label: active.title,
        value: 'Untitled folder',
        okLabel: 'Create',
        onOk: async name => {
          try {
            await api.mkdirDrive(accountId, folderId === 'root' ? undefined : folderId, name);
            await refreshFiles();
          } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
          }
        },
      });
      return;
    }
    setPrompt({
      title: 'New folder',
      label: active.path,
      value: 'Untitled folder',
      okLabel: 'Create',
      onOk: async name => {
        try {
          await api.mkdir(joinPath(active.path || '', name || 'Untitled folder'));
          await refreshFiles();
        } catch (e) {
          setError(e instanceof Error ? e.message : String(e));
        }
      },
    });
  }, [active, refreshFiles]);

  const newFile = useCallback(() => {
    if (!active || active.kind !== 'files' || active.source === 'gdrive') {
      setError('Create files in a local folder.');
      return;
    }
    setPrompt({
      title: 'New file',
      label: active.path,
      value: 'untitled.txt',
      okLabel: 'Create',
      onOk: async name => {
        try {
          await api.createFile(joinPath(active.path || '', name || 'untitled.txt'));
          await refreshFiles();
        } catch (e) {
          setError(e instanceof Error ? e.message : String(e));
        }
      },
    });
  }, [active, refreshFiles]);

  const emptyTrash = useCallback(() => {
    setPrompt({
      title: 'Empty Trash',
      label: 'This permanently deletes everything in Depot Trash.',
      value: '',
      okLabel: 'Empty Trash',
      danger: true,
      requireExact: 'DELETE',
      onOk: async () => {
        try {
          await api.emptyTrash();
          await refreshFiles();
        } catch (e) {
          setError(e instanceof Error ? e.message : String(e));
        }
      },
    });
  }, [refreshFiles]);

  const copyToLocal = useCallback(
    (items: DirEntry[]) => {
      const fallback = places.find(p => p.kind === 'downloads')?.path || places[0]?.path || '';
      setPrompt({
        title: 'Copy to local folder',
        label: 'Destination folder',
        value: settings.torrentDownloadDir || fallback,
        okLabel: 'Copy',
        onOk: dir => {
          for (const item of items) {
            void enqueueTransfer({
              op: item.source === 'gdrive' ? 'download' : 'copy',
              from: item.path,
              to: joinPath(dir, item.name),
              name: item.name,
              route: item.source === 'gdrive' ? 'Drive → Local' : 'Local → Local',
              total: item.size,
            });
          }
          openToolTab('transfers', 'Transfers');
        },
      });
    },
    [enqueueTransfer, openToolTab, places, settings.torrentDownloadDir],
  );

  const openContext = useCallback(
    (item: DirEntry) => {
      if (!selected.includes(item.path)) setSelected([item.path]);
      setMenuFor(item);
    },
    [selected],
  );

  /* ── gates ──────────────────────────────────────────────── */

  if (allowed === null) {
    return (
      <View style={{flex: 1, backgroundColor: t.bg, alignItems: 'center', justifyContent: 'center'}}>
        <ActivityIndicator color={t.accent} />
      </View>
    );
  }

  if (!allowed) {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: t.bg,
          paddingTop: insets.top + 40,
          paddingHorizontal: 22,
          gap: 16,
        }}>
        <Heading size={30}>Depot</Heading>
        <Muted size={15.5} style={{lineHeight: 23}}>
          Android needs all-files access so the C++ core can list, copy and move files the way the
          desktop app does.
        </Muted>
        <Btn
          label="Grant file access"
          kind="primary"
          block
          onPress={() => void api.openAllFilesSettings()}
        />
        <Btn label="I already granted it" kind="ghost" block onPress={() => void refreshAccess()} />
      </View>
    );
  }

  /* ── chrome ─────────────────────────────────────────────── */

  const tabIcon = (x: Tab): IconName => {
    if (x.kind === 'files') return x.source === 'gdrive' ? 'cloud' : 'folder';
    if (x.kind === 'preview') return chromeIconFor({isDir: false, ext: extOf(x.title)});
    if (x.kind === 'editor') return 'code';
    if (x.kind === 'web') return 'globe';
    if (x.kind === 'app' && x.app) return SOCIAL_APPS[x.app].icon;
    if (x.kind === 'torrents') return 'magnet';
    if (x.kind === 'share') return 'net';
    if (x.kind === 'drives') return 'cloud';
    if (x.kind === 'transfers') return 'arrows';
    return 'gear';
  };

  const contextRows: Array<{k: string; v: string}> = (() => {
    switch (activeKind) {
      case 'web':
        return [
          {k: 'URL', v: active?.url || ''},
          {k: 'Engine', v: 'Android WebView'},
          {k: 'Session', v: 'Persistent app cookies'},
        ];
      case 'app':
        return [
          {k: 'App', v: active?.title || ''},
          {k: 'Engine', v: 'Android WebView'},
          {k: 'Session', v: 'Persistent app cookies'},
          {k: 'Current page', v: active?.url || ''},
        ];
      case 'torrents':
        return [
          {k: 'Active', v: String(activeTorrents.length)},
          {k: 'Down', v: formatSpeed(torrentSpeed)},
          {k: 'Save to', v: settings.torrentDownloadDir || 'System Downloads'},
        ];
      case 'drives':
        return [
          {k: 'Accounts', v: `${accounts.length} connected`},
          {k: 'Volumes', v: String(volumes.length)},
          {k: 'Auth', v: 'Browser sign-in · PKCE'},
        ];
      case 'transfers':
        return [
          {k: 'Active', v: String(transfers.filter(x => x.state === 'running').length)},
          {k: 'Queued', v: String(transfers.filter(x => x.state === 'queued').length)},
          {k: 'Done', v: String(transfers.filter(x => x.state === 'done').length)},
          {k: 'Failed', v: String(transfers.filter(x => x.state === 'error').length)},
        ];
      case 'settings':
        return [
          {k: 'Bundle', v: 'com.depot.mobile'},
          {k: 'Shell', v: 'React Native 0.87 · C++ core'},
          {k: 'Config', v: 'app storage · settings.json'},
        ];
      case 'preview':
        return [
          {k: 'Name', v: active?.title || ''},
          {k: 'Source', v: active?.source === 'gdrive' ? 'Google Drive (cached)' : 'Local'},
          {k: 'Kind', v: kindLabel({isDir: false, ext: extOf(active?.title || '')})},
          {k: 'Path', v: active?.path || ''},
        ];
      default:
        return [];
    }
  })();

  const immersive =
    activeKind === 'preview' || activeKind === 'web' || activeKind === 'app' || activeKind === 'editor';
  /**
   * A social tab takes the whole screen — no titlebar, no tab strip, no status
   * bar — so it reads as its own app. `showChrome` is the way back for anyone
   * who would rather see Depot's shell, and the pane offers it as a "Depot"
   * chip and a hardware-back stop.
   */
  const appMode = activeKind === 'app' && !showChrome;
  const footerHeight = 40 + insets.bottom;

  return (
    <View style={{flex: 1, backgroundColor: t.bg, paddingTop: appMode ? 0 : insets.top}}>
      <StatusBar
        hidden={appMode}
        barStyle={prefs.theme === 'dark' ? 'light-content' : 'dark-content'}
      />

      {/* titlebar */}
      {appMode ? null : (
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
          paddingLeft: 4,
          paddingRight: 8,
          height: 48,
        }}>
        <IconBtn icon="menu" label="Places" onPress={() => setPref('sidebarOpen', true)} />
        <View style={{flex: 1}}>
          <Text style={{color: t.text, fontSize: 17, fontWeight: '700', letterSpacing: -0.3}}>
            Depot
          </Text>
          <Text style={{color: t.neutral600, fontSize: 10.5}} numberOfLines={1}>
            Your files, wherever they live
          </Text>
        </View>
        <Pressable
          onPress={() => setPref('theme', prefs.theme === 'dark' ? 'light' : 'dark')}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 6,
            paddingHorizontal: 11,
            paddingVertical: 7,
            borderRadius: radius.pill,
            borderWidth: 1,
            borderColor: t.divider,
            backgroundColor: t.raised,
          }}>
          <Icon name={prefs.theme === 'dark' ? 'moon' : 'sun'} size={14} color={t.text} />
          <Text style={{color: t.text, fontSize: 12, fontWeight: '600'}}>
            {prefs.theme === 'dark' ? 'Dark' : 'Light'}
          </Text>
        </Pressable>
      </View>
      )}

      {/* tab strip */}
      {appMode ? null : (
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{paddingHorizontal: 8, gap: 6, alignItems: 'center'}}
        style={{maxHeight: 46, flexGrow: 0}}>
        {tabs.map(x => {
          const on = x.id === active?.id;
          return (
            <Pressable
              key={x.id}
              onPress={() => setActiveId(x.id)}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 7,
                paddingLeft: 11,
                paddingRight: 6,
                height: 34,
                borderRadius: radius.pill,
                borderWidth: 1,
                borderColor: on ? t.accent300 : t.divider,
                backgroundColor: on ? t.accent100 : t.raised,
              }}>
              <Icon name={tabIcon(x)} size={14} color={on ? t.accent : t.neutral700} />
              <Text
                numberOfLines={1}
                style={{
                  maxWidth: 128,
                  color: on ? t.accent : t.text,
                  fontSize: 12.5,
                  fontWeight: on ? '700' : '500',
                }}>
                {x.title}
              </Text>
              <Pressable
                hitSlop={8}
                onPress={() => closeTab(x.id)}
                style={{padding: 4}}
                accessibilityLabel={`Close ${x.title}`}>
                <Icon name="close" size={12} color={t.neutral600} />
              </Pressable>
            </Pressable>
          );
        })}
        <Pressable
          onPress={() =>
            openLocal(
              active?.kind === 'files' && active.source === 'local'
                ? active.path || ''
                : places[0]?.path || '',
            )
          }
          accessibilityLabel="New tab"
          style={{
            width: 34,
            height: 34,
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: radius.pill,
            borderWidth: 1,
            borderColor: t.divider,
            backgroundColor: t.raised,
          }}>
          <Icon name="plus" size={15} color={t.text} />
        </Pressable>
      </ScrollView>
      )}

      {/* toolbar */}
      {!immersive ? (
        <View style={{gap: 6, paddingTop: 6}}>
          <View style={{flexDirection: 'row', alignItems: 'center', paddingHorizontal: 4}}>
            <IconBtn
              icon="back"
              label="Back"
              disabled={!active || active.historyIndex <= 0}
              onPress={() => stepHistory(-1)}
            />
            <IconBtn
              icon="forward"
              label="Forward"
              disabled={!active || active.historyIndex >= active.history.length - 1}
              onPress={() => stepHistory(1)}
            />
            <IconBtn
              icon="up"
              label="Up"
              disabled={activeKind !== 'files'}
              onPress={() => void goUp()}
            />
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{alignItems: 'center', gap: 2, paddingRight: 10}}
              style={{flex: 1}}>
              {activeKind === 'files' && active?.source === 'local' ? (
                crumbs.map((c, i) => (
                  <View key={`${c}-${i}`} style={{flexDirection: 'row', alignItems: 'center'}}>
                    {i > 0 ? (
                      <Text style={{color: t.neutral600, fontSize: 12}}> › </Text>
                    ) : null}
                    <Pressable
                      onPress={() => navigate('/' + crumbs.slice(0, i + 1).join('/'), c)}
                      style={{paddingVertical: 5, paddingHorizontal: 3}}>
                      <Text
                        style={{
                          color: i === crumbs.length - 1 ? t.text : t.neutral700,
                          fontSize: 12.5,
                          fontWeight: i === crumbs.length - 1 ? '700' : '500',
                        }}>
                        {c}
                      </Text>
                    </Pressable>
                  </View>
                ))
              ) : (
                <Text style={{color: t.neutral700, fontSize: 12.5}}>{active?.title}</Text>
              )}
            </ScrollView>
          </View>

          {activeKind === 'files' ? (
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 8,
                paddingHorizontal: 10,
                paddingBottom: 4,
              }}>
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  flex: 1,
                  gap: 7,
                  paddingHorizontal: 11,
                  height: 38,
                  borderRadius: radius.pill,
                  borderWidth: 1,
                  borderColor: t.divider,
                  backgroundColor: t.raised,
                }}>
                <Icon name="search" size={15} color={t.neutral600} />
                <TextInput
                  value={query}
                  onChangeText={setQuery}
                  placeholder="Search this place"
                  placeholderTextColor={t.neutral600}
                  style={{flex: 1, color: t.text, fontSize: 13.5, padding: 0}}
                />
                {query ? (
                  <Pressable onPress={() => setQuery('')} hitSlop={8}>
                    <Icon name="close" size={13} color={t.neutral600} />
                  </Pressable>
                ) : null}
              </View>
              {query.trim() && active?.source === 'local' ? (
                <IconBtn
                  icon={deep ? 'folder' : 'search'}
                  label={deep ? 'Search this folder only' : 'Search subfolders'}
                  on={!!deep}
                  onPress={() => (deep ? setDeep(null) : void searchSubfolders())}
                />
              ) : null}
              <View
                style={{
                  flexDirection: 'row',
                  borderRadius: radius.pill,
                  borderWidth: 1,
                  borderColor: t.divider,
                  backgroundColor: t.raised,
                  overflow: 'hidden',
                }}>
                {(['grid', 'list'] as const).map(v => (
                  <Pressable
                    key={v}
                    onPress={() => setPref('view', v)}
                    style={{
                      paddingHorizontal: 11,
                      height: 36,
                      justifyContent: 'center',
                      backgroundColor: prefs.view === v ? t.accent100 : 'transparent',
                    }}>
                    <Icon
                      name={v}
                      size={15}
                      color={prefs.view === v ? t.accent : t.neutral700}
                    />
                  </Pressable>
                ))}
              </View>
              <IconBtn icon="folderPlus" label="New folder" onPress={newFolder} />
              {active?.source === 'local' ? (
                <IconBtn icon="plus" label="New file" onPress={newFile} />
              ) : null}
              {active?.source === 'local' && places.some(p => p.kind === 'trash' && p.path === active.path) ? (
                <IconBtn icon="trash" label="Empty Trash" onPress={emptyTrash} />
              ) : null}
            </View>
          ) : null}
        </View>
      ) : null}

      {/* stage */}
      <View style={{flex: 1}}>
        {activeKind === 'files' && active ? (
          <FilesView
            entries={visible}
            selected={selected}
            view={prefs.view}
            busy={busy}
            title={active.title}
            query={query}
            totalCount={entries.length}
            source={active.source ?? 'local'}
            footer={footerHeight + (selection.length ? 56 : 0)}
            onOpen={item => void openEntry(item)}
            onToggleSelect={toggleSelect}
            onContext={openContext}
            onRefresh={() => void refreshFiles()}
          />
        ) : null}

        {/* Audio tabs stay mounted so playback survives a switch back to the
            file list; video releases its surface the moment it loses focus. */}
        {tabs
          .filter(x => x.kind === 'preview' && viewerKind(extOf(x.title)) === 'audio')
          .map(tab => (
            <View
              key={tab.id}
              style={tab.id === active?.id ? {flex: 1} : {height: 0, overflow: 'hidden'}}
              pointerEvents={tab.id === active?.id ? 'auto' : 'none'}>
              <PreviewPane
                title={tab.title}
                path={tab.path || ''}
                source={tab.source ?? 'local'}
                onError={setError}
                playlist={tab.playlist}
                canPlay={audioTab === null || audioTab === tab.id}
                onChangeMedia={entry => changeMedia(tab.id, entry)}
                onClose={() => closeTab(tab.id)}
              />
            </View>
          ))}

        {activeKind === 'preview' && active && viewerKind(extOf(active.title)) !== 'audio' ? (
          <PreviewPane
            key={active.id}
            title={active.title}
            path={active.path || ''}
            source={active.source ?? 'local'}
            onError={setError}
            playlist={active.playlist}
            onChangeMedia={entry => changeMedia(active.id, entry)}
            onClose={() => closeTab(active.id)}
            onEdit={
              active.source === 'local'
                ? () => openEditor(active.path || '', active.path)
                : undefined
            }
          />
        ) : null}

        {tabs
          .filter(x => x.kind === 'editor')
          .map(tab => (
            <View
              key={tab.id}
              style={
                tab.id === active?.id
                  ? {flex: 1}
                  : {height: 0, overflow: 'hidden'}
              }
              pointerEvents={tab.id === active?.id ? 'auto' : 'none'}>
              <CodeEditor
                workspace={tab.path || ''}
                openPath={tab.file}
                onError={setError}
                onTitle={title => patchTab(tab.id, {title})}
              />
            </View>
          ))}

        {activeKind === 'web' && active ? (
          <WebPane
            key={active.id}
            url={active.url || ''}
            onUrl={url =>
              patchTab(active.id, {url, title: url.replace(/^https?:\/\//, '').slice(0, 42)})
            }
            onError={setError}
          />
        ) : null}

        {/* There are at most two of these, and unmounting one destroys the
            WebView, which drops the session and the scroll position. */}
        {tabs
          .filter(x => x.kind === 'app' && x.app)
          .map(tab => (
            <View
              key={tab.id}
              style={tab.id === active?.id ? {flex: 1} : {height: 0, overflow: 'hidden'}}
              pointerEvents={tab.id === active?.id ? 'auto' : 'none'}>
              <WebPane
                url={tab.url || SOCIAL_APPS[tab.app as SocialAppKind].url}
                app={tab.app}
                focused={tab.id === active?.id}
                onUrl={url => patchTab(tab.id, {url})}
                onClose={() => closeTab(tab.id)}
                onExitImmersive={appMode ? () => setShowChrome(true) : undefined}
                onError={setError}
              />
            </View>
          ))}

        {activeKind === 'share' ? (
          <ShareView
            status={shareStatus}
            peers={sharePeers}
            jobs={shareJobs}
            footer={footerHeight}
            onToggle={on => void toggleShare(on)}
            onOpenFolder={folder => openLocal(folder, baseName(folder))}
            onClearFinished={() => setShareJobs(all => all.filter(j => j.state === 'running'))}
          />
        ) : null}

        {activeKind === 'torrents' ? (
          <TorrentsView
            torrents={torrents}
            footer={footerHeight}
            busy={torrentBusy}
            onAdd={async magnet => {
              setTorrentBusy(true);
              try {
                await api.addTorrent(magnet);
                setTorrents(await api.torrents());
              } catch (e) {
                setError(e instanceof Error ? e.message : String(e));
              } finally {
                setTorrentBusy(false);
              }
            }}
            onPause={id => void api.pauseTorrent(id).catch(e => setError(String(e)))}
            onResume={id => void api.resumeTorrent(id).catch(e => setError(String(e)))}
            onRemove={id => void api.removeTorrent(id).catch(e => setError(String(e)))}
            onOpenFolder={path => openLocal(path, baseName(path))}
          />
        ) : null}

        {activeKind === 'drives' ? (
          <ConnectionsView
            accounts={accounts}
            driveQuota={driveQuota}
            places={places.filter(p => p.kind === 'volume' || p.kind === 'home')}
            settings={settings}
            volumeUsage={volumeUsage}
            footer={footerHeight}
            onConfigure={() => openToolTab('settings', 'Settings')}
            onConnectGoogle={async () => {
              setError('');
              await api.saveSettings(settings);
              await api.connectDrive();
              await loadPlaces();
            }}
            onDisconnectGoogle={async accountId => {
              await api.disconnectDrive(accountId);
              await loadPlaces();
            }}
            onOpenGoogle={openDrive}
            onOpenLocal={place => openLocal(place.path, place.name)}
            onOpenWeb={openWebTab}
            onOpenSocial={openSocialApp}
            onError={setError}
          />
        ) : null}

        {activeKind === 'transfers' ? (
          <TransfersView
            transfers={transfers}
            footer={footerHeight}
            onClearFinished={() => setTransfers(all => all.filter(x => x.state !== 'done'))}
            onCancel={id => void api.cancelTransfer(id).catch(e => setError(String(e)))}
          />
        ) : null}

        {activeKind === 'settings' ? (
          <SettingsView
            settings={settings}
            prefs={prefs}
            footer={footerHeight}
            onChange={setSettings}
            onSave={async () => {
              try {
                await api.saveSettings(settings);
                setError('');
              } catch (e) {
                setError(e instanceof Error ? e.message : String(e));
              }
            }}
            onPref={setPref}
          />
        ) : null}
      </View>

      {/* selection bar */}
      {activeKind === 'files' && selection.length ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={{
            maxHeight: 56,
            flexGrow: 0,
            borderTopWidth: 1,
            borderTopColor: t.divider,
            backgroundColor: t.surface,
          }}
          contentContainerStyle={{alignItems: 'center', gap: 8, paddingHorizontal: 10}}>
          <Tag label={`${selection.length} selected`} tone="accent" />
          <Btn
            label="Copy"
            icon="copy"
            small
            onPress={() => setClipboard({mode: 'copy', items: selection})}
          />
          <Btn
            label="Cut"
            icon="scissors"
            small
            onPress={() => setClipboard({mode: 'cut', items: selection})}
          />
          <Btn
            label="Paste"
            icon="clipboard"
            small
            disabled={!clipboard}
            onPress={() => void paste()}
          />
          <Btn label="Rename" icon="pencil" small disabled={selection.length !== 1} onPress={renameSelected} />
          <Btn label="Info" icon="info" small onPress={() => setPref('inspectorOpen', true)} />
          <Btn label="Share" icon="share" small onPress={() => primary && void api.share(primary.path)} />
          <Btn label="Delete" icon="trash" kind="danger" small onPress={removeSelected} />
          <Btn label="Clear" small onPress={() => setSelected([])} />
        </ScrollView>
      ) : null}

      {/* statusbar */}
      {appMode ? null : (
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 12,
          height: 40,
          paddingHorizontal: 14,
          paddingBottom: 0,
          marginBottom: insets.bottom,
          borderTopWidth: 1,
          borderTopColor: t.divider,
          backgroundColor: t.surface,
        }}>
        <Text style={{color: t.neutral700, fontSize: 11.5, flex: 1}} numberOfLines={1}>
          {busy
            ? 'Working…'
            : error
              ? error
              : activeKind === 'files'
                ? `${visible.length} items${selection.length ? ` · ${selection.length} selected` : ''}${
                    usage ? ` · ${formatBytes(usage.free)} free` : ''
                  }${clipboard ? ` · clipboard ${clipboard.mode} ${clipboard.items.length}` : ''}`
                : active?.title || ''}
        </Text>
        {transfers.length ? (
          <Pressable onPress={() => openToolTab('transfers', 'Transfers')}>
            <Text style={{color: t.accent, fontSize: 11.5, fontWeight: '700'}}>
              {runningTransfers.length
                ? `${runningTransfers.length} running`
                : `${transfers.length} transfers`}
            </Text>
          </Pressable>
        ) : null}
        {torrents.length ? (
          <Pressable onPress={() => openToolTab('torrents', 'Downloads')}>
            <Text style={{color: t.accent, fontSize: 11.5, fontWeight: '700'}}>
              ↓ {formatSpeed(torrentSpeed)}
            </Text>
          </Pressable>
        ) : null}
      </View>
      )}

      {/* ── drawer ─────────────────────────────────────────── */}
      <Modal
        visible={prefs.sidebarOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setPref('sidebarOpen', false)}>
        <Pressable
          onPress={() => setPref('sidebarOpen', false)}
          style={{flex: 1, backgroundColor: t.scrim, flexDirection: 'row'}}>
          <Pressable
            onPress={() => undefined}
            style={{
              width: '82%',
              backgroundColor: t.bg,
              paddingTop: insets.top + 14,
              paddingBottom: insets.bottom,
            }}>
            <ScrollView>
              <View style={{paddingHorizontal: 16, paddingBottom: 14}}>
                <Heading size={22}>Depot</Heading>
                <Muted size={12}>Your files, wherever they live</Muted>
              </View>

              <SideGroup label="Places" hint="Local">
                {localPlaces.map(p => (
                  <SideItem
                    key={p.path + p.kind}
                    icon={PLACE_ICONS[p.kind] ?? 'folder'}
                    label={p.name}
                    on={activeKind === 'files' && active?.source === 'local' && active.path === p.path}
                    onPress={() => {
                      setPref('sidebarOpen', false);
                      if (active?.kind === 'files' && active.source === 'local')
                        navigate(p.path, p.name);
                      else openLocal(p.path, p.name);
                    }}
                  />
                ))}
                <SideItem
                  icon="code"
                  label="Edit this folder"
                  on={activeKind === 'editor'}
                  onPress={() => {
                    setPref('sidebarOpen', false);
                    const folder =
                      active?.kind === 'files' && active.source === 'local'
                        ? active.path || places[0]?.path || ''
                        : places[0]?.path || '';
                    if (folder) openEditor(folder);
                  }}
                />
                {tabs
                  .filter(x => x.kind === 'editor')
                  .map(tab => (
                    <SideItem
                      key={tab.id}
                      icon="code"
                      label={tab.title}
                      badge="Edit"
                      on={active?.id === tab.id}
                      onPress={() => {
                        setPref('sidebarOpen', false);
                        setActiveId(tab.id);
                      }}
                    />
                  ))}
              </SideGroup>

              <SideGroup label="Volumes" hint={String(volumes.length)}>
                {volumes.map(p => (
                  <SideItem
                    key={p.path}
                    icon="disk"
                    label={p.name}
                    on={activeKind === 'files' && active?.path === p.path}
                    onPress={() => {
                      setPref('sidebarOpen', false);
                      if (active?.kind === 'files' && active.source === 'local')
                        navigate(p.path, p.name);
                      else openLocal(p.path, p.name);
                    }}
                  />
                ))}
                {!volumes.length ? (
                  <Muted size={12.5} style={{paddingHorizontal: 18, paddingVertical: 6}}>
                    No extra volumes
                  </Muted>
                ) : null}
              </SideGroup>

              <SideGroup label="Cloud drives" hint={String(accounts.length)}>
                {accounts.map(a => (
                  <SideItem
                    key={a.id}
                    icon="cloud"
                    label={a.email}
                    badge="Drive"
                    on={activeKind === 'files' && active?.accountId === a.id}
                    onPress={() => {
                      setPref('sidebarOpen', false);
                      openDrive(a);
                    }}
                  />
                ))}
                <SideItem
                  icon="bucket"
                  label="Connections"
                  on={activeKind === 'drives'}
                  onPress={() => {
                    setPref('sidebarOpen', false);
                    openToolTab('drives', 'Connections');
                  }}
                />
              </SideGroup>

              <SideGroup label="Social apps" hint="2">
                <SideItem
                  icon="facebook"
                  label="Facebook"
                  badge="App"
                  tint={SOCIAL_APPS.facebook.tint}
                  on={activeKind === 'app' && active?.app === 'facebook'}
                  onPress={() => {
                    setPref('sidebarOpen', false);
                    openSocialApp('facebook');
                  }}
                />
                <SideItem
                  icon="instagram"
                  label="Instagram"
                  badge="App"
                  tint={SOCIAL_APPS.instagram.tint}
                  on={activeKind === 'app' && active?.app === 'instagram'}
                  onPress={() => {
                    setPref('sidebarOpen', false);
                    openSocialApp('instagram');
                  }}
                />
              </SideGroup>

              <SideGroup label="Activity">
                <SideItem
                  icon="magnet"
                  label="Torrents"
                  badge={activeTorrents.length ? String(activeTorrents.length) : undefined}
                  on={activeKind === 'torrents'}
                  onPress={() => {
                    setPref('sidebarOpen', false);
                    openToolTab('torrents', 'Downloads');
                  }}
                />
                <SideItem
                  icon="arrows"
                  label="Transfers"
                  badge={runningTransfers.length ? String(runningTransfers.length) : undefined}
                  on={activeKind === 'transfers'}
                  onPress={() => {
                    setPref('sidebarOpen', false);
                    openToolTab('transfers', 'Transfers');
                  }}
                />
                <SideItem
                  icon="net"
                  label="Nearby"
                  badge={sharePeers.length ? String(sharePeers.length) : undefined}
                  on={activeKind === 'share'}
                  onPress={() => {
                    setPref('sidebarOpen', false);
                    openToolTab('share', 'Nearby');
                  }}
                />
                <SideItem
                  icon="globe"
                  label="Open website"
                  onPress={() => {
                    setPref('sidebarOpen', false);
                    openWebTab();
                  }}
                />
                <SideItem
                  icon="gear"
                  label="Settings"
                  on={activeKind === 'settings'}
                  onPress={() => {
                    setPref('sidebarOpen', false);
                    openToolTab('settings', 'Settings');
                  }}
                />
              </SideGroup>
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>

      {/* ── inspector sheet ────────────────────────────────── */}
      <Modal
        visible={prefs.inspectorOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setPref('inspectorOpen', false)}>
        <Pressable
          onPress={() => setPref('inspectorOpen', false)}
          style={{flex: 1, backgroundColor: t.scrim, justifyContent: 'flex-end'}}>
          <Pressable
            onPress={() => undefined}
            style={{
              backgroundColor: t.bg,
              borderTopLeftRadius: 18,
              borderTopRightRadius: 18,
              paddingTop: 14,
              paddingBottom: insets.bottom + 16,
              maxHeight: '84%',
            }}>
            <View
              style={{
                alignSelf: 'center',
                width: 40,
                height: 4,
                borderRadius: 2,
                backgroundColor: t.neutral400,
                marginBottom: 12,
              }}
            />
            <ScrollView contentContainerStyle={{paddingHorizontal: 18, gap: 16}}>
              <Text
                style={{
                  color: t.neutral600,
                  fontSize: 11,
                  fontWeight: '700',
                  letterSpacing: 0.7,
                  textTransform: 'uppercase',
                }}>
                {activeKind === 'files' ? 'Details' : active?.title}
              </Text>

              {activeKind === 'files' && primary ? (
                <>
                  <Pressable
                    onPress={() => {
                      if (primary.isDir) return;
                      setPref('inspectorOpen', false);
                      setQuickLook(primary);
                    }}
                    style={{
                      height: 150,
                      alignItems: 'center',
                      justifyContent: 'center',
                      borderRadius: radius.lg,
                      backgroundColor: t.surface,
                      borderWidth: 1,
                      borderColor: t.divider,
                    }}>
                    <FileIcon kind={iconFor(primary)} size={64} theme={t} />
                  </Pressable>
                  <View>
                    <Heading size={17}>{primary.name}</Heading>
                    <Muted size={13}>
                      {kindLabel(primary)} · {primary.isDir ? '—' : formatBytes(primary.size)}
                    </Muted>
                  </View>
                  <Stack gap={10}>
                    <KV k="Kind" v={kindLabel(primary)} />
                    <KV k="Size" v={primary.isDir ? '—' : formatBytes(primary.size)} />
                    <KV k="Modified" v={formatDate(primary.modified)} />
                    <KV
                      k="Source"
                      v={primary.source === 'local' ? 'Local storage' : 'Google Drive'}
                    />
                    <KV k="Path" v={primary.path} />
                    {selection.length > 1 ? (
                      <KV k="Selected" v={`${selection.length} items`} />
                    ) : null}
                  </Stack>
                  <Divider />
                  <Stack gap={9}>
                    <Btn
                      label={primary.isDir ? 'Open folder' : 'Open in tab'}
                      kind="primary"
                      block
                      onPress={() => {
                        setPref('inspectorOpen', false);
                        void openEntry(primary);
                      }}
                    />
                    {!primary.isDir ? (
                      <Btn
                        label="Quick look"
                        block
                        onPress={() => {
                          setPref('inspectorOpen', false);
                          setQuickLook(primary);
                        }}
                      />
                    ) : null}
                    {primary.source === 'local' ? (
                      <Btn
                        label={primary.isDir ? 'Edit this folder' : 'Edit code'}
                        block
                        onPress={() => {
                          setPref('inspectorOpen', false);
                          if (primary.isDir) openEditor(primary.path);
                          else openEditor(parentDir(primary.path), primary.path);
                        }}
                      />
                    ) : null}
                    <Btn
                      label="Copy to local…"
                      block
                      onPress={() => {
                        setPref('inspectorOpen', false);
                        copyToLocal(selection);
                      }}
                    />
                    {primary.source === 'local' ? (
                      <>
                        <Btn
                          label="Share"
                          block
                          onPress={() =>
                            void api.share(primary.path).catch(e => setError(String(e)))
                          }
                        />
                        <Btn
                          label="Open in a file manager"
                          block
                          onPress={() =>
                            void api.reveal(primary.path).catch(e => setError(String(e)))
                          }
                        />
                      </>
                    ) : null}
                  </Stack>
                </>
              ) : null}

              {activeKind === 'files' && !primary ? (
                <Muted style={{paddingVertical: 20, textAlign: 'center'}}>
                  Select an item to inspect it
                </Muted>
              ) : null}

              {activeKind !== 'files' ? (
                <Stack gap={12}>
                  {contextRows.map(r => (
                    <KV key={r.k} k={r.k} v={r.v} />
                  ))}
                </Stack>
              ) : null}

              <Divider />
              <Text
                style={{
                  color: t.neutral600,
                  fontSize: 11,
                  fontWeight: '700',
                  letterSpacing: 0.7,
                  textTransform: 'uppercase',
                }}>
                Social apps
              </Text>
              <SideItem
                icon="facebook"
                label="Facebook"
                tint={SOCIAL_APPS.facebook.tint}
                badge="App"
                onPress={() => {
                  setPref('inspectorOpen', false);
                  openSocialApp('facebook');
                }}
              />
              <SideItem
                icon="instagram"
                label="Instagram"
                tint={SOCIAL_APPS.instagram.tint}
                badge="App"
                onPress={() => {
                  setPref('inspectorOpen', false);
                  openSocialApp('instagram');
                }}
              />
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>

      {/* ── context sheet ──────────────────────────────────── */}
      <Modal
        visible={!!menuFor}
        transparent
        animationType="fade"
        onRequestClose={() => setMenuFor(null)}>
        <Pressable
          onPress={() => setMenuFor(null)}
          style={{flex: 1, backgroundColor: t.scrim, justifyContent: 'flex-end'}}>
          <Pressable
            onPress={() => undefined}
            style={{
              backgroundColor: t.bg,
              borderTopLeftRadius: 18,
              borderTopRightRadius: 18,
              paddingTop: 14,
              paddingBottom: insets.bottom + 12,
              maxHeight: '80%',
            }}>
            {menuFor ? (
              <>
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 11,
                    paddingHorizontal: 18,
                    paddingBottom: 12,
                  }}>
                  <FileIcon kind={iconFor(menuFor)} size={30} theme={t} />
                  <View style={{flex: 1}}>
                    <Heading size={15}>{menuFor.name}</Heading>
                    <Muted size={12}>{kindLabel(menuFor)}</Muted>
                  </View>
                </View>
                <Divider />
                <ScrollView contentContainerStyle={{paddingVertical: 6}}>
                  <MenuRow
                    icon={menuFor.isDir ? 'folder' : 'external'}
                    label={menuFor.isDir ? 'Open folder' : 'Open in tab'}
                    onPress={() => {
                      const item = menuFor;
                      setMenuFor(null);
                      void openEntry(item);
                    }}
                  />
                  <MenuRow
                    icon="play"
                    label={menuFor.isDir ? 'Play folder' : 'Play from here'}
                    disabled={!menuFor.isDir && !playsInPlayer(menuFor.ext)}
                    onPress={() => {
                      const item = menuFor;
                      setMenuFor(null);
                      if (item) void playFolder(item);
                    }}
                  />
                  <MenuRow
                    icon="eye"
                    label="Quick look"
                    disabled={menuFor.isDir}
                    onPress={() => {
                      const item = menuFor;
                      setMenuFor(null);
                      if (item && !item.isDir) setQuickLook(item);
                    }}
                  />
                  <MenuRow
                    icon="code"
                    label={menuFor.isDir ? 'Open folder in editor' : 'Edit code'}
                    disabled={menuFor.source !== 'local'}
                    onPress={() => {
                      const item = menuFor;
                      setMenuFor(null);
                      if (!item || item.source !== 'local') return;
                      if (item.isDir) openEditor(item.path);
                      else openEditor(parentDir(item.path), item.path);
                    }}
                  />
                  <MenuRow
                    icon="info"
                    label="Get info"
                    onPress={() => {
                      setMenuFor(null);
                      setPref('inspectorOpen', true);
                    }}
                  />
                  <Divider />
                  <MenuRow
                    icon="copy"
                    label="Copy"
                    onPress={() => {
                      setMenuFor(null);
                      setClipboard({mode: 'copy', items: selection});
                    }}
                  />
                  <MenuRow
                    icon="scissors"
                    label="Cut"
                    onPress={() => {
                      setMenuFor(null);
                      setClipboard({mode: 'cut', items: selection});
                    }}
                  />
                  <MenuRow
                    icon="clipboard"
                    label="Paste"
                    disabled={!clipboard}
                    onPress={() => {
                      setMenuFor(null);
                      void paste();
                    }}
                  />
                  <MenuRow
                    icon="download"
                    label="Copy to local…"
                    onPress={() => {
                      setMenuFor(null);
                      copyToLocal(selection);
                    }}
                  />
                  <Divider />
                  <MenuRow
                    icon="pencil"
                    label="Rename"
                    disabled={selection.length !== 1}
                    onPress={() => {
                      setMenuFor(null);
                      renameSelected();
                    }}
                  />
                  <MenuRow
                    icon="copy"
                    label="Duplicate"
                    disabled={!selection.length || selection.some(e => e.source !== 'local')}
                    onPress={() => {
                      setMenuFor(null);
                      void duplicateSelected();
                    }}
                  />
                  <MenuRow
                    icon="net"
                    label="Send to a nearby device"
                    disabled={menuFor.source !== 'local'}
                    onPress={() => {
                      const items = selection.length ? selection : menuFor ? [menuFor] : [];
                      setMenuFor(null);
                      if (!items.length) return;
                      setSendTo(items);
                      if (!shareStatus.running) void toggleShare(true);
                    }}
                  />
                  <MenuRow
                    icon="share"
                    label="Share"
                    disabled={menuFor.source !== 'local'}
                    onPress={() => {
                      const item = menuFor;
                      setMenuFor(null);
                      if (item) void api.share(item.path).catch(e => setError(String(e)));
                    }}
                  />
                  <MenuRow
                    icon="external"
                    label="Open in a file manager"
                    disabled={menuFor.source !== 'local'}
                    onPress={() => {
                      const item = menuFor;
                      setMenuFor(null);
                      if (item) void api.reveal(item.path).catch(e => setError(String(e)));
                    }}
                  />
                  <Divider />
                  <MenuRow
                    icon="trash"
                    label={prefs.useTrash ? 'Move to Trash' : 'Delete'}
                    danger
                    onPress={() => {
                      setMenuFor(null);
                      removeSelected();
                    }}
                  />
                </ScrollView>
              </>
            ) : null}
          </Pressable>
        </Pressable>
      </Modal>

      {/* ── pick a device to send to ───────────────────────── */}
      <Modal
        visible={!!sendTo}
        transparent
        animationType="slide"
        onRequestClose={() => setSendTo(null)}>
        <Pressable
          onPress={() => setSendTo(null)}
          style={{flex: 1, backgroundColor: t.scrim, justifyContent: 'flex-end'}}>
          <Pressable
            onPress={() => undefined}
            style={{
              backgroundColor: t.bg,
              borderTopLeftRadius: 18,
              borderTopRightRadius: 18,
              paddingTop: 16,
              paddingBottom: insets.bottom + 12,
              maxHeight: '70%',
            }}>
            <View style={{paddingHorizontal: 18, paddingBottom: 12, gap: 3}}>
              <Heading size={16}>Send to a nearby device</Heading>
              <Muted size={12}>
                {sendTo?.length === 1
                  ? sendTo[0].name
                  : `${sendTo?.length ?? 0} items`}{' '}
                · unencrypted over your local network
              </Muted>
            </View>
            <Divider />
            <ScrollView contentContainerStyle={{paddingVertical: 6}}>
              {!sharePeers.length ? (
                <View style={{padding: 24, gap: 10}}>
                  <Muted size={13}>
                    No devices yet. On the other phone, open Depot, go to Nearby and switch sharing
                    on — both need to be on the same Wi-Fi.
                  </Muted>
                  <ActivityIndicator color={t.accent} />
                </View>
              ) : null}
              {sharePeers.map(peer => (
                <MenuRow
                  key={peer.id}
                  icon="net"
                  label={`${peer.name} · ${peer.host}`}
                  onPress={() => {
                    const items = sendTo;
                    if (items) void sendToPeer(peer, items);
                  }}
                />
              ))}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>

      {/* ── an incoming offer ──────────────────────────────── */}
      <Modal
        visible={!!shareOffer}
        transparent
        animationType="fade"
        onRequestClose={() => {
          if (shareOffer) void api.shareRespond(shareOffer.id, false).catch(() => undefined);
          setShareOffer(null);
        }}>
        <View
          style={{
            flex: 1,
            backgroundColor: t.scrim,
            alignItems: 'center',
            justifyContent: 'center',
            padding: 24,
          }}>
          <View
            style={{
              width: '100%',
              backgroundColor: t.bg,
              borderRadius: radius.lg,
              padding: 18,
              gap: 14,
            }}>
            <View style={{gap: 4}}>
              <Heading size={17}>{shareOffer?.from} wants to send you files</Heading>
              <Muted size={12}>
                {shareOffer?.files.length} item
                {(shareOffer?.files.length ?? 0) === 1 ? '' : 's'} ·{' '}
                {formatBytes(shareOffer?.total ?? 0)} · from {shareOffer?.host}
              </Muted>
            </View>

            <ScrollView style={{maxHeight: 190}} contentContainerStyle={{gap: 4}}>
              {shareOffer?.files.slice(0, 60).map(f => (
                <Text key={f.path} numberOfLines={1} style={{color: t.text, fontSize: 12.5}}>
                  {f.path} · {formatBytes(f.size)}
                </Text>
              ))}
              {(shareOffer?.files.length ?? 0) > 60 ? (
                <Muted size={11.5}>…and {(shareOffer?.files.length ?? 0) - 60} more</Muted>
              ) : null}
            </ScrollView>

            <Muted size={11.5}>
              Only accept from a device you recognise. Files land in your Download folder.
            </Muted>

            <View style={{flexDirection: 'row', gap: 8, justifyContent: 'flex-end'}}>
              <Btn
                label="Decline"
                onPress={() => {
                  if (shareOffer) void api.shareRespond(shareOffer.id, false).catch(() => undefined);
                  setShareOffer(null);
                }}
              />
              <Btn
                label="Accept"
                kind="primary"
                onPress={() => {
                  if (shareOffer) void api.shareRespond(shareOffer.id, true).catch(() => undefined);
                  setShareOffer(null);
                }}
              />
            </View>
          </View>
        </View>
      </Modal>

      {/* ── quick look ─────────────────────────────────────── */}
      <Modal
        visible={!!quickLook}
        animationType="fade"
        onRequestClose={() => setQuickLook(null)}
        statusBarTranslucent>
        <View style={{flex: 1, backgroundColor: t.bg, paddingTop: insets.top}}>
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 10,
              paddingHorizontal: 12,
              paddingVertical: 8,
              borderBottomWidth: 1,
              borderBottomColor: t.divider,
            }}>
            {quickLook ? <FileIcon kind={iconFor(quickLook)} size={22} theme={t} /> : null}
            <View style={{flex: 1}}>
              <Heading size={14.5}>{quickLook?.name}</Heading>
              <Muted size={11.5}>
                {quickLook ? `${kindLabel(quickLook)} · ${formatBytes(quickLook.size)}` : ''}
              </Muted>
            </View>
            <Btn
              label="Open in tab"
              small
              onPress={() => {
                const entry = quickLook;
                setQuickLook(null);
                if (entry) void openEntry(entry);
              }}
            />
            <IconBtn icon="close" label="Close" onPress={() => setQuickLook(null)} />
          </View>
          {quickLook ? (
            <PreviewPane
              key={quickLook.path}
              title={quickLook.name}
              path={quickLook.path}
              source={quickLook.source}
              onError={setError}
            />
          ) : null}
        </View>
      </Modal>

      {/* ── prompt ─────────────────────────────────────────── */}
      <Modal
        visible={!!prompt}
        transparent
        animationType="fade"
        onRequestClose={() => setPrompt(null)}>
        <View
          style={{
            flex: 1,
            backgroundColor: t.scrim,
            alignItems: 'center',
            justifyContent: 'center',
            paddingHorizontal: 22,
          }}>
          <View
            style={{
              width: '100%',
              backgroundColor: t.bg,
              borderRadius: radius.lg,
              padding: 18,
              gap: 14,
            }}>
            <Heading size={17}>{prompt?.title}</Heading>
            {prompt?.label ? (
              <Muted size={12.5} numberOfLines={3}>
                {prompt.label}
              </Muted>
            ) : null}
            <TextInput
              value={promptDraft}
              onChangeText={setPromptDraft}
              placeholder={prompt?.requireExact}
              placeholderTextColor={t.neutral600}
              autoFocus
              autoCapitalize="none"
              autoCorrect={false}
              style={{
                minHeight: 44,
                paddingHorizontal: 13,
                fontSize: 15,
                color: t.text,
                backgroundColor: t.raised,
                borderWidth: 1,
                borderColor: t.divider,
                borderRadius: radius.md,
              }}
            />
            <View style={{flexDirection: 'row', gap: 10, justifyContent: 'flex-end'}}>
              <Btn label="Cancel" onPress={() => setPrompt(null)} />
              <Btn
                label={prompt?.okLabel || 'OK'}
                kind={prompt?.danger ? 'danger' : 'primary'}
                disabled={!!prompt?.requireExact && promptDraft !== prompt.requireExact}
                onPress={() => {
                  const fn = prompt?.onOk;
                  const value = promptDraft;
                  setPrompt(null);
                  void fn?.(value);
                }}
              />
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );

}

/** One row of the long-press sheet — the desktop's `.ctx` menu items. */
function MenuRow({
  icon,
  label,
  danger,
  disabled,
  onPress,
}: {
  icon: IconName;
  label: string;
  danger?: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  const t = useTheme();
  const color = disabled ? t.neutral500 : danger ? t.danger : t.text;
  return (
    <Pressable
      disabled={disabled}
      onPress={onPress}
      android_ripple={{color: t.divider}}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 14,
        paddingHorizontal: 20,
        paddingVertical: 14,
      }}>
      <Icon name={icon} size={18} color={color} />
      <Text style={{color, fontSize: 15}}>{label}</Text>
    </Pressable>
  );
}

/* ══ root ═══════════════════════════════════════════════════ */

function Root() {
  const [prefs, setPrefs] = useState<UiPrefs>(DEFAULT_PREFS);
  const loaded = useRef(false);

  useEffect(() => {
    api
      .uiPrefs()
      .then(saved => {
        loaded.current = true;
        if (saved && Object.keys(saved).length) {
          setPrefs(p => ({...p, ...saved, sidebarOpen: false, inspectorOpen: false}));
        }
      })
      .catch(() => {
        loaded.current = true;
      });
  }, []);

  useEffect(() => {
    if (!loaded.current) return;
    void api.saveUiPrefs(prefs).catch(() => undefined);
  }, [prefs]);

  return (
    <ThemeProvider mode={prefs.theme}>
      <Shell prefs={prefs} setPrefs={setPrefs} />
    </ThemeProvider>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <Root />
    </SafeAreaProvider>
  );
}
