/**
 * ADC0808: 8-channel, 8-bit successive-approximation A/D converter.
 *
 * Real-hardware behavior modeled:
 *  - 8 analog inputs IN0–IN7; ADD A/B/C select the channel (A = LSB),
 *    latched by a rising edge on ALE.
 *  - A rising edge on START begins a conversion — and restarts one already
 *    in progress, like the real chip.
 *  - EOC (output) is high when idle, low while converting, high again when
 *    the result is latched.
 *  - D0–D7 are tristate data outputs, enabled while OE is high.
 *
 * Documented simplifications:
 *  - Conversion takes 64 cycles of an internal ~500 kHz clock derived from
 *    CPU T-states; the real chip needs an external clock on its CLK pin.
 *  - OE is strapped high on this module (starts at 1), so the data pins work
 *    unwired — drive OE low through a wire to gate them.
 *  - Until the first ALE pulse, the channel select follows the ADD pins
 *    live; the real chip's unlatched state is undefined.
 */
import type { Component, ComponentMeta, Pin, PinDef } from '../core/circuit';

/** T-states per internal ADC clock cycle (~500 kHz from a ~3 MHz system). */
export const ADC_CLOCK_TSTATES = 6;
/** Internal clock cycles per conversion (successive approximation). */
export const CONVERSION_CLOCKS = 64;

const PIN_DEFS: PinDef[] = [
  ...Array.from({ length: 8 }, (_, i): PinDef => ({
    id: `IN${i}`,
    label: `IN${i}`,
    dir: 'in',
    group: 'Analog in',
  })),
  { id: 'ADDA', label: 'ADD A', dir: 'in', group: 'Control' },
  { id: 'ADDB', label: 'ADD B', dir: 'in', group: 'Control' },
  { id: 'ADDC', label: 'ADD C', dir: 'in', group: 'Control' },
  { id: 'ALE', label: 'ALE', dir: 'in', group: 'Control' },
  { id: 'START', label: 'START', dir: 'in', group: 'Control' },
  { id: 'OE', label: 'OE', dir: 'in', group: 'Control' },
  { id: 'EOC', label: 'EOC', dir: 'out', group: 'Status' },
  ...Array.from({ length: 8 }, (_, i): PinDef => ({
    id: `D${i}`,
    label: `D${i}`,
    dir: 'io',
    group: 'Data out',
  })),
];

export class Adc0808 implements Component {
  readonly id: string;
  readonly type = 'adc0808';
  label: string;
  x: number;
  y: number;

  /** Reference voltage Vref+ (V), inspector-adjustable. */
  vref = 5;

  private readonly pins = new Map<string, Pin>();
  private latchedChannel = 0;
  private aleEverLatched = false;
  private converting = false;
  private clockTstates = 0;
  private convClocks = 0;
  private vinSampled = 0;
  private resultValue = 0;
  private lastAle: 0 | 1 = 0;
  private lastStart: 0 | 1 = 0;

  constructor(id: string, x: number, y: number) {
    this.id = id;
    this.label = 'ADC0808';
    this.x = x;
    this.y = y;
    for (const def of PIN_DEFS) this.pins.set(def.id, { ...def, digital: 0 });
    this.pins.get('OE')!.digital = 1; // strapped high on this module
    this.pins.get('EOC')!.digital = 1; // idle: no conversion in progress
  }

  getPinDefs(): PinDef[] {
    return [...PIN_DEFS];
  }

  getPinDir(pinId: string): 'in' | 'out' {
    const def = this.pins.get(pinId);
    if (!def) return 'in';
    if (def.dir === 'io') return this.pins.get('OE')!.digital === 1 ? 'out' : 'in';
    return def.dir;
  }

  getPin(pinId: string): Pin {
    const p = this.pins.get(pinId);
    if (!p) throw new Error(`ADC0808 ${this.label}: unknown pin ${pinId}`);
    return p;
  }

  onPinChange(pinId: string): void {
    if (pinId === 'ALE') {
      const now = this.pins.get('ALE')!.digital;
      if (now === 1 && this.lastAle === 0) {
        this.latchedChannel = this.readAdd();
        this.aleEverLatched = true;
      }
      this.lastAle = now;
    } else if (pinId === 'START') {
      const now = this.pins.get('START')!.digital;
      if (now === 1 && this.lastStart === 0) this.beginConversion();
      this.lastStart = now;
    } else if (pinId === 'OE') {
      // Leaving tristate: re-drive the pins from the output latch. (While
      // OE was low the net was pulled to 0 — the latch itself survives.)
      if (this.pins.get('OE')!.digital === 1) this.driveDataPins();
    }
  }

  /* ---------------- views for the body / tests ---------------- */

  /** Channel currently selected (latched by ALE, or live ADD pins). */
  channel(): number {
    return this.aleEverLatched ? this.latchedChannel : this.readAdd();
  }

  isConverting(): boolean {
    return this.converting;
  }

  /** Conversion progress 0..1 (for the body's progress bar). */
  progress(): number {
    return this.converting ? this.convClocks / CONVERSION_CLOCKS : 1;
  }

  /** Last completed conversion (0–255). */
  lastResult(): number {
    return this.resultValue;
  }

  /** Voltage captured at the last START, in volts. */
  sampledVolts(): number {
    return this.vinSampled;
  }

  /** Live voltage on the currently selected channel, in volts. */
  channelVolts(): number {
    return this.pins.get(`IN${this.channel()}`)?.analog ?? 0;
  }

  isEoc(): boolean {
    return this.pins.get('EOC')!.digital === 1;
  }

  /* ---------------- conversion ---------------- */

  private readAdd(): number {
    return (
      (this.pins.get('ADDA')!.digital) |
      (this.pins.get('ADDB')!.digital << 1) |
      (this.pins.get('ADDC')!.digital << 2)
    );
  }

  private beginConversion(): void {
    this.converting = true;
    this.convClocks = 0;
    this.clockTstates = 0;
    this.vinSampled = this.channelVolts();
    this.pins.get('EOC')!.digital = 0;
  }

  private finishConversion(): void {
    this.converting = false;
    const vref = Math.max(0.1, this.vref);
    const v = Math.max(0, Math.min(vref, this.vinSampled));
    this.resultValue = Math.min(255, Math.floor((v / vref) * 256));
    this.driveDataPins();
    this.pins.get('EOC')!.digital = 1;
  }

  /** D0–D7 from the result latch (the tristate buffer's input side). */
  private driveDataPins(): void {
    for (let i = 0; i < 8; i++) {
      this.pins.get(`D${i}`)!.digital = ((this.resultValue >> i) & 1) as 0 | 1;
    }
  }

  tick(tstates: number): void {
    if (!this.converting) return;
    this.clockTstates += tstates;
    while (this.converting && this.clockTstates >= ADC_CLOCK_TSTATES) {
      this.clockTstates -= ADC_CLOCK_TSTATES;
      this.convClocks++;
      if (this.convClocks >= CONVERSION_CLOCKS) this.finishConversion();
    }
  }

  /* ---------------- lifecycle ---------------- */

  reset(): void {
    this.converting = false;
    this.convClocks = 0;
    this.clockTstates = 0;
    this.resultValue = 0;
    this.vinSampled = 0;
    this.latchedChannel = 0;
    this.aleEverLatched = false;
    this.lastAle = 0;
    this.lastStart = 0;
    for (let i = 0; i < 8; i++) this.pins.get(`D${i}`)!.digital = 0;
    this.pins.get('EOC')!.digital = 1;
    this.pins.get('OE')!.digital = 1; // restore the strap (wires re-drive)
  }

  getConfig() {
    return { vref: this.vref };
  }

  setConfig(cfg: Record<string, string | number | boolean>): void {
    if (typeof cfg.vref === 'number') {
      this.vref = Math.max(0.1, Math.min(5, cfg.vref));
    }
  }

  getProperties() {
    return [{ key: 'vref', label: 'Vref+ (V)', kind: 'number' as const, min: 0.1, max: 5 }];
  }
}

export const ADC0808_META: ComponentMeta = {
  type: 'adc0808',
  title: 'ADC0808',
  short: '8-channel 8-bit A/D converter',
  about:
    'An 8-channel, 8-bit successive-approximation A/D converter. Select a ' +
    'channel with ADD A/B/C (latched by a rising edge on ALE), pulse START ' +
    'high, wait until EOC goes high, then enable OE to read the result on ' +
    'D0–D7 (typically into an 8255 port configured as input). One LSB = ' +
    'Vref+/256. Conversion takes 64 cycles of the internal ~500 kHz clock ' +
    '(derived from CPU T-states — the real chip needs an external clock). ' +
    'OE is strapped high on this module, so the data pins work unwired; ' +
    'drive OE low to tristate them.',
  width: 330,
  height: 380,
  create: (id, x, y) => new Adc0808(id, x, y),
};
