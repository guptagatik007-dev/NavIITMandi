/**
 * mergeEdits.ts — applies the live edit session on top of the loaded campus data.
 *
 * Same precedence as the files on disk: generated data < manual additions < manual
 * overrides. The in-app session is the "manual" layer while you work; exporting writes
 * it to public/data/manual/ so a reload produces an identical result.
 */
import type { CampusData, CampusBuilding } from './loaders';
import type { SearchDoc } from './search';
import type { BuildingOverride, ManualLabel } from './overrides';
import type { PendingBuilding } from '@/store/editStore';

export interface EditSession {
  saved: Record<string, BuildingOverride>;
  addedBuildings: PendingBuilding[];
  addedLabels: ManualLabel[];
}

const ANCHOR = { south: { lat: 31.77555, lng: 76.98654 }, north: { lat: 31.7813, lng: 76.9975 } };
const zoneOf = (lat: number, lng: number): 'north' | 'south' => {
  const d = (a: { lat: number; lng: number }) => Math.hypot(a.lat - lat, (a.lng - lng) * Math.cos((lat * Math.PI) / 180));
  return d(ANCHOR.south) <= d(ANCHOR.north) ? 'south' : 'north';
};

export function mergeEditSession(
  data: CampusData,
  searchIndex: SearchDoc[],
  session: EditSession,
): { data: CampusData; searchIndex: SearchDoc[]; byId: Map<string, CampusBuilding> } {
  const hasEdits = Object.keys(session.saved).length + session.addedBuildings.length + session.addedLabels.length > 0;
  if (!hasEdits) {
    return { data, searchIndex, byId: new Map(data.buildings.map((b) => [b.id, b])) };
  }

  // 1. added footprints
  const buildings: CampusBuilding[] = [...data.buildings];
  const newPois = [] as CampusData['pois'];
  for (const pending of session.addedBuildings) {
    if (buildings.some((b) => b.id === pending.properties.id)) continue;
    const p = pending.properties;
    const cLat = pending.ring.reduce((s, q) => s + q[1], 0) / pending.ring.length;
    const cLng = pending.ring.reduce((s, q) => s + q[0], 0) / pending.ring.length;
    buildings.push({
      id: p.id,
      name: p.name,
      named: true,
      cat: p.cat,
      area_m2: 0,
      scope: 'campus',
      src: `Manual footprint${p.verifiedBy ? ` — verified by ${p.verifiedBy}` : ''}`,
      conf: 'manual',
      floors: p.floors,
      f2f: p.f2f,
      roof: p.roof,
      pitch: p.pitch,
      wall: p.wall,
      height_m: Math.round((p.floors * p.f2f + 1) * 100) / 100,
      zone: zoneOf(cLat, cLng),
      name_conf: 'manual',
      cat_conf: 'manual',
      entrance_lat: p.entrance_lat ?? cLat,
      entrance_lng: p.entrance_lng ?? cLng,
      entrance_conf: 'manual',
      manual: true,
      ring: pending.ring,
    });
    newPois.push({
      id: `poi-${p.id}`,
      name: p.name,
      kind: 'building',
      cat: p.cat,
      lat: p.entrance_lat ?? cLat,
      lng: p.entrance_lng ?? cLng,
      aliases: [p.name.toLowerCase()],
      building_id: p.id,
      conf: 'manual',
      src: 'Manual footprint',
    });
  }

  // 2. overrides (session wins over file overrides)
  const overrides = new Map<string, BuildingOverride>(data.overrides);
  const merged0 = buildings.map((b) => {
    const ov = session.saved[b.id];
    if (!ov) return b;
    overrides.set(b.id, { ...(overrides.get(b.id) ?? {}), ...ov });
    const next: CampusBuilding = { ...b };
    if (ov.name !== undefined) next.name = ov.name;
    if (ov.cat !== undefined) next.cat = ov.cat;
    if (ov.floors !== undefined) next.floors = ov.floors;
    if (ov.height_m !== undefined) next.height_m = ov.height_m;
    else if (ov.floors !== undefined) next.height_m = Math.round((ov.floors * next.f2f + 1) * 100) / 100;
    if (ov.roof !== undefined) next.roof = ov.roof;
    if (ov.pitch !== undefined) next.pitch = ov.pitch;
    if (ov.wall !== undefined) next.wall = ov.wall;
    if (ov.ring !== undefined && ov.ring.length >= 4) next.ring = ov.ring;
    if (ov.entrance_lat != null && ov.entrance_lng != null) {
      next.entrance_lat = ov.entrance_lat;
      next.entrance_lng = ov.entrance_lng;
      next.entrance_conf = 'manual';
    }
    if (ov.labelAt != null) next.labelAt = ov.labelAt;
    next.overridden = true;
    next.hidden = Boolean(ov.hidden);
    next.conf = 'manual';
    if (ov.labelHidden) next.name_conf = 'manual-hidden';
    return next;
  });
  // Keep hidden buildings in the runtime data. The scene/map filter them, while the
  // editor still lists them so "Show building" and Revert remain possible after a save.
  const buildings2 = merged0;

  // 3. POIs follow the corrected names/positions
  const pois = [...data.pois, ...newPois].map((p) => {
    const ov = p.building_id ? session.saved[p.building_id] : undefined;
    const b = p.building_id ? buildings2.find((x) => x.id === p.building_id) : undefined;
    if (!ov && !b) return p;
    return {
      ...p,
      ...(ov?.name ? { name: ov.name } : {}),
      ...(ov?.cat ? { cat: ov.cat } : {}),
      ...(b?.entrance_lat != null
        ? { lat: b.entrance_lat, lng: b.entrance_lng ?? p.lng }
        : b?.labelAt != null
          ? { lat: b.labelAt[1], lng: b.labelAt[0] }
          : {}),
    };
  });

  const hiddenBuildingIds = new Set(
    buildings2.filter((b) => b.hidden || session.saved[b.id]?.hidden || data.overrides.get(b.id)?.hidden).map((b) => b.id),
  );
  const visiblePois = pois.filter((p) => !p.building_id || !hiddenBuildingIds.has(p.building_id));

  // 4. labels
  const manualLabels = [...data.manualLabels, ...session.addedLabels];

  // 5. search index: refresh entries for edited/added buildings
  const renamed = new Set([...Object.keys(session.saved), ...session.addedBuildings.map((b) => b.properties.id)]);
  const index = searchIndex.map((doc) => {
    const bid = doc.buildingId ?? doc.id.replace(/^b-/, '');
    const b = renamed.has(bid) ? buildings2.find((x) => x.id === bid) : undefined;
    if (!b) return doc;
    const tokens = new Set(b.name.toLowerCase().split(/\s+/).filter(Boolean));
    tokens.add(b.cat);
    return { ...doc, title: b.name, cat: b.cat, tokens: [...tokens] };
  });
  for (const b of buildings2) {
    if (!renamed.has(b.id)) continue;
    if (index.some((d) => d.buildingId === b.id)) continue;
    index.push({
      id: `b-${b.id}`,
      title: b.name,
      subtitle: b.cat,
      cat: b.cat,
      lat: Number.NaN,
      lng: Number.NaN,
      buildingId: b.id,
      tokens: b.name.toLowerCase().split(/\s+/).filter(Boolean).concat(b.cat),
      conf: 'manual',
    });
  }

  return {
    data: { ...data, buildings: buildings2, pois: visiblePois, manualLabels, overrides },
    searchIndex: index,
    byId: new Map(buildings2.map((b) => [b.id, b])),
  };
}
