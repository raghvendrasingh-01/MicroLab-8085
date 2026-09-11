/**
 * 4×4 matrix keypad.
 *
 * Rows R0–R3 are INPUT pins (the CPU side drives them, usually from a
 * parallel output port). Columns C0–C3 are OUTPUT pins (usually wired to a
 * parallel input port). A pressed key connects its row line to its column
 * line, so column c reads the OR of every pressed key's row level.
 *
 * Scanning works exactly like real hardware: drive one row high at a time,
 * read the columns — the column that reads high identifies the pressed key.
 * Each key is modeled as an independent contact (as if the matrix had
 * diodes), so simultaneous presses never ghost. Key presses are physical
 * state and survive CPU reset.
 */
import type { Component, ComponentMeta, Pin, PinDef } from '../core/circuit';

/** Hex keypad layout: KEYS[row][col], key index = row*4 + col. */
export const KEYS: string[][] = [
  ['1', '2', '3', 'A'],
  ['4', '5', '6', 'B'],
  ['7', '8', '9', 'C'],
  ['*', '0', '#', 'D'],
];

const PIN_DEFS: PinDef[] = [
  ...Array.from({ length: 4 }, (_, r): PinDef => ({
    id: `R${r}`,
    label: `R${r}`,
    dir: 'in',
    group: 'Rows (in)',
  })),
  ...Array.from({ length: 4 }, (_, c): PinDef => ({
    id: `C${c}`,
    label: `C${c}`,
    dir: 'out',
    group: 'Cols (out)',
  })),
];

export class Keypad implements Component {
  readonly id: string;
  readonly type = 'keypad';
  label: string;
  x: number;
  y: number;

  /** Pressed key indices (row*4 + col) — physical button state. */
  readonly pressed = new Set<number>();

  private readonly pins = new Map<string, Pin>();

  constructor(id: string, x: number, y: number) {
    this.id = id;
    this.label = 'Keypad';
    this.x = x;
    this.y = y;
    for (const def of PIN_DEFS) this.pins.set(def.id, { ...def, digital: 0 });
  }

  getPinDefs(): PinDef[] {
    return [...PIN_DEFS];
  }

  getPinDir(pinId: string): 'in' | 'out' {
    return pinId.startsWith('R') ? 'in' : 'out';
  }

  getPin(pinId: string): Pin {
    const p = this.pins.get(pinId);
    if (!p) throw new Error(`Keypad ${this.label}: unknown pin ${pinId}`);
    return p;
  }

  onPinChange(pinId: string): void {
    // A row level changed — the column outputs may change with it.
    if (pinId.startsWith('R')) this.driveColumns();
  }

  /** Column c reads the OR of row levels of all pressed keys in that column. */
  private driveColumns(): void {
    for (let c = 0; c < 4; c++) {
      let level: 0 | 1 = 0;
      for (let r = 0; r < 4; r++) {
        if (this.pressed.has(r * 4 + c) && this.pins.get(`R${r}`)!.digital) level = 1;
      }
      this.pins.get(`C${c}`)!.digital = level;
    }
  }

  /** Press or release a key (row*4 + col). The store re-propagates. */
  toggle(key: number): void {
    if (key < 0 || key >= 16) return;
    if (this.pressed.has(key)) this.pressed.delete(key);
    else this.pressed.add(key);
    this.driveColumns();
  }

  setPressed(key: number, down: boolean): void {
    if (key < 0 || key >= 16) return;
    if (down) this.pressed.add(key);
    else this.pressed.delete(key);
    this.driveColumns();
  }

  isPressed(key: number): boolean {
    return this.pressed.has(key);
  }

  tick(_tstates: number): void {
    // Ideal contacts — no bounce, no timing.
  }

  reset(): void {
    // Physical key presses survive reset (a held key stays held).
    this.driveColumns();
  }

  getConfig() {
    return { pressed: [...this.pressed].sort((a, b) => a - b).join(',') };
  }

  setConfig(cfg: Record<string, string | number | boolean>): void {
    this.pressed.clear();
    if (typeof cfg.pressed === 'string') {
      for (const part of cfg.pressed.split(',')) {
        const k = Number(part);
        if (part !== '' && k >= 0 && k < 16) this.pressed.add(k);
      }
    }
    this.driveColumns();
  }

  getProperties() {
    return []; // keys are pressed directly on the canvas
  }
}

export const KEYPAD_META: ComponentMeta = {
  type: 'keypad',
  title: '4×4 keypad',
  short: 'Matrix keypad, rows in / columns out',
  about:
    'A 4×4 hex keypad wired as a matrix. The CPU drives the ROW lines R0–R3 ' +
    '(from an output port) and reads the COLUMN lines C0–C3 (into an input ' +
    'port). Pressing a key connects that key\'s row to its column: with row R ' +
    'driven high, the column of any pressed key in that row reads high. ' +
    'Scan by driving one row at a time and IN-reading the columns. Layout: ' +
    'rows 1-2-3-A / 4-5-6-B / 7-8-9-C / *-0-#-D. Each key acts as an ' +
    'independent contact (a diode matrix), so multiple simultaneous presses ' +
    'never produce ghost keys — a documented simplification. Key presses are ' +
    'physical state and survive CPU reset.',
  width: 240,
  height: 330,
  create: (id, x, y) => new Keypad(id, x, y),
};
