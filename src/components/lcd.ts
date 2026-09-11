/**
 * 16×2 character LCD (HD44780-style, 8-bit interface).
 *
 * Pins: D0–D7 (bidirectional bus), RS, RW, EN (inputs). A write cycle is:
 * set RS/RW and the data pins, pulse EN high then low — the byte is latched
 * on the EN falling edge. A read cycle (RW=1) drives the data bus with the
 * busy flag (always 0 — this LCD responds instantly) and the address counter
 * while EN is high.
 *
 * DDRAM is modeled faithfully: two 40-character rows; the visible 16-char
 * window can be shifted over them (cursor/display shift commands). Writes
 * wrap within a row — the classic HD44780 gotcha: writing past column 39
 * returns to column 0 of the SAME row, not the next row.
 *
 * Documented simplifications: the busy flag never sets (instant execution),
 * 4-bit mode (function set DL=0) and CGRAM custom characters are not
 * simulated — both warn once in the console and are ignored.
 */
import type { Component, ComponentMeta, Pin, PinDef } from '../core/circuit';

const ROWS = 2;
const COLS = 16;
const DDRAM_COLS = 40;

const DATA_PINS: PinDef[] = Array.from({ length: 8 }, (_, i): PinDef => ({
  id: `D${i}`,
  label: `D${i}`,
  dir: 'io',
  group: 'Data',
}));

const CTRL_PINS: PinDef[] = [
  { id: 'RS', label: 'RS', dir: 'in', group: 'Control' },
  { id: 'RW', label: 'RW', dir: 'in', group: 'Control' },
  { id: 'EN', label: 'EN', dir: 'in', group: 'Control' },
];

const PIN_DEFS: PinDef[] = [...DATA_PINS, ...CTRL_PINS];

export class Lcd1602 implements Component {
  readonly id: string;
  readonly type = 'lcd1602';
  label: string;
  x: number;
  y: number;

  /** DDRAM: 2 rows × 40 columns of character codes. */
  private readonly ddram: string[][] = [
    Array.from({ length: DDRAM_COLS }, () => ' '),
    Array.from({ length: DDRAM_COLS }, () => ' '),
  ];
  /** Address counter: [row, col within the 40-char DDRAM row]. */
  private cursor: [number, number] = [0, 0];
  /** Window origin over DDRAM (column of DDRAM shown at display column 0). */
  private shift = 0;
  /** Entry mode bits: increment (I/D) and shift-on-write (S). */
  private increment = true;
  private shiftOnWrite = false;
  /** Display control bits. */
  private displayOn = true;
  private cursorOn = false;
  private blinkOn = false;
  /** Last EN level, for falling-edge detection. */
  private lastEn = 0;
  /** Set once per run for one-time warnings. */
  lastWarning: string | null = null;
  private warned4bit = false;
  private warnedCgram = false;
  private warnedShiftWrite = false;

  private readonly pins = new Map<string, Pin>();

  constructor(id: string, x: number, y: number) {
    this.id = id;
    this.label = 'LCD 16×2';
    this.x = x;
    this.y = y;
    for (const def of PIN_DEFS) this.pins.set(def.id, { ...def, digital: 0 });
  }

  getPinDefs(): PinDef[] {
    return [...PIN_DEFS];
  }

  /**
   * The data bus is bidirectional: the LCD drives it only during a read
   * cycle (RW=1 while EN is high); otherwise it is an input like a real
   * HD44780 with the bus released.
   */
  getPinDir(pinId: string): 'in' | 'out' {
    if (!pinId.startsWith('D')) return 'in';
    const rw = this.pins.get('RW')!.digital === 1;
    const en = this.pins.get('EN')!.digital === 1;
    return rw && en ? 'out' : 'in';
  }

  getPin(pinId: string): Pin {
    const p = this.pins.get(pinId);
    if (!p) throw new Error(`LCD ${this.label}: unknown pin ${pinId}`);
    return p;
  }

  onPinChange(pinId: string): void {
    if (pinId === 'EN') {
      const en = this.pins.get('EN')!.digital;
      if (this.lastEn === 1 && en === 0) this.executeCycle();
      else if (this.lastEn === 0 && en === 1 && this.getPinDir('D0') === 'out') {
        this.driveBus();
      }
      this.lastEn = en;
      return;
    }
    if (pinId === 'RW' || pinId === 'RS') {
      // Bus direction may have changed (RW toggled while EN high).
      if (this.getPinDir('D0') === 'out') this.driveBus();
    }
  }

  private dataByte(): number {
    let v = 0;
    for (let i = 0; i < 8; i++) {
      if (this.pins.get(`D${i}`)!.digital) v |= 1 << i;
    }
    return v;
  }

  /** Drive the bus for a read cycle: busy flag (0) + address counter. */
  private driveBus(): void {
    const addr = this.cursor[0] * 0x40 + this.cursor[1];
    for (let i = 0; i < 8; i++) {
      this.pins.get(`D${i}`)!.digital = ((addr >> i) & 1) as 0 | 1;
    }
  }

  /** The latched operation: RS/RW decide command, data write, or read. */
  private executeCycle(): void {
    const rs = this.pins.get('RS')!.digital === 1;
    const rw = this.pins.get('RW')!.digital === 1;
    if (rw) {
      // Read cycle (busy flag / address) — bus was driven while EN was high.
      return;
    }
    const b = this.dataByte();
    if (rs) this.writeData(b);
    else this.writeCommand(b);
  }

  private writeData(code: number): void {
    this.ddram[this.cursor[0]]![this.cursor[1]] = String.fromCharCode(code);
    if (this.shiftOnWrite && !this.warnedShiftWrite) {
      this.warnedShiftWrite = true;
      this.lastWarning = `${this.label}: entry-mode shift-on-write (S=1) is not simulated; characters are written in place.`;
    }
    this.advanceCursor();
  }

  private advanceCursor(): void {
    const dir = this.increment ? 1 : -1;
    let col = this.cursor[1] + dir;
    if (col >= DDRAM_COLS) col = 0; // wraps within the SAME row — HD44780 behavior
    if (col < 0) col = DDRAM_COLS - 1;
    this.cursor[1] = col;
  }

  private writeCommand(b: number): void {
    if ((b & 0x80) !== 0) {
      // Set DDRAM address.
      const addr = b & 0x7f;
      const row = addr >= 0x40 ? 1 : 0;
      let col = addr & 0x3f;
      if (col >= DDRAM_COLS) col = DDRAM_COLS - 1;
      this.cursor = [row, col];
      return;
    }
    if ((b & 0x40) !== 0) {
      // Set CGRAM address — custom characters not simulated.
      if (!this.warnedCgram) {
        this.warnedCgram = true;
        this.lastWarning = `${this.label}: CGRAM custom characters are not simulated; the command is ignored.`;
      }
      return;
    }
    if ((b & 0x20) !== 0) {
      // Function set.
      if ((b & 0x10) === 0 && !this.warned4bit) {
        this.warned4bit = true;
        this.lastWarning = `${this.label}: 4-bit mode (DL=0) is not simulated; the LCD stays in 8-bit mode.`;
      }
      return; // 8-bit, 2-line assumed throughout.
    }
    if ((b & 0x10) !== 0) {
      // Cursor or display shift.
      const right = (b & 0x04) !== 0;
      if (b & 0x08) {
        this.shift = Math.min(DDRAM_COLS - COLS, Math.max(0, this.shift + (right ? 1 : -1)));
      } else {
        const dir = right ? 1 : -1;
        let col = this.cursor[1] + dir;
        if (col >= DDRAM_COLS) col = DDRAM_COLS - 1;
        if (col < 0) col = 0;
        this.cursor[1] = col;
      }
      return;
    }
    if ((b & 0x08) !== 0) {
      // Display on/off control.
      this.displayOn = (b & 0x04) !== 0;
      this.cursorOn = (b & 0x02) !== 0;
      this.blinkOn = (b & 0x01) !== 0;
      return;
    }
    if ((b & 0x04) !== 0) {
      // Entry mode set.
      this.increment = (b & 0x02) !== 0;
      this.shiftOnWrite = (b & 0x01) !== 0;
      return;
    }
    if (b === 0x02) {
      // Return home.
      this.cursor = [0, 0];
      return;
    }
    if (b === 0x01) {
      // Clear display.
      for (const row of this.ddram) row.fill(' ');
      this.cursor = [0, 0];
      this.shift = 0;
    }
    // Other bytes: no-op, like an HD44780 ignoring undefined commands.
  }

  // --- views for the card body ---

  /** The visible 2×16 window (after display shift). */
  text(): string[] {
    return Array.from({ length: ROWS }, (_, r) =>
      this.ddram[r]!.slice(this.shift, this.shift + COLS).join(''),
    );
  }

  /** Cursor position in visible coordinates, or null when off-screen/hidden. */
  cursorVisible(): { row: number; col: number } | null {
    if (!this.displayOn || !this.cursorOn) return null;
    const col = this.cursor[1] - this.shift;
    if (col < 0 || col >= COLS) return null;
    return { row: this.cursor[0], col };
  }

  isBlinking(): boolean {
    return this.blinkOn;
  }

  isDisplayOn(): boolean {
    return this.displayOn;
  }

  /** Address counter value (for tests / diagnostics). */
  addressCounter(): number {
    return this.cursor[0] * 0x40 + this.cursor[1];
  }

  tick(_tstates: number): void {
    // Executes instantly — the busy flag never sets (documented simplification).
  }

  reset(): void {
    // Like a real power cycle: DDRAM cleared is NOT guaranteed, but cursor
    // and mode reset. We clear everything for a reproducible lab.
    for (const row of this.ddram) row.fill(' ');
    this.cursor = [0, 0];
    this.shift = 0;
    this.increment = true;
    this.shiftOnWrite = false;
    this.displayOn = true;
    this.cursorOn = false;
    this.blinkOn = false;
    this.lastEn = 0;
    this.lastWarning = null;
    this.warned4bit = false;
    this.warnedCgram = false;
    this.warnedShiftWrite = false;
    for (const p of this.pins.values()) p.digital = 0;
  }

  getConfig() {
    return { text: this.text().join('\n') };
  }

  setConfig(cfg: Record<string, string | number | boolean>): void {
    // Text content is produced by the program; not restored from config.
    void cfg;
  }

  getProperties() {
    return [];
  }
}

export const LCD_META: ComponentMeta = {
  type: 'lcd1602',
  title: 'LCD 16×2',
  short: 'HD44780-style text display, 8-bit bus',
  about:
    'A 16-column × 2-row character LCD with the classic HD44780 interface: ' +
    'an 8-bit data bus D0–D7 plus RS (0=command, 1=data), RW (0=write, ' +
    '1=read) and EN. A cycle is: set RS/RW and the bus, pulse EN high then ' +
    'low — the byte latches on the falling edge. Drive it from two 8255 ' +
    'ports (one for data, one for RS/RW/EN on its spare lines). Commands: ' +
    '01H clear, 02H home, 04–07H entry mode, 08–0FH display/cursor on/off, ' +
    '10–1FH cursor/display shift, 20H+ function set, 80H+ set DDRAM address ' +
    '(row 0 = 00–27H, row 1 = 40–67H). Reading with RW=1 returns the address ' +
    'counter with the busy flag (bit 7) always clear — this LCD executes ' +
    'instantly. Simplifications, warned in the console: 4-bit mode, CGRAM ' +
    'custom characters and entry-mode shift-on-write are not simulated.',
  width: 330,
  height: 230,
  create: (id, x, y) => new Lcd1602(id, x, y),
};
