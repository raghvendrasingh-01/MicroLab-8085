/**
 * DAC0808: 8-bit digital-to-analog converter.
 *
 * Real-hardware behavior modeled:
 *  - 8 digital inputs D0–D7 (D0 = LSB); the output is the weighted sum,
 *    one LSB = Vref/256.
 *  - Like the real chip, code 255 gives 255/256 × Vref (≈4.98 V at 5 V) —
 *    full scale is one LSB short of Vref.
 *
 * Documented simplifications:
 *  - The real DAC0808 outputs a current (Iout) and needs an external
 *    op-amp to turn it into a voltage. This module includes that I-to-V
 *    converter, so OUT is a 0…Vref voltage directly.
 *  - Settling is instant at T-state granularity (real part: ~100 ns).
 *  - Power/ground pins are implied; only the signal pins are modeled.
 */
import type { Component, ComponentMeta, Pin, PinDef } from '../core/circuit';

const PIN_DEFS: PinDef[] = [
  ...Array.from({ length: 8 }, (_, i): PinDef => ({
    id: `D${i}`,
    label: `D${i}`,
    dir: 'in',
    group: 'Digital in',
  })),
  { id: 'OUT', label: 'OUT', dir: 'out', group: 'Analog out' },
];

export class Dac0808 implements Component {
  readonly id: string;
  readonly type = 'dac0808';
  label: string;
  x: number;
  y: number;

  /** Full-scale reference voltage (V), inspector-adjustable. */
  vref = 5;

  private readonly pins = new Map<string, Pin>();
  private byteValue = 0;

  constructor(id: string, x: number, y: number) {
    this.id = id;
    this.label = 'DAC0808';
    this.x = x;
    this.y = y;
    for (const def of PIN_DEFS) this.pins.set(def.id, { ...def, digital: 0 });
    this.pins.get('OUT')!.analog = 0;
  }

  getPinDefs(): PinDef[] {
    return [...PIN_DEFS];
  }

  getPinDir(pinId: string): 'in' | 'out' {
    return this.pins.get(pinId)?.dir === 'out' ? 'out' : 'in';
  }

  getPin(pinId: string): Pin {
    const p = this.pins.get(pinId);
    if (!p) throw new Error(`DAC0808 ${this.label}: unknown pin ${pinId}`);
    return p;
  }

  onPinChange(pinId: string): void {
    // Any change on the digital inputs re-derives the analog output. (When
    // eight wires update one pass at a time the byte ripples through
    // intermediate values for an instant — real hardware does this too.)
    if (pinId.startsWith('D')) this.recompute();
  }

  /* ---------------- views for the body / tests ---------------- */

  /** Digital code currently on D0–D7. */
  outputByte(): number {
    return this.byteValue;
  }

  /** Analog output voltage right now, in volts. */
  outputVolts(): number {
    return (this.byteValue / 256) * this.vref;
  }

  /** One LSB in volts (Vref/256) — the resolution of the converter. */
  lsbVolts(): number {
    return this.vref / 256;
  }

  private recompute(): void {
    let byte = 0;
    for (let i = 0; i < 8; i++) byte |= this.pins.get(`D${i}`)!.digital << i;
    this.byteValue = byte;
    const out = this.pins.get('OUT')!;
    out.analog = (byte / 256) * this.vref;
    out.digital = (out.analog >= 2.5 ? 1 : 0) as 0 | 1;
  }

  /* ---------------- lifecycle ---------------- */

  tick(_tstates: number): void {
    // No internal timing — settling is instant.
  }

  reset(): void {
    this.byteValue = 0;
    const out = this.pins.get('OUT')!;
    out.analog = 0;
    out.digital = 0;
  }

  getConfig() {
    return { vref: this.vref };
  }

  setConfig(cfg: Record<string, string | number | boolean>): void {
    if (typeof cfg.vref === 'number') {
      this.vref = Math.max(0.1, Math.min(5, cfg.vref));
      this.recompute(); // full scale changes → re-derive the output
    }
  }

  getProperties() {
    return [{ key: 'vref', label: 'Vref (V)', kind: 'number' as const, min: 0.1, max: 5 }];
  }
}

export const DAC0808_META: ComponentMeta = {
  type: 'dac0808',
  title: 'DAC0808',
  short: '8-bit D/A converter',
  about:
    'An 8-bit digital-to-analog converter. Wire D0–D7 to an 8-bit output port ' +
    '(e.g. 8255 Port A) and every OUT instruction updates the analog output: ' +
    'Vout = code/256 × Vref, one LSB = Vref/256. Code 255 gives 255/256 × Vref ' +
    '(≈4.98 V at Vref 5 V) — the real chip is also one LSB short of full ' +
    'scale. The real DAC0808 outputs a current and needs an external op-amp; ' +
    'this module includes that converter, so OUT is a voltage directly. ' +
    'Wire OUT to the Oscilloscope to watch waveforms — a program stepping ' +
    'the code 0→255 draws the classic DAC staircase.',
  width: 300,
  height: 240,
  create: (id, x, y) => new Dac0808(id, x, y),
};
