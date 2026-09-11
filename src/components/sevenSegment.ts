/**
 * Seven-segment display: one digit, 8 input pins (a–g + decimal point).
 *
 * Common-cathode by default (segment lights when its pin is 1). A
 * `commonAnode` property inverts the sense, like wiring the real display
 * with the common pin to VCC. Pure display device — pins are inputs, state
 * survives reset (it only reflects the wires).
 */
import type { Component, ComponentMeta, Pin, PinDef } from '../core/circuit';

export const SEGMENT_IDS = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'dp'] as const;
export type SegmentId = (typeof SEGMENT_IDS)[number];

const PIN_DEFS: PinDef[] = SEGMENT_IDS.map((s): PinDef => ({
  id: s,
  label: s.toUpperCase(),
  dir: 'in',
  group: 'Segments',
}));

/** Standard digit decode table, segment a..g — dp handled separately. */
export const DIGIT_SEGMENTS: Record<string, string> = {
  '0': 'abcdef',
  '1': 'bc',
  '2': 'abdeg',
  '3': 'abcdg',
  '4': 'bcfg',
  '5': 'acdfg',
  '6': 'acdefg',
  '7': 'abc',
  '8': 'abcdefg',
  '9': 'abcdfg',
  A: 'abcefg',
  b: 'cdefg',
  C: 'adef',
  d: 'bcdeg',
  E: 'adefg',
  F: 'aefg',
};

export class SevenSegment implements Component {
  readonly id: string;
  readonly type = 'sevenSegment';
  label: string;
  x: number;
  y: number;

  /** Common-anode display: segment lit when its pin is 0 instead of 1. */
  commonAnode = false;

  private readonly pins = new Map<string, Pin>();

  constructor(id: string, x: number, y: number) {
    this.id = id;
    this.label = '7-segment';
    this.x = x;
    this.y = y;
    for (const def of PIN_DEFS) this.pins.set(def.id, { ...def, digital: 0 });
  }

  getPinDefs(): PinDef[] {
    return [...PIN_DEFS];
  }

  getPinDir(_pinId: string): 'in' {
    return 'in';
  }

  getPin(pinId: string): Pin {
    const p = this.pins.get(pinId);
    if (!p) throw new Error(`7-segment ${this.label}: unknown pin ${pinId}`);
    return p;
  }

  onPinChange(_pinId: string): void {
    // Display only — the body re-reads pin levels on each render.
  }

  /** True when segment `id` is emitting light. */
  segmentLit(id: SegmentId): boolean {
    const level = this.getPin(id).digital === 1;
    return this.commonAnode ? !level : level;
  }

  /** 8-bit pattern on a..g,dp as a debugging/inspection value (a = bit 0). */
  segmentValue(): number {
    let v = 0;
    for (let i = 0; i < SEGMENT_IDS.length; i++) {
      if (this.segmentLit(SEGMENT_IDS[i]!)) v |= 1 << i;
    }
    return v;
  }

  tick(_tstates: number): void {
    // No internal timing.
  }

  reset(): void {
    // Reflects its wires; nothing of its own to reset.
  }

  getConfig() {
    return { commonAnode: this.commonAnode };
  }

  setConfig(cfg: Record<string, string | number | boolean>): void {
    if (typeof cfg.commonAnode === 'boolean') this.commonAnode = cfg.commonAnode;
  }

  getProperties() {
    return [
      {
        key: 'commonAnode',
        label: 'Common anode (inverted sense)',
        kind: 'boolean' as const,
      },
    ];
  }
}

export const SEVEN_SEGMENT_META: ComponentMeta = {
  type: 'sevenSegment',
  title: '7-segment display',
  short: 'One digit, segments a–g + dp',
  about:
    'A single seven-segment digit with segment inputs a, b, c, d, e, f, g and ' +
    'the decimal point. Wire all eight to one 8-bit output port (e.g. 8255 ' +
    'Port A) and OUT the segment pattern to display a digit — bit 0 = a, ' +
    'bit 1 = b, … bit 6 = g, bit 7 = dp. Common-cathode by default: a pin at ' +
    'logic 1 lights its segment. Enable "common anode" for displays whose ' +
    'common pin goes to VCC, which inverts the sense (0 lights the segment). ' +
    'Use DIGIT_SEGMENTS-style lookup tables in your program to convert a ' +
    'binary value to its segment pattern.',
  width: 200,
  height: 240,
  create: (id, x, y) => new SevenSegment(id, x, y),
};
