/**
 * procTextures.ts — procedural 3D surfaces (§6 of the v1.8 spec).
 *
 * One 256² canvas-generated "finish" texture shared by walls and roofs.
 * Isotropic noise + a very light vertical banding so the texture works under the
 * existing planar world-scaled UVs (0.05/m) without any geometry changes.
 * Values stay within ~±4% of white, so the per-vertex campus colors we multiply
 * by are preserved — the texture only adds grain, never re-paints buildings.
 *
 * A second radial-gradient texture grounds every building with a soft contact
 * shadow, replacing the floating-slab look on flat imagery.
 */
import * as THREE from 'three';

let cachedFinish: THREE.Texture | null = null;
let cachedShadow: THREE.Texture | null = null;

/** Near-white grain + faint storey banding, tileable. */
export function facadeTexture(): THREE.Texture | null {
  if (cachedFinish) return cachedFinish;
  if (typeof document === 'undefined') return null;
  const S = 256;
  const cvs = document.createElement('canvas');
  cvs.width = cvs.height = S;
  const ctx = cvs.getContext('2d');
  if (!ctx) return null;

  ctx.fillStyle = '#fbfaf7'; // ≈ white: multiplied vertex colors stay faithful
  ctx.fillRect(0, 0, S, S);

  // deterministic pseudo-random grain (no Math.random → stable bake every load)
  let seed = 1234567;
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 0xffffffff;
  };
  for (let i = 0; i < 5200; i++) {
    const g = 236 + Math.floor(rnd() * 19); // 236–255, ±4% luminance
    ctx.fillStyle = `rgb(${g},${g - 2},${g - 5})`;
    ctx.globalAlpha = 0.5;
    ctx.fillRect(Math.floor(rnd() * S), Math.floor(rnd() * S), 1 + Math.floor(rnd() * 2), 1 + Math.floor(rnd() * 2));
  }

  // faint horizontal banding: reads as course lines ± every texture repeat (~0.8 m)
  ctx.globalAlpha = 0.06;
  ctx.fillStyle = '#8d867c';
  for (let y = 0; y < S; y += 32) ctx.fillRect(0, y, S, 1);
  ctx.globalAlpha = 0.05;
  ctx.fillStyle = '#9b948a';
  for (let x = 0; x < S; x += 64) ctx.fillRect(x, 0, 1, S);
  ctx.globalAlpha = 1;

  const tex = new THREE.CanvasTexture(cvs);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  tex.colorSpace = THREE.SRGBColorSpace;
  cachedFinish = tex;
  return tex;
}

/** Soft radial blob for building contact shadows (black → transparent). */
export function contactShadowTexture(): THREE.Texture | null {
  if (cachedShadow) return cachedShadow;
  if (typeof document === 'undefined') return null;
  const S = 128;
  const cvs = document.createElement('canvas');
  cvs.width = cvs.height = S;
  const ctx = cvs.getContext('2d');
  if (!ctx) return null;
  const g = ctx.createRadialGradient(S / 2, S / 2, S * 0.05, S / 2, S / 2, S * 0.5);
  g.addColorStop(0, 'rgba(10,14,12,0.34)');
  g.addColorStop(0.55, 'rgba(10,14,12,0.20)');
  g.addColorStop(1, 'rgba(10,14,12,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  const tex = new THREE.CanvasTexture(cvs);
  tex.colorSpace = THREE.SRGBColorSpace;
  cachedShadow = tex;
  return tex;
}
