export type SourceKind = 'local' | 'gdrive';

export interface DirEntry {
  name: string;
  path: string;
  isDir: boolean;
  size: number;
  modified: number | null;
  ext: string;
  source: SourceKind;
  mimeType?: string | null;
  accountId?: string | null;
}

export interface Place {
  name: string;
  path: string;
  kind: string;
}

export interface DriveAccount {
  id: string;
  email: string;
}

export interface AppSettings {
  googleClientId: string;
  googleClientSecret: string;
  oneDriveClientId: string;
  oneDriveClientSecret: string;
  dropboxClientId: string;
  dropboxClientSecret: string;
  s3Endpoint: string;
  s3Region: string;
  s3Bucket: string;
  s3AccessKeyId: string;
  s3SecretAccessKey: string;
  torrentDownloadDir: string;
}

export interface TorrentInfo {
  id: number;
  name: string;
  progress: number;
  downloaded: number;
  total: number;
  downloadSpeed: number;
  state: string;
  error?: string | null;
  outputFolder: string;
}

export interface DiskUsage {
  total: number;
  free: number;
  mount: string;
}

export type TransferState = 'queued' | 'running' | 'done' | 'error';

export interface Transfer {
  id: string;
  name: string;
  route: string;
  op: 'copy' | 'move' | 'download' | 'upload';
  from: string;
  to: string;
  moved: number;
  total: number;
  speed: number;
  state: TransferState;
  error?: string;
  startedAt: number;
  updatedAt: number;
}

/** Payload emitted by the native `transfer` event. */
export interface TransferEvent {
  id: string;
  moved: number;
  total: number;
  state: TransferState;
  error?: string | null;
}

export type TabKind =
  | 'files'
  | 'preview'
  | 'web'
  | 'app'
  | 'torrents'
  | 'settings'
  | 'drives'
  | 'transfers'
  | 'editor'
  | 'share';

export type SocialAppKind = 'facebook' | 'instagram';

export interface Tab {
  id: string;
  kind: TabKind;
  title: string;
  path?: string;
  source?: SourceKind;
  accountId?: string;
  folderId?: string;
  url?: string;
  app?: SocialAppKind;
  /** File to open inside an editor workspace tab. */
  file?: string;
  /** Media siblings of the folder this preview was opened from. */
  playlist?: DirEntry[];
  /** Visited locations for this tab, used by back/forward. */
  history: HistoryEntry[];
  historyIndex: number;
}

export interface HistoryEntry {
  /** Local path, or Drive folder id for `gdrive` tabs. */
  loc: string;
  title: string;
}

export type RepeatMode = 'off' | 'one' | 'all';

export interface UiPrefs {
  theme: 'light' | 'dark';
  view: 'grid' | 'list';
  showHidden: boolean;
  useTrash: boolean;
  systemFallback: boolean;
  confirmDelete: boolean;
  /** Mobile stands in for the desktop side panels with a drawer and a sheet. */
  sidebarOpen: boolean;
  inspectorOpen: boolean;
}

export type ViewerKind =
  | 'video'
  | 'audio'
  | 'image'
  | 'pdf'
  | 'text'
  | 'spreadsheet'
  | 'document'
  | 'slides'
  | 'unknown';

export type FileKind =
  | 'folder'
  | 'image'
  | 'video'
  | 'audio'
  | 'pdf'
  | 'doc'
  | 'sheet'
  | 'slides'
  | 'code'
  | 'text'
  | 'archive'
  | 'disk'
  | 'file';

/* -- nearby sharing -------------------------------------------------- */

export interface SharePeer {
  id: string;
  name: string;
  host: string;
  port: number;
}

export interface ShareFile {
  path: string;
  size: number;
}

/** An incoming transfer waiting on this device to accept or decline it. */
export interface ShareOffer {
  id: string;
  from: string;
  host: string;
  files: ShareFile[];
  total: number;
}

export interface ShareProgress {
  id: string;
  name: string;
  moved: number;
  total: number;
  direction: 'in' | 'out';
}

export interface ShareDone {
  id: string;
  state: 'done' | 'declined' | 'error';
  error?: string;
  folder?: string;
}

/** One row on the share screen: a send or a receive, live or finished. */
export interface ShareJob {
  id: string;
  name: string;
  moved: number;
  total: number;
  direction: 'in' | 'out';
  state: 'running' | 'done' | 'declined' | 'error';
  error?: string;
  folder?: string;
}

export interface ShareStatus {
  running: boolean;
  id?: string;
  name?: string;
  port?: number;
}

/** One region of recognised text, with its box in the decoded image. */
export interface OcrBlock {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface OcrResult {
  text: string;
  blocks: OcrBlock[];
  width: number;
  height: number;
}

/** Where the player left off in one file. Kept in `playback.json`. */
export interface PlaybackMark {
  position: number;
  duration: number;
  at: number;
}

export interface SubtitleTrack {
  id: string;
  label: string;
  language?: string | null;
  kind: 'sidecar' | 'embedded';
}

export interface OpenApp {
  name: string;
  path: string;
  isDefault: boolean;
}

export interface OfficeSheet {
  name: string;
  rows: string[][];
}

export interface OfficePage {
  title: string;
  body: string;
}

export interface OfficePreview {
  kind: 'spreadsheet' | 'document' | 'slides';
  sheets: OfficeSheet[];
  pages: OfficePage[];
  truncated: boolean;
  note: string;
}

/** One rendered page of a PDF, as a `file://` path to a cached bitmap. */
export interface PdfPage {
  index: number;
  uri: string;
  width: number;
  height: number;
}

export type GitChangeKind =
  | 'modified'
  | 'added'
  | 'deleted'
  | 'renamed'
  | 'copied'
  | 'untracked'
  | 'conflicted';

export interface GitFile {
  path: string;
  absPath: string;
  name: string;
  kind: GitChangeKind;
  staged: boolean;
  origPath?: string | null;
}

export interface GitRepo {
  root: string;
  branch: string;
  ahead: number;
  behind: number;
  upstream?: string | null;
  staged: GitFile[];
  unstaged: GitFile[];
}

export interface TermData {
  id: string;
  chunk: string;
}

export interface TermExit {
  id: string;
  code: number | null;
}

export interface EditorDoc {
  path: string;
  name: string;
  saved: string;
  language: string;
  readonly?: boolean;
}
