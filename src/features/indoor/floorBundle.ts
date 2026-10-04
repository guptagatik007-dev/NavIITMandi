/**
 * floorBundle.ts — share COMPLETE floor work between teammates.
 *
 * A floor bundle carries everything one teammate did on floors of one building:
 * floor metadata, labels, connections, rooms, plan-image metadata AND the image
 * pixels themselves (base64) — so the integrator receives not just marks but the
 * actual uploaded plans, and per-floor sub-assignments ("you do floor 1, I do
 * floor 2") merge label-by-label.
 *
 * Merge rules are the team's "integrator chooses" policy made deterministic:
 *   - floors whose label the integrator does not have are adopted whole
 *   - same-label floors fill gaps only (labels/connections/rooms/images the
 *     integrator lacks are added; existing items are NEVER replaced)
 *   - images reuse their IndexedDB key; name/space follows the OUTDOOR building
 *     name at install time, so a renamed building renames all its floors too
 */
import { z } from 'zod';
import type { IndoorBuilding, IndoorFloor } from '@/store/indoorStore';
import { loadPlanImage, savePlanImage } from './indoorImagesDb';

export const FLOOR_BUNDLE_VERSION = 1;

const BundleImageSchema = z.object({
  key: z.string().min(1),
  mime: z.string().min(3),
  dataUrl: z.string().startsWith('data:'),
});

const BundleFloorSchema = z.object({
  floor: z.record(z.unknown()),
  images: z.array(BundleImageSchema).default([]),
});

export const FloorBundleSchema = z.object({
  app: z.literal('iitmandi-nav-floor-bundle'),
  version: z.number().int().min(1).max(FLOOR_BUNDLE_VERSION),
  author: z.string().default('unknown teammate'),
  exportedAt: z.string().optional(),
  buildingId: z.string().min(1),
  buildingName: z.string().min(1),
  origin: z.object({ lat: z.number(), lng: z.number(), rotationDeg: z.number() }),
  floors: z.array(BundleFloorSchema).min(1),
});

export type FloorBundle = z.infer<typeof FloorBundleSchema>;

async function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result));
    fr.onerror = () => reject(new Error('could not read image bytes'));
    fr.readAsDataURL(blob);
  });
}

async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  const res = await fetch(dataUrl);
  return res.blob();
}

/** Pack the given floors (with every gallery image's pixels) into bundle JSON. */
export async function buildFloorBundle(
  building: Pick<IndoorBuilding, 'id' | 'name' | 'origin'>,
  floors: IndoorFloor[],
  author: string,
): Promise<{ text: string; embeddedImages: number; skippedImages: string[] }> {
  const skippedImages: string[] = [];
  let embeddedImages = 0;
  const packed = [] as FloorBundle['floors'];
  for (const floor of floors) {
    const images: z.infer<typeof BundleImageSchema>[] = [];
    // legacy single-dataURL underlay travels inline
    if (floor.planImageDataUrl) {
      images.push({ key: `legacy-${floor.id}`, mime: floor.planMime ?? 'image/png', dataUrl: floor.planImageDataUrl });
      embeddedImages++;
    }
    for (const img of floor.planImages ?? []) {
      try {
        const blob = await loadPlanImage(img.key);
        if (!blob) {
          skippedImages.push(img.name);
          continue;
        }
        images.push({ key: img.key, mime: img.mime, dataUrl: await blobToDataUrl(blob) });
        embeddedImages++;
      } catch {
        skippedImages.push(img.name);
      }
    }
    packed.push({ floor: stripDataUrls(floor) as unknown as Record<string, unknown>, images });
  }
  const bundle: FloorBundle = {
    app: 'iitmandi-nav-floor-bundle',
    version: FLOOR_BUNDLE_VERSION,
    author: author.trim() || 'unknown teammate',
    exportedAt: new Date().toISOString(),
    buildingId: building.id,
    buildingName: building.name,
    origin: building.origin,
    floors: packed,
  };
  return { text: JSON.stringify(bundle, null, 2), embeddedImages, skippedImages };
}

/** The floor travels without its local data URL — images ride in the images[] array. */
function stripDataUrls(floor: IndoorFloor): IndoorFloor {
  const { planImageDataUrl, ...rest } = floor;
  void planImageDataUrl;
  return rest;
}

/**
 * Install a received bundle: image bytes go into IndexedDB (falling back to the
 * legacy data-URL field when IDB is unavailable), floors arrive ready for the
 * store's gap-filling merge.
 */
export async function installFloorBundle(
  bundle: FloorBundle,
): Promise<{ floors: IndoorFloor[]; storedImages: number; legacyImages: number }> {
  let storedImages = 0;
  let legacyImages = 0;
  const floors: IndoorFloor[] = [];
  for (const packed of bundle.floors) {
    const floor = packed.floor as unknown as IndoorFloor;
    const gallery = [...(floor.planImages ?? [])];
    for (const img of packed.images) {
      try {
        const blob = await dataUrlToBlob(img.dataUrl);
        const ok = await savePlanImage(img.key, blob);
        if (ok) {
          storedImages++;
          // legacy single image keys become gallery entries
          if (img.key.startsWith('legacy-') && !gallery.some((g) => g.key === img.key)) {
            gallery.push({ id: img.key, key: img.key, name: `${floor.label} plan`, mime: img.mime, width: floor.planWidth, height: floor.planHeight });
          }
          continue;
        }
      } catch {
        /* fall through to legacy */
      }
      // IDB unavailable: keep the first image inline as a legacy data URL
      if (!floor.planImageDataUrl) {
        floor.planImageDataUrl = img.dataUrl;
        floor.planMime = img.mime;
        legacyImages++;
      }
    }
    floor.planImages = gallery;
    if (!floor.activePlanImageId) floor.activePlanImageId = gallery[0]?.id;
    floors.push(floor);
  }
  return { floors, storedImages, legacyImages };
}
