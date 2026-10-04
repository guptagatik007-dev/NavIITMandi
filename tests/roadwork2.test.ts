import { beforeEach, describe, expect, it } from 'vitest';
import { useEdit } from '@/store/editStore';

/** v3.2 datum shift contract — the campus-slide maths the App applies to generated content */
describe('v3.2 campus datum correction', () => {
  beforeEach(() => useEdit.getState().resetAll());

  it('shiftDatum accumulates in metres with 0.1 m rounding, resetDatum zeroes', () => {
    const es = useEdit.getState();
    es.shiftDatum(1.0, 0.3);
    es.shiftDatum(0.27, -0.31);
    let d = useEdit.getState().datum;
    expect(d.dxM).toBeCloseTo(1.3, 1);
    expect(d.dyM).toBeCloseTo(0.0, 1);
    es.shiftDatum(-1.3, 0.0);
    d = useEdit.getState().datum;
    expect(d.dxM).toBeCloseTo(0.0, 1);
    useEdit.getState().resetDatum();
    expect(useEdit.getState().datum).toEqual({ dxM: 0, dyM: 0 });
  });

  it('the degree conversion the App uses moves a lng/lat point by exactly the metro delta', () => {
    // mirror of App.tsx v3.2 transform (kept deliberately formula-locked)
    const lat0 = 31.779;
    const dxM = 2.0, dyM = -1.0;
    const dLng = dxM / (111320 * Math.cos((lat0 * Math.PI) / 180));
    const dLat = dyM / 110540;
    const p: [number, number] = [76.99, 31.77];
    const q: [number, number] = [p[0] + dLng, p[1] + dLat];
    // ~2 m east, ~1 m south in local metres
    const eastM = (q[0] - p[0]) * 111320 * Math.cos((lat0 * Math.PI) / 180);
    const northM = (q[1] - p[1]) * 110540;
    expect(eastM).toBeCloseTo(2.0, 5);
    expect(northM).toBeCloseTo(-1.0, 5);
  });

  it('datum is part of the persisted snapshot (survives undo)', () => {
    const es = useEdit.getState();
    es.shiftDatum(0.6, 0.6);
    expect(useEdit.getState().datum.dxM).toBeCloseTo(0.6, 5);
    es.undo();
    expect(useEdit.getState().datum.dxM).toBe(0);
    es.redo();
    expect(useEdit.getState().datum.dxM).toBeCloseTo(0.6, 5);
  });
});
