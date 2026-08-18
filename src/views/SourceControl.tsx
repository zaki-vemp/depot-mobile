import React, {memo, useState} from 'react';
import {Pressable, ScrollView, Text, TextInput, View} from 'react-native';
import {Icon} from '../lib/icons';
import {radius} from '../theme';
import {Btn, Heading, Muted, useTheme} from '../ui/kit';
import type {GitFile, GitRepo} from '../types';

const MARK: Record<GitFile['kind'], {letter: string; label: string; color: string}> = {
  modified: {letter: 'M', label: 'Modified', color: '#c47d1a'},
  added: {letter: 'A', label: 'Added', color: '#2a8a4a'},
  deleted: {letter: 'D', label: 'Deleted', color: '#c4453a'},
  renamed: {letter: 'R', label: 'Renamed', color: '#c47d1a'},
  copied: {letter: 'C', label: 'Copied', color: '#c47d1a'},
  untracked: {letter: 'U', label: 'Untracked', color: '#2a8a4a'},
  conflicted: {letter: '!', label: 'Conflicted', color: '#c4453a'},
};

function Row({
  file,
  active,
  onOpen,
  onStage,
  onUnstage,
  onDiscard,
}: {
  file: GitFile;
  active: boolean;
  onOpen: () => void;
  onStage?: () => void;
  onUnstage?: () => void;
  onDiscard?: () => void;
}) {
  const t = useTheme();
  const mark = MARK[file.kind];
  const dir = file.path.includes('/') ? file.path.slice(0, file.path.lastIndexOf('/')) : '';
  return (
    <Pressable
      onPress={onOpen}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        paddingVertical: 8,
        paddingHorizontal: 10,
        backgroundColor: active ? t.accent100 : 'transparent',
      }}>
      <View style={{flex: 1}}>
        <Text numberOfLines={1} style={{color: t.text, fontSize: 13, fontWeight: '600'}}>
          {file.name}
        </Text>
        {dir ? (
          <Text numberOfLines={1} style={{color: t.neutral600, fontSize: 10.5}}>
            {dir}
          </Text>
        ) : null}
      </View>
      {onStage ? (
        <Pressable hitSlop={8} onPress={onStage} accessibilityLabel="Stage">
          <Icon name="plus" size={14} color={t.accent} />
        </Pressable>
      ) : null}
      {onUnstage ? (
        <Pressable hitSlop={8} onPress={onUnstage} accessibilityLabel="Unstage">
          <Icon name="close" size={14} color={t.neutral700} />
        </Pressable>
      ) : null}
      {onDiscard ? (
        <Pressable hitSlop={8} onPress={onDiscard} accessibilityLabel="Discard">
          <Icon name="trash" size={13} color={t.danger} />
        </Pressable>
      ) : null}
      <Text style={{color: mark.color, fontSize: 12, fontWeight: '800', width: 14}}>{mark.letter}</Text>
    </Pressable>
  );
}

export const SourceControl = memo(function SourceControl({
  repo,
  activePath,
  busy,
  message,
  onMessage,
  onOpenDiff,
  onStage,
  onUnstage,
  onDiscard,
  onCommit,
  onRefresh,
}: {
  repo: GitRepo | null;
  activePath: string;
  busy: boolean;
  message: string;
  onMessage: (value: string) => void;
  onOpenDiff: (file: GitFile) => void;
  onStage: (paths: string[]) => void;
  onUnstage: (paths: string[]) => void;
  onDiscard: (files: GitFile[]) => void;
  onCommit: () => void;
  onRefresh: () => void;
}) {
  const t = useTheme();
  const [openStaged, setOpenStaged] = useState(true);
  const [openWork, setOpenWork] = useState(true);

  if (!repo) {
    return (
      <View style={{padding: 14, gap: 10}}>
        <View style={{flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between'}}>
          <Heading size={14}>Source control</Heading>
          <Pressable onPress={onRefresh} hitSlop={8}>
            <Icon name="reload" size={14} color={t.neutral700} />
          </Pressable>
        </View>
        <Muted size={12.5} style={{lineHeight: 18}}>
          This folder is not inside a git repository — or git is not installed on this device.
        </Muted>
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={{paddingBottom: 24}}>
      <View style={{paddingHorizontal: 12, paddingTop: 10, gap: 10}}>
        <View style={{flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between'}}>
          <Heading size={14}>Source control</Heading>
          <Pressable onPress={onRefresh} hitSlop={8} disabled={busy}>
            <Icon name="reload" size={14} color={t.neutral700} />
          </Pressable>
        </View>
        <View style={{flexDirection: 'row', alignItems: 'center', gap: 6}}>
          <Icon name="net" size={13} color={t.neutral700} />
          <Text style={{color: t.text, fontSize: 12.5, fontWeight: '600'}}>{repo.branch}</Text>
          {repo.ahead > 0 ? <Muted size={11}>↑{repo.ahead}</Muted> : null}
          {repo.behind > 0 ? <Muted size={11}>↓{repo.behind}</Muted> : null}
        </View>
        <TextInput
          value={message}
          onChangeText={onMessage}
          placeholder={`Message on ${repo.branch}`}
          placeholderTextColor={t.neutral600}
          multiline
          style={{
            minHeight: 56,
            borderWidth: 1,
            borderColor: t.divider,
            borderRadius: radius.md,
            padding: 10,
            color: t.text,
            fontSize: 13,
            backgroundColor: t.raised,
          }}
        />
        <Btn
          label={repo.staged.length ? `Commit (${repo.staged.length})` : 'Commit'}
          kind="primary"
          block
          disabled={busy || !message.trim() || !repo.staged.length}
          onPress={onCommit}
        />
      </View>

      {repo.staged.length ? (
        <View style={{marginTop: 12}}>
          <Pressable
            onPress={() => setOpenStaged(o => !o)}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 6,
              paddingHorizontal: 12,
              paddingVertical: 6,
            }}>
            <Icon name={openStaged ? 'chevronDown' : 'chevronRight'} size={12} color={t.neutral700} />
            <Text style={{color: t.neutral700, fontSize: 11.5, fontWeight: '700', flex: 1}}>
              Staged changes
            </Text>
            <Pressable hitSlop={8} onPress={() => onUnstage(repo.staged.map(f => f.path))}>
              <Icon name="close" size={13} color={t.neutral700} />
            </Pressable>
            <Muted size={11}>{String(repo.staged.length)}</Muted>
          </Pressable>
          {openStaged
            ? repo.staged.map(f => (
                <Row
                  key={`s:${f.path}`}
                  file={f}
                  active={activePath === f.absPath}
                  onOpen={() => onOpenDiff(f)}
                  onUnstage={() => onUnstage([f.path])}
                />
              ))
            : null}
        </View>
      ) : null}

      {repo.unstaged.length ? (
        <View style={{marginTop: 8}}>
          <Pressable
            onPress={() => setOpenWork(o => !o)}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 6,
              paddingHorizontal: 12,
              paddingVertical: 6,
            }}>
            <Icon name={openWork ? 'chevronDown' : 'chevronRight'} size={12} color={t.neutral700} />
            <Text style={{color: t.neutral700, fontSize: 11.5, fontWeight: '700', flex: 1}}>Changes</Text>
            <Pressable hitSlop={8} onPress={() => onStage(repo.unstaged.map(f => f.path))}>
              <Icon name="plus" size={13} color={t.accent} />
            </Pressable>
            <Muted size={11}>{String(repo.unstaged.length)}</Muted>
          </Pressable>
          {openWork
            ? repo.unstaged.map(f => (
                <Row
                  key={`u:${f.path}`}
                  file={f}
                  active={activePath === f.absPath}
                  onOpen={() => onOpenDiff(f)}
                  onStage={() => onStage([f.path])}
                  onDiscard={() => onDiscard([f])}
                />
              ))
            : null}
        </View>
      ) : null}
    </ScrollView>
  );
});
