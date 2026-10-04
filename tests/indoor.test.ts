import { describe, expect, it } from 'vitest';
import { routeOnFloor, type IndoorFloor } from '@/store/indoorStore';

const floor: IndoorFloor = {
  id: 'G',
  label: 'Ground',
  elevationM: 0,
  heightM: 3.6,
  rooms: [],
  labels: [
    { id: 'room-a', text: 'Room A', x: 0.1, y: 0.2, kind: 'room' },
    { id: 'door', text: 'Main door', x: 0.5, y: 0.2, kind: 'door' },
    { id: 'room-b', text: 'Room B', x: 0.9, y: 0.2, kind: 'room' },
  ],
  connections: [
    { id: 'e1', from: 'room-a', to: 'door', kind: 'walk', accessible: true },
    { id: 'e2', from: 'door', to: 'room-b', kind: 'walk', accessible: true },
  ],
};

describe('manual indoor floor graph', () => {
  it('routes through user-connected floor labels', () => {
    const path = routeOnFloor(floor, 'room-a', 'room-b');
    expect(path?.map((node) => node.id)).toEqual(['room-a', 'door', 'room-b']);
  });

  it('refuses a disconnected floor instead of drawing an invented route', () => {
    expect(routeOnFloor(floor, 'room-a', 'missing')).toBeNull();
    expect(routeOnFloor({ ...floor, connections: [] }, 'room-a', 'room-b')).toBeNull();
  });
});
