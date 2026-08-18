import React, {memo, useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {Alert, Pressable, ScrollView, Text, TextInput, View} from 'react-native';
import {api, baseName} from '../api';
import {changeCounts, diffLines} from '../lib/diff';
import {chromeIconFor, extOf} from '../lib/files';
import {Icon} from '../lib/icons';
import {languageForPath} from '../lib/lang';
import {radius} from '../theme';
import {MONO, Muted, useTheme} from '../ui/kit';
import {SourceControl} from './SourceControl';
import {TerminalPanel} from './TerminalPanel';
import type {DirEntry, GitFile, GitRepo} from '../types';

const MAX_EDITABLE = 4 * 1024 * 1024;
const GIT_POLL_MS = 5000;

const GIT_LETTER: Record<GitFile['kind'], string> = {
  modified: 'M',
  added: 'A',
  deleted: 'D',
  renamed: 'R',
  copied: 'C',
  untracked: 'U',
  conflicted: '!',
};

interface Doc {
  path: string;
  name: string;
  saved: string;
  buffer: string;
  language: string;
  head?: string;
  readonly?: boolean;
}

interface FileTab {
  key: string;
  path: string;
  diff?: 'staged' | 'work';
}

function TreeNode({
  entry,
  depth,
  expanded,
  tree,
  activePath,
  status,
  onToggle,
  onOpen,
}: {
  entry: DirEntry;
  depth: number;
  expanded: Set<string>;
  tree: Record<string, DirEntry[]>;
  activePath: string;
  status: Record<string, GitFile['kind']>;
  onToggle: (entry: DirEntry) => void;
  onOpen: (entry: DirEntry) => void;
}) {
  const t = useTheme();
  const open = expanded.has(entry.path);
  const kids = tree[entry.path];
  const git = status[entry.path];
  return (
    <>
      <Pressable
        onPress={() => (entry.isDir ? onToggle(entry) : onOpen(entry))}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 4,
          paddingVertical: 6,
          paddingLeft: 8 + depth * 12,
          paddingRight: 8,
          backgroundColor: entry.path === activePath ? t.accent100 : 'transparent',
        }}>
        <View style={{width: 12}}>
          {entry.isDir ? (
            <Icon name={open ? 'chevronDown' : 'chevronRight'} size={11} color={t.neutral600} />
          ) : null}
        </View>
        <Icon name={chromeIconFor(entry)} size={13} color={git ? t.accent : t.neutral700} />
        <Text numberOfLines={1} style={{flex: 1, color: t.text, fontSize: 12.5, fontWeight: '500'}}>
          {entry.name}
        </Text>
        {git ? (
          <Text style={{color: t.accent, fontSize: 10, fontWeight: '800'}}>{GIT_LETTER[git]}</Text>
        ) : null}
      </Pressable>
      {entry.isDir && open
        ? (kids || []).map(child => (
            <TreeNode
              key={child.path}
              entry={child}
              depth={depth + 1}
              expanded={expanded}
              tree={tree}
              activePath={activePath}
              status={status}
              onToggle={onToggle}
              onOpen={onOpen}
            />
          ))
        : null}
    </>
  );
}

export const CodeEditor = memo(function CodeEditor({
  workspace,
  openPath,
  onError,
  onTitle,
}: {
  workspace: string;
  openPath?: string;
  onError: (message: string) => void;
  onTitle?: (title: string) => void;
}) {
  const t = useTheme();
  const [root, setRoot] = useState(workspace);
  const [tree, setTree] = useState<Record<string, DirEntry[]>>({});
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set([workspace]));
  const [docs, setDocs] = useState<Record<string, Doc>>({});
  const [tabs, setTabs] = useState<FileTab[]>([]);
  const [activeKey, setActiveKey] = useState('');
  const [side, setSide] = useState<'explorer' | 'scm'>('explorer');
  const [termOn, setTermOn] = useState(false);
  const [repo, setRepo] = useState<GitRepo | null>(null);
  const [message, setMessage] = useState('');
  const [gitBusy, setGitBusy] = useState(false);
  const [leftOn, setLeftOn] = useState(true);
  const termId = useRef(`term-${workspace}`).current;

  const active = tabs.find(x => x.key === activeKey) ?? tabs[0];
  const doc = active ? docs[active.path] : undefined;

  const loadDir = useCallback(async (path: string) => {
    try {
      const items = await api.listDir(path);
      setTree(cur => ({...cur, [path]: items}));
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    }
  }, [onError]);

  useEffect(() => {
    setRoot(workspace);
    setExpanded(new Set([workspace]));
    void loadDir(workspace);
  }, [workspace, loadDir]);

  const refreshGit = useCallback(async () => {
    try {
      setRepo(await api.gitInfo(root));
    } catch {
      setRepo(null);
    }
  }, [root]);

  useEffect(() => {
    void refreshGit();
    const timer = setInterval(() => void refreshGit(), GIT_POLL_MS);
    return () => clearInterval(timer);
  }, [refreshGit]);

  const gitStatus = useMemo(() => {
    const map: Record<string, GitFile['kind']> = {};
    if (!repo) {
      return map;
    }
    for (const f of [...repo.staged, ...repo.unstaged]) {
      map[f.absPath] = f.kind;
    }
    return map;
  }, [repo]);

  const openFile = useCallback(
    async (path: string, diff?: FileTab['diff']) => {
      const key = diff ? `diff:${diff}:${path}` : path;
      if (!docs[path]) {
        try {
          const isText = await api.isTextFile(path).catch(() => true);
          if (!isText) {
            onError('That file looks binary — open it with another app.');
            return;
          }
          const saved = await api.readText(path, MAX_EDITABLE);
          const rel = path.startsWith(`${root}/`) ? path.slice(root.length + 1) : baseName(path);
          const head = await api.gitShow(repo?.root || root, 'HEAD', rel).catch(() => '');
          setDocs(cur => ({
            ...cur,
            [path]: {
              path,
              name: baseName(path),
              saved,
              buffer: saved,
              language: languageForPath(path),
              head,
            },
          }));
        } catch (e) {
          onError(e instanceof Error ? e.message : String(e));
          return;
        }
      }
      setTabs(cur => (cur.some(x => x.key === key) ? cur : [...cur, {key, path, diff}]));
      setActiveKey(key);
      onTitle?.(baseName(path));
    },
    [docs, onError, onTitle, repo?.root, root],
  );

  useEffect(() => {
    if (openPath && openPath !== root) {
      void openFile(openPath);
    }
    // Opening a path should not re-run every time the buffer changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openPath, root]);

  const toggle = useCallback(
    (entry: DirEntry) => {
      setExpanded(cur => {
        const next = new Set(cur);
        if (next.has(entry.path)) {
          next.delete(entry.path);
        } else {
          next.add(entry.path);
          if (!tree[entry.path]) {
            void loadDir(entry.path);
          }
        }
        return next;
      });
    },
    [loadDir, tree],
  );

  const save = useCallback(async (path?: string) => {
    const target = path || active?.path;
    const current = target ? docs[target] : undefined;
    if (!current || current.readonly) {
      return;
    }
    try {
      await api.writeText(current.path, current.buffer);
      setDocs(cur => ({...cur, [current.path]: {...current, saved: current.buffer}}));
      void refreshGit();
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    }
  }, [active?.path, docs, onError, refreshGit]);

  const saveAll = useCallback(async () => {
    for (const d of Object.values(docs)) {
      if (d.buffer !== d.saved) {
        await save(d.path);
      }
    }
  }, [docs, save]);

  const closeFile = useCallback(
    (key: string) => {
      const tab = tabs.find(x => x.key === key);
      const current = tab ? docs[tab.path] : undefined;
      const run = () => {
        setTabs(cur => {
          const next = cur.filter(x => x.key !== key);
          if (key === activeKey) {
            setActiveKey(next[next.length - 1]?.key || '');
          }
          return next;
        });
      };
      if (current && current.buffer !== current.saved) {
        Alert.alert('Unsaved changes', `Save ${current.name} before closing?`, [
          {text: 'Cancel', style: 'cancel'},
          {text: 'Discard', style: 'destructive', onPress: run},
          {
            text: 'Save',
            onPress: () => {
              void save(current.path).then(run);
            },
          },
        ]);
        return;
      }
      run();
    },
    [activeKey, docs, save, tabs],
  );

  const patchBuffer = (text: string) => {
    if (!active || !doc) {
      return;
    }
    setDocs(cur => ({...cur, [doc.path]: {...doc, buffer: text}}));
  };

  const shown = useMemo(() => {
    if (!doc) {
      return '';
    }
    if (active?.diff === 'staged') {
      return doc.head ?? '';
    }
    return doc.buffer;
  }, [active?.diff, doc]);

  const counts = useMemo(() => {
    if (!doc?.head) {
      return null;
    }
    return changeCounts(diffLines(doc.head, doc.buffer));
  }, [doc]);

  const dirty = Boolean(doc && doc.buffer !== doc.saved);
  const roots = tree[root] || [];

  return (
    <View style={{flex: 1, backgroundColor: t.bg}}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 6,
          paddingHorizontal: 8,
          height: 42,
          borderBottomWidth: 1,
          borderBottomColor: t.divider,
        }}>
        <Pressable onPress={() => setLeftOn(v => !v)} hitSlop={8} accessibilityLabel="Toggle explorer">
          <Icon name="panelLeft" size={15} color={leftOn ? t.accent : t.neutral700} />
        </Pressable>
        <Text numberOfLines={1} style={{flex: 1, color: t.text, fontSize: 13, fontWeight: '700'}}>
          {baseName(root)}
        </Text>
        <Pressable onPress={() => void save()} hitSlop={8} accessibilityLabel="Save">
          <Muted size={12} style={{fontWeight: '700'}}>
            {dirty ? 'Save' : 'Saved'}
          </Muted>
        </Pressable>
        <Pressable onPress={() => void saveAll()} hitSlop={8} accessibilityLabel="Save all">
          <Icon name="check" size={15} color={t.neutral700} />
        </Pressable>
        <Pressable onPress={() => setTermOn(v => !v)} hitSlop={8} accessibilityLabel="Terminal">
          <Icon name="terminal" size={15} color={termOn ? t.accent : t.neutral700} />
        </Pressable>
      </View>

      <View style={{flex: 1, flexDirection: 'row'}}>
        {leftOn ? (
          <View style={{width: 168, borderRightWidth: 1, borderRightColor: t.divider}}>
            <View style={{flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: t.divider}}>
              {(['explorer', 'scm'] as const).map(pane => (
                <Pressable
                  key={pane}
                  onPress={() => setSide(pane)}
                  style={{
                    flex: 1,
                    height: 34,
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: side === pane ? t.accent100 : 'transparent',
                  }}>
                  <Icon
                    name={pane === 'explorer' ? 'folder' : 'net'}
                    size={14}
                    color={side === pane ? t.accent : t.neutral700}
                  />
                </Pressable>
              ))}
            </View>
            {side === 'explorer' ? (
              <ScrollView>
                {roots.map(entry => (
                  <TreeNode
                    key={entry.path}
                    entry={entry}
                    depth={0}
                    expanded={expanded}
                    tree={tree}
                    activePath={active?.path || ''}
                    status={gitStatus}
                    onToggle={toggle}
                    onOpen={item => void openFile(item.path)}
                  />
                ))}
              </ScrollView>
            ) : (
              <SourceControl
                repo={repo}
                activePath={active?.path || ''}
                busy={gitBusy}
                message={message}
                onMessage={setMessage}
                onOpenDiff={file => void openFile(file.absPath, file.staged ? 'staged' : 'work')}
                onStage={paths => {
                  if (!repo) {
                    return;
                  }
                  setGitBusy(true);
                  void api
                    .gitStage(repo.root, paths)
                    .then(refreshGit)
                    .catch(e => onError(String(e)))
                    .finally(() => setGitBusy(false));
                }}
                onUnstage={paths => {
                  if (!repo) {
                    return;
                  }
                  setGitBusy(true);
                  void api
                    .gitUnstage(repo.root, paths)
                    .then(refreshGit)
                    .catch(e => onError(String(e)))
                    .finally(() => setGitBusy(false));
                }}
                onDiscard={files => {
                  if (!repo) {
                    return;
                  }
                  Alert.alert(
                    'Discard changes',
                    files.some(f => f.kind === 'untracked')
                      ? 'Untracked files will be deleted.'
                      : 'Working-tree edits will be thrown away.',
                    [
                      {text: 'Cancel', style: 'cancel'},
                      {
                        text: 'Discard',
                        style: 'destructive',
                        onPress: () => {
                          setGitBusy(true);
                          void api
                            .gitDiscard(repo.root, files.map(f => f.path))
                            .then(refreshGit)
                            .catch(e => onError(String(e)))
                            .finally(() => setGitBusy(false));
                        },
                      },
                    ],
                  );
                }}
                onCommit={() => {
                  if (!repo) {
                    return;
                  }
                  setGitBusy(true);
                  void api
                    .gitCommit(repo.root, message)
                    .then(() => {
                      setMessage('');
                      return refreshGit();
                    })
                    .catch(e => onError(String(e)))
                    .finally(() => setGitBusy(false));
                }}
                onRefresh={() => void refreshGit()}
              />
            )}
          </View>
        ) : null}

        <View style={{flex: 1}}>
          {tabs.length ? (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={{maxHeight: 36, flexGrow: 0, borderBottomWidth: 1, borderBottomColor: t.divider}}
              contentContainerStyle={{alignItems: 'center', paddingHorizontal: 6, gap: 4}}>
              {tabs.map(tab => {
                const d = docs[tab.path];
                const on = tab.key === active?.key;
                return (
                  <Pressable
                    key={tab.key}
                    onPress={() => setActiveKey(tab.key)}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 4,
                      height: 28,
                      paddingHorizontal: 8,
                      borderRadius: radius.pill,
                      backgroundColor: on ? t.accent100 : 'transparent',
                    }}>
                    <Text style={{color: on ? t.accent : t.text, fontSize: 11.5, fontWeight: on ? '700' : '500'}}>
                      {tab.diff ? `${tab.diff === 'staged' ? 'Staged' : 'Changes'} · ` : ''}
                      {d?.name || baseName(tab.path)}
                      {d && d.buffer !== d.saved ? ' •' : ''}
                    </Text>
                    <Pressable hitSlop={6} onPress={() => closeFile(tab.key)}>
                      <Icon name="close" size={10} color={t.neutral600} />
                    </Pressable>
                  </Pressable>
                );
              })}
            </ScrollView>
          ) : null}

          {doc ? (
            <TextInput
              value={shown}
              onChangeText={active?.diff === 'staged' ? undefined : patchBuffer}
              editable={!active?.diff || active.diff === 'work'}
              multiline
              autoCapitalize="none"
              autoCorrect={false}
              textAlignVertical="top"
              style={{
                flex: 1,
                padding: 10,
                color: t.text,
                fontFamily: MONO,
                fontSize: 12.5,
                lineHeight: 18,
              }}
            />
          ) : (
            <View style={{flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24}}>
              <Muted size={13}>Open a file from the explorer, or use Edit this folder from Places.</Muted>
            </View>
          )}

          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 10,
              height: 26,
              paddingHorizontal: 10,
              borderTopWidth: 1,
              borderTopColor: t.divider,
              backgroundColor: t.surface,
            }}>
            <Muted size={10.5}>{doc?.language || 'plaintext'}</Muted>
            {counts ? (
              <Muted size={10.5}>
                +{counts.added} −{counts.removed}
              </Muted>
            ) : null}
            {repo ? <Muted size={10.5}>{repo.branch}</Muted> : null}
            {extOf(doc?.name || '') ? <Muted size={10.5}>{extOf(doc?.name || '').toUpperCase()}</Muted> : null}
          </View>
        </View>
      </View>

      {termOn ? (
        <View style={{height: 180, borderTopWidth: 1, borderTopColor: t.divider}}>
          <TerminalPanel sessionId={termId} cwd={root} />
        </View>
      ) : null}
    </View>
  );
});
