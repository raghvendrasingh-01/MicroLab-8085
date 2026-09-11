/**
 * Canvas geometry: turning pin definitions into pixel positions.
 *
 * Cards render pins down their left and right edges; groups alternate sides
 * (group 0 left, group 1 right, group 2 left below group 0, …). The canvas
 * stays generic — layout is computed from ComponentMeta + getPinDefs(), so a
 * new component type renders correctly with zero canvas changes.
 */
import type { ComponentMeta, Component } from '../../core/circuit';
import type { PinDir } from '../../core/types';

export const PIN_PITCH = 18;
export const GROUP_HEADER = 16;
export const HEADER_H = 26;
export const PAD_TOP = 32;
export const PAD_BOTTOM = 12;
export const PIN_R = 5;

export interface PinPos {
  pinId: string;
  label: string;
  side: 'left' | 'right';
  /** Component-relative coordinates of the pin dot (left pins x=0). */
  x: number;
  y: number;
}

export interface ComponentLayout {
  width: number;
  height: number;
  pins: Map<string, PinPos>;
  /** Group caption positions (component-relative). */
  captions: Array<{ name: string; side: 'left' | 'right'; x: number; y: number }>;
}

/**
 * Current card size: resizable components report their own; everything else
 * uses the registry default. The canvas, the fit-to-view and the layout all
 * agree on this one source of truth.
 */
export function sizeOf(c: Component, meta: ComponentMeta): { width: number; height: number } {
  const d = c.getDisplaySize?.();
  if (d) return { width: Math.round(d.width), height: Math.round(d.height) };
  return { width: meta.width, height: meta.height };
}

/** Layout is content-derived; cached per component instance + its size. */
const cache = new WeakMap<Component, { w: number; h: number; layout: ComponentLayout }>();

export function layoutOf(c: Component, meta: ComponentMeta): ComponentLayout {
  const size = sizeOf(c, meta);
  const hit = cache.get(c);
  if (hit && hit.w === size.width && hit.h === size.height) return hit.layout;

  const defs = c.getPinDefs();
  const groups: string[] = [];
  for (const d of defs) {
    const g = d.group ?? '';
    if (!groups.includes(g)) groups.push(g);
  }

  const pins = new Map<string, PinPos>();
  const captions: ComponentLayout['captions'] = [];
  const sideTotals: Record<'left' | 'right', number> = { left: 0, right: 0 };

  groups.forEach((g, gi) => {
    const side: 'left' | 'right' = gi % 2 === 0 ? 'left' : 'right';
    const x = side === 'left' ? 0 : size.width;
    let y = PAD_TOP + sideTotals[side];
    if (g) {
      captions.push({ name: g, side, x: side === 'left' ? 12 : size.width - 12, y });
      y += GROUP_HEADER;
    }
    for (const d of defs) {
      if ((d.group ?? '') !== g) continue;
      pins.set(d.id, { pinId: d.id, label: d.label, side, x, y });
      y += PIN_PITCH;
    }
    sideTotals[side] = y - PAD_TOP + 10; // gap between groups
  });

  const contentH = Math.max(sideTotals.left, sideTotals.right) + PAD_BOTTOM;
  const layout: ComponentLayout = {
    width: size.width,
    height: Math.max(size.height, Math.ceil(contentH)),
    pins,
    captions,
  };
  cache.set(c, { w: size.width, h: size.height, layout });
  return layout;
}

export function pinDirColor(dir: PinDir, digital: 0 | 1): string {
  if (dir === 'out') return digital ? 'var(--pin-out-hi)' : 'var(--pin-out)';
  return digital ? 'var(--pin-in-hi)' : 'var(--pin-in)';
}
