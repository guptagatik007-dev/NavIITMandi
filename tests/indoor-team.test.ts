import { describe, expect, it } from 'vitest';
import { useIndoor, type IndoorFloor, type IndoorBuilding } from '@/store/indoorStore';

const mkFloor = (label: string, labels: IndoorFloor['labels'] = []): IndoorFloor => ({
  id: `f-${label}`,
  label,
  elevationM: 0,
  heightM: 3.6,
  rooms: [],
  labels,
  connections: [],
});

const building: Pick<IndoorBuilding, 'id' | 'name' | 'origin'> = {
  id: 'b-test-1',
  name: 'Old Hostel Name',
  origin: { lat: 31.7755, lng: 76.9865, rotationDeg: 0 },
};

describe('teamwork — indoor floor merge + name propagation', () => {
  it('adopts new floors per label and merges same-label floors by filling gaps only', () => {
    const s = useIndoor.getState();
    // teammate A worked floor 1 with one label; teammate B worked floor 2
    const r1 = s.mergeExternalFloors(building, [mkFloor('1', [{ id: 'l-101', text: 'Room 101', x: 0.2, y: 0.3, kind: 'room' }]), mkFloor('2')]);
    expect(r1.adopted.sort()).toEqual(['1', '2']);

    // another bundle for floor 1 brings a NEW label — gap is filled, existing kept
    const r2 = useIndoor.getState().mergeExternalFloors(building, [
      mkFloor('1', [
        { id: 'l-101', text: 'Room 101', x: 0.2, y: 0.3, kind: 'room' }, // duplicate → skipped
        { id: 'l-102', text: 'Room 102', x: 0.7, y: 0.3, kind: 'room' }, // new → added
      ]),
    ]);
    expect(r2.merged).toEqual(['1']);
    const b = useIndoor.getState().localPlans.find((x) => x.id === building.id)!;
    const f1 = b.floors.find((f) => f.label === '1')!;
    expect(f1.labels?.map((l) => l.text)).toEqual(['Room 101', 'Room 102']);

    // a bundle with NOTHING new reports the conflict instead of duplicating
    const r3 = useIndoor.getState().mergeExternalFloors(building, [mkFloor('1', [{ id: 'l-101', text: 'Room 101', x: 0.2, y: 0.3, kind: 'room' }])]);
    expect(r3.conflicts.length).toBe(1);
  });

  it('rebuilding a renamed building renames the indoor copy too', () => {
    const names = new Map([[building.id, 'New Hostel Name']]);
    useIndoor.getState().syncBuildingNames(names);
    const b = useIndoor.getState().localPlans.find((x) => x.id === building.id)!;
    expect(b.name).toBe('New Hostel Name');
    // unrelated ids are untouched
    useIndoor.getState().syncBuildingNames(new Map([['someone-else', 'Nope']]));
    expect(useIndoor.getState().localPlans.find((x) => x.id === building.id)!.name).toBe('New Hostel Name');
  });
});
