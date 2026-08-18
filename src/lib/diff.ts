/**
 * Line diff for the editor's change gutter.
 *
 * This runs against the live buffer, not the saved file, so the marks track
 * what you are typing the way VS Code's dirty diff does.
 */

export type ChangeType = 'added' | 'modified' | 'deleted';

export interface LineChange {
  /** 1-based first line of the run in the current buffer. */
  start: number;
  /** 1-based last line, inclusive. Equals `start` for a deletion marker. */
  end: number;
  type: ChangeType;
}

const splitLines = (text: string) => (text.length ? text.split(/\r\n|\r|\n/) : []);

function commonSubsequence(a: string[], b: string[]): Array<[number, number]> {
  const rows = a.length;
  const cols = b.length;
  if (rows * cols > 4_000_000) {
    return [];
  }

  const table: Uint32Array = new Uint32Array((rows + 1) * (cols + 1));
  const at = (i: number, j: number) => i * (cols + 1) + j;

  for (let i = rows - 1; i >= 0; i--) {
    for (let j = cols - 1; j >= 0; j--) {
      table[at(i, j)] =
        a[i] === b[j] ? table[at(i + 1, j + 1)] + 1 : Math.max(table[at(i + 1, j)], table[at(i, j + 1)]);
    }
  }

  const pairs: Array<[number, number]> = [];
  let i = 0;
  let j = 0;
  while (i < rows && j < cols) {
    if (a[i] === b[j]) {
      pairs.push([i, j]);
      i++;
      j++;
    } else if (table[at(i + 1, j)] >= table[at(i, j + 1)]) {
      i++;
    } else {
      j++;
    }
  }
  return pairs;
}

export function diffLines(original: string, current: string): LineChange[] {
  if (original === current) {
    return [];
  }

  const a = splitLines(original);
  const b = splitLines(current);

  if (!a.length) {
    return b.length ? [{start: 1, end: b.length, type: 'added'}] : [];
  }
  if (!b.length) {
    return [{start: 0, end: 0, type: 'deleted'}];
  }

  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) {
    head++;
  }
  let tail = 0;
  while (
    tail < a.length - head &&
    tail < b.length - head &&
    a[a.length - 1 - tail] === b[b.length - 1 - tail]
  ) {
    tail++;
  }

  const midA = a.slice(head, a.length - tail);
  const midB = b.slice(head, b.length - tail);
  if (!midA.length && !midB.length) {
    return [];
  }
  if (!midA.length) {
    return [{start: head + 1, end: head + midB.length, type: 'added'}];
  }
  if (!midB.length) {
    return [{start: head, end: head, type: 'deleted'}];
  }

  const pairs = commonSubsequence(midA, midB);
  if (!pairs.length && midA.length && midB.length) {
    return [{start: head + 1, end: head + midB.length, type: 'modified'}];
  }

  const changes: LineChange[] = [];
  let ai = 0;
  let bi = 0;

  const emit = (removed: number, added: number, atB: number) => {
    if (!removed && !added) {
      return;
    }
    if (added && removed) {
      changes.push({start: head + atB + 1, end: head + atB + added, type: 'modified'});
    } else if (added) {
      changes.push({start: head + atB + 1, end: head + atB + added, type: 'added'});
    } else {
      changes.push({start: head + atB, end: head + atB, type: 'deleted'});
    }
  };

  for (const [pa, pb] of pairs) {
    emit(pa - ai, pb - bi, bi);
    ai = pa + 1;
    bi = pb + 1;
  }
  emit(midA.length - ai, midB.length - bi, bi);

  return changes;
}

export function changeCounts(changes: LineChange[]) {
  let added = 0;
  let removed = 0;
  for (const c of changes) {
    if (c.type === 'added') {
      added += c.end - c.start + 1;
    } else if (c.type === 'deleted') {
      removed += 1;
    } else {
      added += c.end - c.start + 1;
    }
  }
  return {added, removed};
}
