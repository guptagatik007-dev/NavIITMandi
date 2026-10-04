/**
 * search.ts — small, dependency-free fuzzy search over POIs and buildings.
 * Campus queries are short and spoken ("mess", "A18", "dispensary"), so the scorer is
 * tuned for aliases and prefixes rather than for typo-heavy English.
 */
import type { PoiT } from './schemas';

export interface SearchDoc {
  id: string;
  title: string;
  subtitle: string;
  cat: string;
  lat: number;
  lng: number;
  buildingId?: string | null;
  tokens: string[];
  conf: string;
}

/** Spoken-language synonyms — students rarely say the official names. */
const SYNONYMS: Record<string, string[]> = {
  food: ['dining', 'canteen', 'cafe', 'restaurant', 'mess'],
  mess: ['dining', 'canteen'],
  khana: ['dining', 'mess', 'canteen'],
  washroom: ['utility', 'toilets'],
  toilet: ['utility', 'toilets'],
  loo: ['utility', 'toilets'],
  atm: ['commerce'],
  bank: ['commerce'],
  money: ['commerce', 'atm'],
  doctor: ['medical', 'hospital', 'health'],
  hospital: ['medical', 'health'],
  sick: ['medical', 'hospital'],
  medicine: ['medical', 'pharmacy'],
  library: ['library', 'reading'],
  padhai: ['library', 'academic'],
  study: ['library', 'academic'],
  class: ['academic', 'lecture'],
  lecture: ['academic'],
  seminar: ['auditorium', 'academic'],
  hostel: ['hostel', 'residential'],
  room: ['hostel'],
  stay: ['guesthouse', 'hostel'],
  guest: ['guesthouse'],
  sports: ['sports', 'gym'],
  gym: ['sports'],
  swim: ['sports'],
  ground: ['sports'],
  temple: ['worship'],
  mandir: ['worship'],
  gate: ['gate'],
  entry: ['gate'],
  bus: ['transport'],
  parking: ['parking'],
  shop: ['commerce'],
};

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9αβγδ ]+/g, ' ').replace(/\s+/g, ' ').trim();

export function buildIndex(pois: PoiT[], buildingNames: { id: string; name: string; cat: string }[]): SearchDoc[] {
  const docs: SearchDoc[] = [];
  for (const p of pois) {
    const tokens = new Set<string>(norm(p.name).split(' '));
    for (const a of p.aliases ?? []) for (const t of norm(a).split(' ')) if (t) tokens.add(t);
    tokens.add(norm(p.cat));
    docs.push({
      id: p.id,
      title: p.name,
      subtitle: SUBTITLES[p.cat] ?? p.cat,
      cat: p.cat,
      lat: p.lat,
      lng: p.lng,
      buildingId: p.building_id ?? null,
      tokens: [...tokens].filter(Boolean),
      conf: p.conf,
    });
  }
  const seen = new Set(docs.map((d) => norm(d.title)));
  for (const b of buildingNames) {
    if (seen.has(norm(b.name))) continue;
    const tokens = norm(b.name).split(' ');
    tokens.push(norm(b.cat));
    docs.push({
      id: `b-${b.id}`,
      title: b.name,
      subtitle: SUBTITLES[b.cat] ?? b.cat,
      cat: b.cat,
      lat: NaN,
      lng: NaN,
      buildingId: b.id,
      tokens: tokens.filter(Boolean),
      conf: 'derived',
    });
  }
  return docs;
}

export const SUBTITLES: Record<string, string> = {
  hostel: 'Hostel', dining: 'Dining', library: 'Library', auditorium: 'Auditorium',
  sports: 'Sports', medical: 'Medical', lab: 'Laboratory / workshop', academic: 'Academic',
  admin: 'Administration', residential: 'Residential', school: 'School', worship: 'Place of worship',
  gate: 'Gate', parking: 'Parking', commerce: 'Shops & banking', utility: 'Facility',
  academic_building: 'Academic block', transport: 'Transport', guesthouse: 'Guest house',
  cafe: 'Café', restaurant: 'Restaurant', bank: 'Bank', atm: 'ATM', hospital: 'Hospital',
  doctors: 'Health centre', college: 'Campus', fuel: 'Fuel', conference_centre: 'Auditorium',
  hostel_block: 'Hostel', man_made: 'Structure',
};

export interface SearchHit extends SearchDoc {
  score: number;
  matched: string;
}

export function search(docs: SearchDoc[], rawQuery: string, limit = 12): SearchHit[] {
  const q = norm(rawQuery);
  if (q.length < 2) return [];
  const terms = [q, ...q.split(' ')];
  const expand = new Set<string>();
  for (const t of terms) {
    expand.add(t);
    for (const s of SYNONYMS[t] ?? []) expand.add(s);
  }
  const hits: SearchHit[] = [];
  for (const d of docs) {
    const title = norm(d.title);
    let score = 0;
    let matched = '';
    if (title === q) score += 120;
    if (title.startsWith(q)) score += 70;
    if (title.includes(q)) score += 42;
    for (const t of expand) {
      if (t.length < 2) continue;
      for (const tok of d.tokens) {
        if (tok === t) { score += 26; matched ||= tok; }
        else if (tok.startsWith(t)) { score += 16; matched ||= tok; }
        else if (t.length > 3 && tok.includes(t)) { score += 8; matched ||= tok; }
      }
    }
    if (score > 0) {
      if (d.conf === 'osm') score += 4;
      hits.push({ ...d, score, matched });
    }
  }
  return hits.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title)).slice(0, limit);
}
