/**
 * Intel 8255 Programmable Peripheral Interface (educational model).
 *
 * Fully implemented:
 *  - Mode 0 (basic input/output) for all three ports
 *  - Bit Set/Reset (BSR) writes to port C (control word D7=0)
 *
 * Not implemented (reported clearly, never faked):
 *  - Mode 1 (strobed I/O) and Mode 2 (bidirectional port A). Writing a control
 *    word that selects them records a warning (shown in the console panel)
 *    and the ports continue to run as Mode 0. See docs/8255.md.
 *
 * Pin model: PA0–PA7, PB0–PB7, PC0–PC7 are individually wire-able pins.
 * Writing an output port drives its pins; reading an input port returns the
 * pin states (driven over wires by e.g. DIP switches). Writing to an
 * input-configured port updates the internal latch only — the value appears
 * on the pins if the direction is later switched to output, which mirrors
 * how trainers pre-load output data.
 */
import type { ComponentMeta, Peripheral, Pin, PinDef, PinDir } from '../core/circuit';

type Dir = 'in' | 'out';

const GROUPS: Array<{ prefix: 'PA' | 'PB' | 'PC'; group: string }> = [
  { prefix: 'PA', group: 'Port A' },
  { prefix: 'PB', group: 'Port B' },
  { prefix: 'PC', group: 'Port C' },
];

const PIN_DEFS: PinDef[] = GROUPS.flatMap(({ prefix, group }) =>
  Array.from({ length: 8 }, (_, i): PinDef => ({
    id: `${prefix}${i}`,
    label: `${prefix}${i}`,
    dir: 'io',
    group,
  })),
);

/** Power-on / reset control word: Mode 0, all ports input. */
export const CW_ALL_INPUT = 0x9b;

export class I8255 implements Peripheral {
  readonly id: string;
  readonly type = 'i8255';
  label: string;
  x: number;
  y: number;
  baseAddress: number;
  readonly addressCount = 4;

  /** Output data registers — what the CPU last wrote (per real 8255 ODR). */
  private latchA = 0x00;
  private latchB = 0x00;
  private latchC = 0x00;
  /** Last control word written (readable back at base+3). */
  controlWord = CW_ALL_INPUT;

  /** Effective direction of each port group, from the control word. */
  dirA: Dir = 'in';
  dirB: Dir = 'in';
  dirCUpper: Dir = 'in'; // PC4–PC7
  dirCLower: Dir = 'in'; // PC0–PC3

  /** True when the current control word selects unsupported Mode 1/2. */
  modeUnsupported = false;
  /** Set when a control word write selects Mode 1/2 — shown in the console. */
  lastWarning: string | null = null;

  private readonly pins = new Map<string, Pin>();

  constructor(id: string, x: number, y: number, baseAddress = 0x80) {
    this.id = id;
    this.label = '8255 PPI';
    this.x = x;
    this.y = y;
    this.baseAddress = baseAddress;
    for (const def of PIN_DEFS) {
      this.pins.set(def.id, { ...def, digital: 0 });
    }
    this.applyModeWord(CW_ALL_INPUT);
  }

  /* ---------------- I/O bus interface ---------------- */

  ioRead(addr: number): number {
    switch (((addr - this.baseAddress) & 0xff) as 0 | 1 | 2 | 3) {
      case 0:
        return this.dirA === 'in' ? this.readPins('PA') : this.latchA;
      case 1:
        return this.dirB === 'in' ? this.readPins('PB') : this.latchB;
      case 2:
        return this.readPortC();
      case 3:
        return this.controlWord;
      default:
        return 0xff;
    }
  }

  ioWrite(addr: number, value: number): void {
    const v = value & 0xff;
    switch (((addr - this.baseAddress) & 0xff) as 0 | 1 | 2 | 3) {
      case 0:
        this.latchA = v;
        if (this.dirA === 'out') this.drivePins('PA', v);
        break;
      case 1:
        this.latchB = v;
        if (this.dirB === 'out') this.drivePins('PB', v);
        break;
      case 2:
        this.latchC = v;
        this.drivePortCOutputs();
        break;
      case 3:
        this.writeControl(v);
        break;
      default:
        break;
    }
  }

  describeAddress(off: number): string {
    switch (off) {
      case 0: return 'Port A';
      case 1: return 'Port B';
      case 2: return 'Port C';
      case 3: return 'Control register';
      default: return '?';
    }
  }

  /* ---------------- control word ---------------- */

  private writeControl(w: number): void {
    if ((w & 0x80) === 0) {
      // BSR: set/reset one bit of port C's output latch.
      const bit = (w >> 1) & 0x07;
      const mask = 1 << bit;
      if (w & 0x01) this.latchC |= mask;
      else this.latchC &= ~mask & 0xff;
      this.drivePortCOutputs();
      return;
    }
    this.applyModeWord(w);
  }

  private applyModeWord(w: number): void {
    this.controlWord = w & 0xff;
    const modeA = (w >> 5) & 0x03; // 0 = mode 0, 1/2 = mode 1/2 for port A
    const modeB = (w >> 2) & 0x01;
    this.dirA = w & 0x10 ? 'in' : 'out';
    this.dirCUpper = w & 0x08 ? 'in' : 'out';
    this.dirB = w & 0x02 ? 'in' : 'out';
    this.dirCLower = w & 0x01 ? 'in' : 'out';

    const unsupported = modeA !== 0 || modeB !== 0;
    if (unsupported) {
      this.modeUnsupported = true;
      const which = [modeA === 1 && 'A', modeA === 2 && 'A (Mode 2)', modeB === 1 && 'B']
        .filter(Boolean).join(' and ');
      this.lastWarning =
        `8255 ${this.label}: control word ${hex2(w)}H selects Mode 1/2 (port ${which}); ` +
        `only Mode 0 is simulated — ports behave as Mode 0.`;
    } else {
      this.modeUnsupported = false;
      this.lastWarning = null;
    }

    // Refresh pin drives for the new directions. Groups switched to input
    // stop driving — their pins read 0 (high-Z) until an external driver
    // propagates over a wire. Outputs drive their latched data.
    if (this.dirA === 'out') this.drivePins('PA', this.latchA);
    else this.drivePins('PA', 0);
    if (this.dirB === 'out') this.drivePins('PB', this.latchB);
    else this.drivePins('PB', 0);
    this.drivePortCOutputs();
    for (let i = 0; i < 8; i++) {
      if (this.getPinDir(`PC${i}`) === 'in') this.pins.get(`PC${i}`)!.digital = 0;
    }
  }

  /* ---------------- pin plumbing ---------------- */

  getPinDefs(): PinDef[] {
    return [...PIN_DEFS];
  }

  getPinDir(pinId: string): PinDir {
    switch (pinId.slice(0, 2)) {
      case 'PA':
        return this.dirA === 'out' ? 'out' : 'in';
      case 'PB':
        return this.dirB === 'out' ? 'out' : 'in';
      case 'PC': {
        const n = Number(pinId.slice(2));
        const d = n >= 4 ? this.dirCUpper : this.dirCLower;
        return d === 'out' ? 'out' : 'in';
      }
      default:
        return 'in';
    }
  }

  getPin(pinId: string): Pin {
    const p = this.pins.get(pinId);
    if (!p) throw new Error(`8255 ${this.label}: unknown pin ${pinId}`);
    return p;
  }

  onPinChange(_pinId: string): void {
    // An input pin changed (external driver). ioRead samples pins lazily.
  }

  private readPins(prefix: string): number {
    let v = 0;
    for (let i = 0; i < 8; i++) {
      if (this.pins.get(`${prefix}${i}`)!.digital) v |= 1 << i;
    }
    return v;
  }

  private readPortC(): number {
    // Each half: output bits read back the latch, input bits read the pins.
    let v = 0;
    for (let i = 0; i < 8; i++) {
      if (this.getPinDir(`PC${i}`) === 'out') v |= ((this.latchC >> i) & 1) << i;
      else if (this.pins.get(`PC${i}`)!.digital) v |= 1 << i;
    }
    return v;
  }

  private drivePins(prefix: string, value: number): void {
    for (let i = 0; i < 8; i++) {
      this.pins.get(`${prefix}${i}`)!.digital = ((value >> i) & 1) as 0 | 1;
    }
  }

  private drivePortCOutputs(): void {
    for (let i = 0; i < 8; i++) {
      if (this.getPinDir(`PC${i}`) === 'out') {
        this.pins.get(`PC${i}`)!.digital = ((this.latchC >> i) & 1) as 0 | 1;
      }
    }
  }

  /* ---------------- lifecycle ---------------- */

  tick(_tstates: number): void {
    // 8255 is combinatorial in this model — no internal clocked process.
  }

  reset(): void {
    this.latchA = 0;
    this.latchB = 0;
    this.latchC = 0;
    this.lastWarning = null;
    this.applyModeWord(CW_ALL_INPUT);
  }

  getConfig() {
    return { baseAddress: this.baseAddress };
  }

  setConfig(cfg: Record<string, string | number | boolean>): void {
    if (typeof cfg.baseAddress === 'number') this.baseAddress = cfg.baseAddress & 0xff;
  }

  getProperties() {
    return [
      {
        key: 'baseAddress',
        label: 'Base I/O address',
        kind: 'number' as const,
        min: 0,
        max: 0xfc,
        affectsAddressing: true,
      },
    ];
  }

  /** Card display: current port values + control word. */
  portSummary(): { A: number; B: number; C: number; CW: number } {
    return {
      A: this.ioRead(this.baseAddress),
      B: this.ioRead(this.baseAddress + 1),
      C: this.readPortC(),
      CW: this.controlWord,
    };
  }
}

function hex2(v: number): string {
  return (v & 0xff).toString(16).toUpperCase().padStart(2, '0');
}

export const I8255_META: ComponentMeta = {
  type: 'i8255',
  title: '8255 PPI',
  short: 'Programmable Peripheral Interface — Ports A, B, C',
  about:
    'The Intel 8255 provides 24 I/O lines: two 8-bit ports (A, B) and one ' +
    '8-bit port (C, usable as two independent 4-bit halves). The control ' +
    'register (base+3) configures directions (Mode 0, D7=1) or sets/resets ' +
    'individual port C bits (BSR, D7=0). Mode 0 and BSR are fully simulated; ' +
    'Mode 1 (strobed I/O) and Mode 2 (bidirectional port A) are not — the ' +
    'ports fall back to Mode 0 behavior and a console warning is shown.',
  width: 300,
  height: 330,
  create: (id, x, y) => new I8255(id, x, y),
};
