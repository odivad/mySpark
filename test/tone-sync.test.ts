import { describe, expect, it } from 'vitest';
import type { SavedTone } from '../src/app/tone-db.js';
import { HISTORY_MAX, addSnapshot, buildLibrary, mergeLibraries, parseLibrary, planRestore, type Snapshot } from '../src/app/tone-sync.js';

const tone = (id: string, createdAt = `2026-09-${10 + id.length}T00:00:00.000Z`): SavedTone =>
  ({ id, name: `Tone ${id}`, description: '', createdAt, source: 'ai', preset: { name: `Tone ${id}`, effects: [] } }) as unknown as SavedTone;

describe('tone library file', () => {
  it('round-trips through Export and Import', () => {
    const lib = buildLibrary([tone('a')], [{ id: 'x', deletedAt: '2026-09-01T00:00:00.000Z' }], new Date('2026-09-29T00:00:00Z'));
    const { library, skipped } = parseLibrary(JSON.stringify(lib));
    expect(skipped).toBe(0);
    expect(library.tones.map((t) => t.id)).toEqual(['a']);
    expect(library.deleted).toEqual(lib.deleted);
  });

  it('reads the first Export format (version 1, no deletions)', () => {
    const v1 = { format: 'myspark-tones', version: 1, exportedAt: '2026-09-28T00:00:00Z', tones: [tone('a')] };
    expect(parseLibrary(JSON.stringify(v1)).library.deleted).toEqual([]);
  });

  it('rejects other files and skips unreadable tones', () => {
    expect(() => parseLibrary('nope')).toThrow(/not a JSON/);
    expect(() => parseLibrary('{"format":"other"}')).toThrow(/not a mySpark/);
    expect(() => parseLibrary('{"format":"myspark-tones","version":99}')).toThrow(/unsupported/);
    const r = parseLibrary(JSON.stringify({ format: 'myspark-tones', version: 2, tones: [tone('a'), { id: 'b' }], deleted: [] }));
    expect(r.library.tones).toHaveLength(1);
    expect(r.skipped).toBe(1);
  });
});

describe('mergeLibraries', () => {
  it('adds what the other device has and keeps deletions deleted, both ways', () => {
    const pc = { tones: [tone('a'), tone('b')], deleted: [{ id: 'c', deletedAt: '2026-09-20T00:00:00Z' }] };
    const tablet = { tones: [tone('b'), tone('c'), tone('d')], deleted: [{ id: 'a', deletedAt: '2026-09-21T00:00:00Z' }] };
    const onPc = mergeLibraries(pc, tablet);
    expect(onPc.added.map((t) => t.id)).toEqual(['d']);
    expect(onPc.removed).toEqual(['a']);
    expect(onPc.tones.map((t) => t.id).sort()).toEqual(['b', 'd']);
    const onTablet = mergeLibraries(tablet, pc);
    expect(onTablet.tones.map((t) => t.id).sort()).toEqual(['b', 'd']);
    expect(onTablet.deleted.map((d) => d.id).sort()).toEqual(['a', 'c']);
  });

  it('changes nothing when merging the same library again', () => {
    const lib = { tones: [tone('a')], deleted: [] };
    const r = mergeLibraries(lib, lib);
    expect(r.added).toEqual([]);
    expect(r.removed).toEqual([]);
  });
});

describe('short-term history', () => {
  const snap = (id: string, takenAt: string, tones: SavedTone[] = []): Snapshot => ({ id, takenAt, reason: 'test', tones });

  it(`keeps the newest ${HISTORY_MAX}, and none older than the age limit`, () => {
    const now = new Date('2026-09-29T12:00:00Z');
    let h: Snapshot[] = [snap('old', '2026-08-01T00:00:00Z')];
    for (let i = 0; i < HISTORY_MAX + 5; i++) h = addSnapshot(h, snap(`s${i}`, new Date(now.getTime() - (HISTORY_MAX + 5 - i) * 60_000).toISOString()), now);
    expect(h).toHaveLength(HISTORY_MAX);
    expect(h[0].id).toBe(`s${HISTORY_MAX + 4}`);
    expect(h.some((s) => s.id === 'old')).toBe(false);
  });

  it('restores: added-since tones go, deleted-since tones come back under a new id', () => {
    const before = snap('v1', '2026-09-29T10:00:00Z', [tone('a'), tone('b')]);
    const plan = planRestore([tone('b'), tone('c')], before, () => 'new-id');
    expect(plan.removeIds).toEqual(['c']);
    expect(plan.add.map((t) => [t.id, t.name])).toEqual([['new-id', 'Tone a']]);
  });
});
