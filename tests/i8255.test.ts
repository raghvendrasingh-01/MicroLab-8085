/**
 * 8255 unit tests: control word, Mode 0 directions, BSR, address decoding.
 */
import { describe, it, expect } from 'vitest';
import { I8255 } from '../src/components/i8255';
import { IoBus } from '../src/core/ioBus';

describe('8255 Mode 0', () => {
  it('defaults to all ports input (control word 9BH)', () => {
    const p = new I8255('u1', 0, 0, 0x80);
    expect(p.controlWord).toBe(0x9b);
    expect(p.dirA).toBe('in');
    expect(p.dirB).toBe('in');
    expect(p.dirCUpper).toBe('in');
    expect(p.dirCLower).toBe('in');
  });

  it('control word 80H: Mode 0, all ports output', () => {
    const p = new I8255('u1', 0, 0, 0x80);
    p.ioWrite(0x83, 0x80);
    expect(p.dirA).toBe('out');
    expect(p.dirB).toBe('out');
    expect(p.dirCUpper).toBe('out');
    expect(p.dirCLower).toBe('out');
    expect(p.ioRead(0x83)).toBe(0x80); // control word reads back
  });

  it('mixed directions: 93H = A in, B in, C-upper out, C-lower in', () => {
    const p = new I8255('u1', 0, 0, 0x80);
    p.ioWrite(0x83, 0x93);
    expect(p.dirA).toBe('in');
    expect(p.dirB).toBe('in');
    expect(p.dirCUpper).toBe('out');
    expect(p.dirCLower).toBe('in');
  });

  it('writing Port A drives the PA pins when output', () => {
    const p = new I8255('u1', 0, 0, 0x80);
    p.ioWrite(0x83, 0x80); // A out
    p.ioWrite(0x80, 0xa5);
    expect(p.getPin('PA0').digital).toBe(1);
    expect(p.getPin('PA7').digital).toBe(1);
    expect(p.getPin('PA1').digital).toBe(0);
    expect(p.ioRead(0x80)).toBe(0xa5); // reads back the latch
  });

  it('writing Port A does NOT drive pins when input', () => {
    const p = new I8255('u1', 0, 0, 0x80);
    p.ioWrite(0x80, 0xff); // still input (9BH)
    expect(p.getPin('PA0').digital).toBe(0);
    expect(p.ioRead(0x80)).toBe(0x00); // reads the pins, not the latch
  });

  it('reading an input port returns externally driven pin values', () => {
    const p = new I8255('u1', 0, 0, 0x80);
    // Simulate an external driver writing the pins directly.
    for (let i = 0; i < 8; i++) p.getPin(`PA${i}`).digital = ((0x5a >> i) & 1) as 0 | 1;
    expect(p.ioRead(0x80)).toBe(0x5a);
  });

  it('Port C halves configure independently (CW 93H: C-upper out, C-lower in)', () => {
    const p = new I8255('u1', 0, 0, 0x80);
    p.ioWrite(0x83, 0x93); // A in, B in, C upper out, C lower in
    expect(p.getPinDir('PC4')).toBe('out');
    expect(p.getPinDir('PC7')).toBe('out');
    expect(p.getPinDir('PC0')).toBe('in');
    expect(p.getPinDir('PC3')).toBe('in');
    p.ioWrite(0x82, 0xf0); // upper half driven, lower half is input
    expect(p.getPin('PC7').digital).toBe(1);
    expect(p.getPin('PC3').digital).toBe(0); // not driven
    // Read C: outputs read back latch, inputs read pins (all 0 here)
    expect(p.ioRead(0x82)).toBe(0xf0);
  });

  it('output data latched while input appears when direction switches', () => {
    const p = new I8255('u1', 0, 0, 0x80);
    p.ioWrite(0x80, 0x3c); // latch while A is input
    expect(p.getPin('PA5').digital).toBe(0);
    p.ioWrite(0x83, 0x80); // switch A to output
    expect(p.getPin('PA5').digital).toBe(1);
    expect(p.ioRead(0x80)).toBe(0x3c);
  });

  it('addresses below base and outside the window do not decode', () => {
    const p = new I8255('u1', 0, 0, 0x80);
    p.ioWrite(0x83, 0x80);
    p.ioWrite(0x84, 0xff); // outside window [80,84) — ignored
    expect(p.ioRead(0x84)).toBe(0xff); // open bus
    // Offsets wrap within the window only via (addr - base) & 0xff; 0x04 is out.
  });
});

describe('8255 BSR mode', () => {
  it('sets and resets individual Port C bits', () => {
    const p = new I8255('u1', 0, 0, 0x80);
    p.ioWrite(0x83, 0x80); // all output, Mode 0
    p.ioWrite(0x82, 0x00); // clear
    p.ioWrite(0x83, 0x0d); // BSR: set PC6 (bit=110, set=1 → 0x0D)
    expect(p.ioRead(0x82)).toBe(0x40);
    p.ioWrite(0x83, 0x0c); // reset PC6
    expect(p.ioRead(0x82)).toBe(0x00);
    expect(p.getPin('PC6').digital).toBe(0);
  });

  it('BSR does not change port directions', () => {
    const p = new I8255('u1', 0, 0, 0x80);
    p.ioWrite(0x83, 0x80); // all output
    p.ioWrite(0x83, 0x01); // BSR set PC0 (D7=0)
    expect(p.dirB).toBe('out'); // unchanged by BSR
    expect(p.dirA).toBe('out');
  });
});

describe('8255 unsupported modes', () => {
  it('Mode 1/2 control words fall back to Mode 0 and warn', () => {
    const p = new I8255('u1', 0, 0, 0x80);
    p.ioWrite(0x83, 0xbe); // D7=1, D6=1 → Port A Mode 1... unsupported
    expect(p.modeUnsupported).toBe(true);
    expect(p.lastWarning).toMatch(/Mode 1\/2/);
    // Direction bits still honored (D4=1 → A input)
    expect(p.dirA).toBe('in');
    // Back to Mode 0 clears the warning
    p.ioWrite(0x83, 0x80);
    expect(p.modeUnsupported).toBe(false);
    expect(p.lastWarning).toBeNull();
  });
});

describe('8255 + IoBus', () => {
  it('occupies four consecutive addresses and reads/writes route correctly', () => {
    const bus = new IoBus();
    const p = new I8255('u1', 0, 0, 0x40);
    expect(bus.register(p)).toBe(true);
    expect(bus.ownerAt(0x40)).toBe(p);
    expect(bus.ownerAt(0x43)).toBe(p);
    expect(bus.ownerAt(0x44)).toBeNull();
    bus.write(0x43, 0x80);
    bus.write(0x40, 0x42);
    expect(bus.read(0x40)).toBe(0x42);
  });
});
