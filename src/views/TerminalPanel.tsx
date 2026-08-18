import React, {memo, useEffect, useState} from 'react';
import {Pressable, ScrollView, Text, TextInput, View} from 'react-native';
import {api, onTermData, onTermExit} from '../api';
import {MONO, Muted, useTheme} from '../ui/kit';
import {radius} from '../theme';

const ANSI = /\u001b\[[0-9;?]*[A-Za-z]|\u001b\][^\u0007]*\u0007|\u001b[PX^_].*?\u001b\\|\r/g;

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function decodeChunk(b64: string) {
  let str = '';
  let buf = 0;
  let bits = 0;
  for (const ch of b64.replace(/=+$/, '')) {
    const v = B64.indexOf(ch);
    if (v < 0) {
      continue;
    }
    buf = (buf << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      str += String.fromCharCode((buf >> bits) & 0xff);
    }
  }
  return str.replace(ANSI, '');
}

export const TerminalPanel = memo(function TerminalPanel({
  sessionId,
  cwd,
}: {
  sessionId: string;
  cwd: string;
}) {
  const t = useTheme();
  const [log, setLog] = useState('');
  const [line, setLine] = useState('');
  const [alive, setAlive] = useState(false);

  useEffect(() => {
    let mounted = true;
    setLog('');
    setAlive(true);
    void api.termOpen(sessionId, cwd, 80, 24).catch(e => {
      if (mounted) {
        setLog(String(e));
        setAlive(false);
      }
    });
    const offData = onTermData(e => {
      if (e.id !== sessionId) {
        return;
      }
      const text = decodeChunk(e.chunk);
      setLog(prev => (prev + text).slice(-80_000));
    });
    const offExit = onTermExit(e => {
      if (e.id !== sessionId) {
        return;
      }
      setAlive(false);
      setLog(prev => prev + `\n[exit ${e.code ?? '?'}]\n`);
    });
    return () => {
      mounted = false;
      offData();
      offExit();
      void api.termClose(sessionId);
    };
  }, [sessionId, cwd]);

  const send = () => {
    const payload = line.endsWith('\n') ? line : `${line}\n`;
    void api.termWrite(sessionId, payload);
    setLine('');
  };

  return (
    <View style={{flex: 1, backgroundColor: t.bg}}>
      <ScrollView style={{flex: 1}} contentContainerStyle={{padding: 10, minHeight: 80}}>
        <Text selectable style={{color: t.text, fontFamily: MONO, fontSize: 12, lineHeight: 16}}>
          {log || (alive ? '' : 'Shell closed')}
        </Text>
      </ScrollView>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
          paddingHorizontal: 10,
          paddingVertical: 8,
          borderTopWidth: 1,
          borderTopColor: t.divider,
        }}>
        <TextInput
          value={line}
          onChangeText={setLine}
          onSubmitEditing={send}
          placeholder={alive ? 'Command' : 'Shell exited'}
          placeholderTextColor={t.neutral600}
          autoCapitalize="none"
          autoCorrect={false}
          editable={alive}
          style={{
            flex: 1,
            height: 36,
            borderWidth: 1,
            borderColor: t.divider,
            borderRadius: radius.md,
            paddingHorizontal: 10,
            color: t.text,
            fontFamily: MONO,
            fontSize: 13,
            backgroundColor: t.raised,
          }}
        />
        <Pressable onPress={send} disabled={!alive} style={{padding: 8}}>
          <Muted size={12}>{alive ? 'Send' : '—'}</Muted>
        </Pressable>
      </View>
    </View>
  );
});
