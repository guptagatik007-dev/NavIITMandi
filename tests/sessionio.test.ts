import { describe, it, expect } from 'vitest';
import { serialiseSession, mergeSession, SessionFileSchema, type SessionSnapshot } from '@/features/editor/sessionIO';

const empty: SessionSnapshot = { saved: {}, addedBuildings: [], addedLabels: [], roadEdits: {}, addedRoads: [] };

describe('teamwork session files', () => {
  it('round-trips through serialise + schema validation', () => {
    const text = serialiseSession(
      {
        ...empty,
        saved: { 'osm-1': { name: 'A Block', floors: 4 } },
        roadEdits: { 'r-1': [[76.98, 31.77], [76.99, 31.78]] },
      },
      'Aditi',
      'North campus',
    );
    const parsed = SessionFileSchema.safeParse(JSON.parse(text));
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.author).toBe('Aditi');
      expect(parsed.data.zone).toBe('North campus');
      expect(parsed.data.saved['osm-1']?.name).toBe('A Block');
    }
  });

  it('rejects a random json file', () => {
    expect(SessionFileSchema.safeParse({ hello: 'world' }).success).toBe(false);
  });

  it('merges disjoint work cleanly', () => {
    const mine: SessionSnapshot = { ...empty, saved: { 'osm-1': { name: 'Mine' } } };
    const theirs: SessionSnapshot = { ...empty, saved: { 'osm-2': { floors: 5 } }, addedLabels: [{ id: 'l1', text: 'Gate', lat: 31.77, lng: 76.98, tier: 'primary', offsetM: 5 }] };
    const r = mergeSession(mine, theirs);
    expect(Object.keys(r.merged.saved).sort()).toEqual(['osm-1', 'osm-2']);
    expect(r.merged.addedLabels).toHaveLength(1);
    expect(r.applied.buildings).toBe(1);
    expect(r.conflicts).toHaveLength(0);
  });

  it('first import wins on conflicts, untouched fields still merge', () => {
    const mine: SessionSnapshot = { ...empty, saved: { 'osm-1': { name: 'Mine', floors: 3 } } };
    const theirs: SessionSnapshot = { ...empty, saved: { 'osm-1': { name: 'Theirs', wall: 'brick_red' } } };
    const r = mergeSession(mine, theirs);
    expect(r.merged.saved['osm-1']?.name).toBe('Mine'); // conflict kept mine
    expect(r.merged.saved['osm-1']?.wall).toBe('brick_red'); // new field merged in
    expect(r.conflicts.some((c) => c.includes('name'))).toBe(true);
    expect(r.conflicts.some((c) => c.includes('wall'))).toBe(false);
  });

  it('never duplicates ids for added buildings/labels/roads', () => {
    const road = { id: 'mroad-x', name: null, cls: 'footway' as const, width_m: 1.5, surface: 'unpaved', line: [[76.98, 31.77], [76.99, 31.78]] as [number, number][] };
    const mine: SessionSnapshot = { ...empty, addedRoads: [road] };
    const theirs: SessionSnapshot = { ...empty, addedRoads: [road] };
    const r = mergeSession(mine, theirs);
    expect(r.merged.addedRoads).toHaveLength(1);
    expect(r.applied.roads).toBe(0);
  });
});
