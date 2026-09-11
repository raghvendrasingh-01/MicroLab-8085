/**
 * Phase 3 components: seven-segment display, 4×4 matrix keypad, 16×2 LCD.
 * Tested at two levels — direct pin manipulation (hardware semantics) and
 * through the assembler → CPU → 8255 → wire pipeline (what students run).
 */
import { describe, it, expect } from 'vitest';
import { Assembler } from '../src/asm/assembler';
import { Machine } from '../src/system/machine';
import { I8255 } from '../src/components/i8255';
import { SevenSegment, DIGIT_SEGMENTS } from '../src/components/sevenSegment';
import { Keypad, KEYS } from '../src/components/keypad';
import { Lcd1602 } from '../src/components/lcd';

/** Drive a component's input pins to a byte pattern and propagate. */
function drive(machine: Machine, from: I8255, prefix: string, value: number) {
  from.ioWrite(from.baseAddress + 3, 0x80); // all outputs
  from.ioWrite(from.baseAddress + (prefix === 'PA' ? 0 : 1), value);
  machine.circuit.propagate();
}

function wirePins(machine: Machine, ppi: I8255, ppiPrefix: string, target: { id: string }, pinOf: (i: number) => string) {
  for (let i = 0; i < 8; i++) {
    expect(machine.circuit.connect(ppi.id, `${ppiPrefix}${i}`, target.id, pinOf(i))).not.toBeNull();
  }
}

describe('seven-segment display', () => {
  it('lights the segments of the written pattern (digit 3)', () => {
    const machine = new Machine();
    const ppi = new I8255('ppi', 0, 0, 0x80);
    const seg = new SevenSegment('seg', 0, 0);
    machine.addPeripheral(ppi);
    machine.circuit.add(seg);
    // a,b,c,d,g = 0b01001111 = 4FH (digit 3)
    wirePins(machine, ppi, 'PA', seg, (i) => ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'dp'][i]!);
    drive(machine, ppi, 'PA', 0x4f);
    for (const s of ['a', 'b', 'c', 'd', 'g'] as const) expect(seg.segmentLit(s)).toBe(true);
    for (const s of ['e', 'f', 'dp'] as const) expect(seg.segmentLit(s)).toBe(false);
  });

  it('every DIGIT_SEGMENTS entry produces that digit on the display', () => {
    const machine = new Machine();
    const ppi = new I8255('ppi', 0, 0, 0x80);
    const seg = new SevenSegment('seg', 0, 0);
    machine.addPeripheral(ppi);
    machine.circuit.add(seg);
    wirePins(machine, ppi, 'PA', seg, (i) => ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'dp'][i]!);
    for (const segments of Object.values(DIGIT_SEGMENTS)) {
      let v = 0;
      for (const s of segments.split('')) v |= 1 << 'abcdefg'.indexOf(s);
      drive(machine, ppi, 'PA', v);
      // The pattern must be distinguishable from 0 and 8 (all-on).
      expect(seg.segmentValue()).toBe(v & 0x7f);
      // And re-derive the digit from lit segments for an exactness check.
      const lit = 'abcdefg'.split('').filter((s) => seg.segmentLit(s as 'a')).join('');
      expect(lit.split('').sort().join('')).toBe(segments.split('').sort().join(''));
    }
  });

  it('common anode inverts the sense', () => {
    const machine = new Machine();
    const ppi = new I8255('ppi', 0, 0, 0x80);
    const seg = new SevenSegment('seg', 0, 0);
    seg.commonAnode = true;
    machine.addPeripheral(ppi);
    machine.circuit.add(seg);
    wirePins(machine, ppi, 'PA', seg, (i) => ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'dp'][i]!);
    drive(machine, ppi, 'PA', 0x00); // all pins low
    for (const s of ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'dp'] as const) {
      expect(seg.segmentLit(s)).toBe(true); // inverted: 0 lights it
    }
    drive(machine, ppi, 'PA', 0xff);
    expect(seg.segmentValue()).toBe(0);
  });

  it('undriven segments read 0 (dark), not stale values', () => {
    const machine = new Machine();
    const ppi = new I8255('ppi', 0, 0, 0x80);
    const seg = new SevenSegment('seg', 0, 0);
    machine.addPeripheral(ppi);
    machine.circuit.add(seg);
    wirePins(machine, ppi, 'PA', seg, (i) => ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'dp'][i]!);
    drive(machine, ppi, 'PA', 0xff);
    expect(seg.segmentValue()).toBe(0xff);
    // Switch the port to input → net undriven → pulled low.
    ppi.ioWrite(ppi.baseAddress + 3, 0x9b);
    machine.circuit.propagate();
    expect(seg.segmentValue()).toBe(0);
  });
});

describe('4×4 matrix keypad', () => {
  function setup() {
    const machine = new Machine();
    const ppi = new I8255('ppi', 0, 0, 0x80);
    const kp = new Keypad('kp', 0, 0);
    machine.addPeripheral(ppi);
    machine.circuit.add(kp);
    // Port A lower half (PA0-PA3) → rows; Port B (PB0-PB3) ← columns.
    // Control word 0x82: A out, B in.
    ppi.ioWrite(ppi.baseAddress + 3, 0x82);
    for (let i = 0; i < 4; i++) {
      expect(machine.circuit.connect(ppi.id, `PA${i}`, kp.id, `R${i}`)).not.toBeNull();
      expect(machine.circuit.connect(kp.id, `C${i}`, ppi.id, `PB${i}`)).not.toBeNull();
    }
    return { machine, ppi, kp };
  }

  it('no keys pressed → all columns read 0 regardless of row drive', () => {
    const { machine, ppi, kp } = setup();
    ppi.ioWrite(ppi.baseAddress + 0, 0x0f); // all rows high
    machine.circuit.propagate();
    expect(ppi.ioRead(ppi.baseAddress + 1)).toBe(0x00);
    expect(kp.getPin('C0').digital).toBe(0);
  });

  it('scanning finds a pressed key: drive row 2, read columns', () => {
    const { machine, ppi } = setup();
    // Press '8' = row 2, col 0.
    const { kp } = { kp: machine.circuit.get('kp') as Keypad };
    kp.setPressed(2 * 4 + 0, true);

    ppi.ioWrite(ppi.baseAddress + 0, 0b0100); // row 2 high only
    machine.circuit.propagate();
    expect(ppi.ioRead(ppi.baseAddress + 1)).toBe(0b0001); // column 0 reads high → key 8

    ppi.ioWrite(ppi.baseAddress + 0, 0b0001); // row 0 high only
    machine.circuit.propagate();
    expect(ppi.ioRead(ppi.baseAddress + 1)).toBe(0b0000); // key 8's row is low → column quiet

    // Release: column goes quiet even with row driven.
    kp.setPressed(2 * 4 + 0, false);
    machine.circuit.propagate();
    ppi.ioWrite(ppi.baseAddress + 0, 0b0100);
    machine.circuit.propagate();
    expect(ppi.ioRead(ppi.baseAddress + 1)).toBe(0b0000);
  });

  it('two keys in the same column OR together; different columns are independent', () => {
    const { machine, ppi } = setup();
    const kp = machine.circuit.get('kp') as Keypad;
    // '5' = r1c1, '9' = r2c1 (same column 1); 'A' = r0c3.
    kp.setPressed(1 * 4 + 1, true);
    kp.setPressed(2 * 4 + 1, true);
    kp.setPressed(0 * 4 + 3, true);

    ppi.ioWrite(ppi.baseAddress + 0, 0b0010); // row 1 high
    machine.circuit.propagate();
    expect(ppi.ioRead(ppi.baseAddress + 1)).toBe(0b0010); // col 1 (key 5)

    ppi.ioWrite(ppi.baseAddress + 0, 0b0100); // row 2 high
    machine.circuit.propagate();
    expect(ppi.ioRead(ppi.baseAddress + 1)).toBe(0b0010); // col 1 (key 9)

    ppi.ioWrite(ppi.baseAddress + 0, 0b0110); // rows 1+2 high — col 1 still just 1
    machine.circuit.propagate();
    expect(ppi.ioRead(ppi.baseAddress + 1)).toBe(0b0010);
  });

  it('key layout is the documented 1-2-3-A / 4-5-6-B / 7-8-9-C / *-0-#-D', () => {
    expect(KEYS).toEqual([
      ['1', '2', '3', 'A'],
      ['4', '5', '6', 'B'],
      ['7', '8', '9', 'C'],
      ['*', '0', '#', 'D'],
    ]);
  });

  it('key presses survive CPU reset (physical state)', () => {
    const { machine, ppi } = setup();
    const kp = machine.circuit.get('kp') as Keypad;
    kp.setPressed(3 * 4 + 3, true); // 'D'
    machine.reset(true);
    ppi.ioWrite(ppi.baseAddress + 3, 0x82); // reset restored 9BH — re-arm A out / B in
    ppi.ioWrite(ppi.baseAddress + 0, 0b1000);
    machine.circuit.propagate();
    expect(ppi.ioRead(ppi.baseAddress + 1)).toBe(0b1000);
  });

  it('full CPU program scans the keypad: press detected via IN', () => {
    const machine = new Machine();
    const ppi = new I8255('ppi', 0, 0, 0x80);
    const kp = new Keypad('kp', 0, 0);
    machine.addPeripheral(ppi);
    machine.circuit.add(kp);
    for (let i = 0; i < 4; i++) {
      machine.circuit.connect(ppi.id, `PA${i}`, kp.id, `R${i}`);
      machine.circuit.connect(kp.id, `C${i}`, ppi.id, `PB${i}`);
    }
    kp.setPressed(0 * 4 + 1, true); // press '2' (row 0, col 1)

    const asm = new Assembler();
    const r = asm.assemble(`
      ORG 2000H
      MVI A, 82H      ; A out, B in
      OUT 83H
      MVI A, 01H      ; drive row 0
      OUT 80H
      IN 81H          ; read columns -> A
      HLT
    `);
    expect(r.errors).toEqual([]);
    machine.loadProgram(r.segments, r.entry);
    machine.runState = 'running';
    let guard = 0;
    while (machine.runState === 'running' && guard++ < 100) machine.stepInstruction();
    expect(machine.runState).toBe('halted');
    expect(machine.cpu.a).toBe(0x02); // column 1 high = key '2'
  });
});

describe('16×2 LCD (HD44780-style)', () => {
  /** Wire an LCD to two 8255 ports: PA = data bus, PC0/PC1/PC2 = RS/RW/EN. */
  function setup() {
    const machine = new Machine();
    const ppi = new I8255('ppi', 0, 0, 0x80);
    const lcd = new Lcd1602('lcd', 0, 0);
    machine.addPeripheral(ppi);
    machine.circuit.add(lcd);
    for (let i = 0; i < 8; i++) {
      expect(machine.circuit.connect(ppi.id, `PA${i}`, lcd.id, `D${i}`)).not.toBeNull();
    }
    expect(machine.circuit.connect(ppi.id, 'PC0', lcd.id, 'RS')).not.toBeNull();
    expect(machine.circuit.connect(ppi.id, 'PC1', lcd.id, 'RW')).not.toBeNull();
    expect(machine.circuit.connect(ppi.id, 'PC2', lcd.id, 'EN')).not.toBeNull();
    // Control word 0x80: everything output.
    ppi.ioWrite(ppi.baseAddress + 3, 0x80);
    return { machine, ppi, lcd };
  }

  /** Pulse one LCD cycle: RS, RW, byte on D0-D7, EN up then down. */
  function cycle(machine: Machine, ppi: I8255, rs: 0 | 1, rw: 0 | 1, byte: number) {
    const ctrl = (rs << 0) | (rw << 1);
    ppi.ioWrite(ppi.baseAddress + 2, ctrl | 0x04); // RS/RW set, EN high, data on bus
    ppi.ioWrite(ppi.baseAddress + 0, byte);
    machine.circuit.propagate();
    ppi.ioWrite(ppi.baseAddress + 2, ctrl); // EN falls — the byte latches
    machine.circuit.propagate();
  }

  it('writes characters: HELLO appears on row 0', () => {
    const { machine, ppi, lcd } = setup();
    cycle(machine, ppi, 0, 0, 0x01); // clear
    cycle(machine, ppi, 0, 0, 0x0f); // display + cursor + blink on
    for (const ch of 'HELLO') cycle(machine, ppi, 1, 0, ch.charCodeAt(0));
    expect(lcd.text()[0]).toBe('HELLO           ');
    expect(lcd.cursorVisible()).toEqual({ row: 0, col: 5 });
    expect(lcd.isBlinking()).toBe(true);
  });

  it('clear + second line addressing: DDRAM 40H = row 1', () => {
    const { machine, ppi, lcd } = setup();
    cycle(machine, ppi, 0, 0, 0x01);
    cycle(machine, ppi, 0, 0, 0x80 + 0x40); // set DDRAM address 40H (row 1, col 0)
    cycle(machine, ppi, 0, 0, 0x06); // entry mode: increment
    for (const ch of 'WORLD') cycle(machine, ppi, 1, 0, ch.charCodeAt(0));
    const t = lcd.text();
    expect(t[0]).toBe(' '.repeat(16));
    expect(t[1]).toBe('WORLD           ');
  });

  it('writing past column 15 continues into hidden DDRAM, not row 1', () => {
    const { machine, ppi, lcd } = setup();
    cycle(machine, ppi, 0, 0, 0x01);
    cycle(machine, ppi, 0, 0, 0x06);
    for (const ch of 'ABCDEFGHIJKLMNOPQRST') cycle(machine, ppi, 1, 0, ch.charCodeAt(0));
    // Only the first 16 are visible; QRS T live in hidden DDRAM columns 16-19.
    expect(lcd.text()[0]).toBe('ABCDEFGHIJKLMNOP');
    expect(lcd.text()[1]).toBe(' '.repeat(16));
    expect(lcd.addressCounter()).toBe(20); // still row 0
  });

  it('display shift scrolls the window over DDRAM', () => {
    const { machine, ppi, lcd } = setup();
    cycle(machine, ppi, 0, 0, 0x01);
    cycle(machine, ppi, 0, 0, 0x06);
    for (const ch of 'ABCDEFGHIJKLMNOPQRSTUVWX') cycle(machine, ppi, 1, 0, ch.charCodeAt(0));
    cycle(machine, ppi, 0, 0, 0x1c); // shift display right ×1
    expect(lcd.text()[0]).toBe('BCDEFGHIJKLMNOPQ');
    cycle(machine, ppi, 0, 0, 0x1c);
    expect(lcd.text()[0]).toBe('CDEFGHIJKLMNOPQR');
    cycle(machine, ppi, 0, 0, 0x18); // shift display left ×1
    expect(lcd.text()[0]).toBe('BCDEFGHIJKLMNOPQ');
  });

  it('read cycle returns the address counter with busy flag clear', () => {
    const { machine, ppi } = setup();
    cycle(machine, ppi, 0, 0, 0x01);
    cycle(machine, ppi, 0, 0, 0x80 + 0x45); // row 1, col 5
    // To read the bus the data port must be an input: CW 0x90 = A in, C out.
    ppi.ioWrite(ppi.baseAddress + 3, 0x90);
    machine.circuit.propagate();
    ppi.ioWrite(ppi.baseAddress + 2, 0b010); // RS=0 RW=1 EN=0
    machine.circuit.propagate();
    ppi.ioWrite(ppi.baseAddress + 2, 0b110); // EN high — LCD drives D0-D7
    machine.circuit.propagate();
    const readBack = ppi.ioRead(ppi.baseAddress + 0); // the 8255 input side samples the wires
    expect(readBack).toBe(0x45); // busy (bit 7) clear, address 45H
    ppi.ioWrite(ppi.baseAddress + 2, 0b010); // EN low — cycle complete
    machine.circuit.propagate();
  });

  it('function set 4-bit mode warns once and is ignored', () => {
    const { machine, ppi, lcd } = setup();
    cycle(machine, ppi, 0, 0, 0x28); // DL=0 → 4-bit
    expect(lcd.lastWarning).toMatch(/4-bit/);
    lcd.lastWarning = null;
    cycle(machine, ppi, 0, 0, 0x28);
    expect(lcd.lastWarning).toBeNull(); // warned once only
  });

  it('display off blanks the view; reset restores a clean screen', () => {
    const { machine, ppi, lcd } = setup();
    cycle(machine, ppi, 0, 0, 0x01);
    cycle(machine, ppi, 0, 0, 0x06);
    for (const ch of 'X') cycle(machine, ppi, 1, 0, ch.charCodeAt(0));
    cycle(machine, ppi, 0, 0, 0x08); // display off
    expect(lcd.isDisplayOn()).toBe(false);
    machine.reset(true);
    expect(lcd.isDisplayOn()).toBe(true);
    expect(lcd.text()).toEqual([' '.repeat(16), ' '.repeat(16)]);
  });

  it('full CPU program prints HI on the LCD', () => {
    const machine = new Machine();
    const ppi = new I8255('ppi', 0, 0, 0x80);
    const lcd = new Lcd1602('lcd', 0, 0);
    machine.addPeripheral(ppi);
    machine.circuit.add(lcd);
    for (let i = 0; i < 8; i++) machine.circuit.connect(ppi.id, `PA${i}`, lcd.id, `D${i}`);
    machine.circuit.connect(ppi.id, 'PC0', lcd.id, 'RS');
    machine.circuit.connect(ppi.id, 'PC1', lcd.id, 'RW');
    machine.circuit.connect(ppi.id, 'PC2', lcd.id, 'EN');

    const asm = new Assembler();
    const r = asm.assemble(`
      ORG 2000H
      MVI A, 80H      ; all ports output
      OUT 83H
      ; clear display
      MVI A, 01H
      OUT 80H
      MVI A, 04H      ; EN=1, RS=0, RW=0
      OUT 82H
      MVI A, 00H      ; EN=0 -> latch
      OUT 82H
      ; entry mode
      MVI A, 06H
      OUT 80H
      MVI A, 04H
      OUT 82H
      MVI A, 00H
      OUT 82H
      ; 'H'
      MVI A, 48H
      OUT 80H
      MVI A, 05H      ; EN=1, RS=1
      OUT 82H
      MVI A, 01H      ; EN=0, RS=1
      OUT 82H
      ; 'I'
      MVI A, 49H
      OUT 80H
      MVI A, 05H
      OUT 82H
      MVI A, 01H
      OUT 82H
      HLT
    `);
    expect(r.errors).toEqual([]);
    machine.loadProgram(r.segments, r.entry);
    machine.runState = 'running';
    let guard = 0;
    while (machine.runState === 'running' && guard++ < 500) machine.stepInstruction();
    expect(machine.runState).toBe('halted');
    expect((lcd.text()[0] ?? '').startsWith('HI')).toBe(true);
  });
});
