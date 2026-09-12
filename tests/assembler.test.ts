/**
 * Assembler tests: directives, syntax forms, error messages.
 */
import { describe, it, expect } from 'vitest';
import { Assembler } from '../src/asm/assembler';

describe('assembler basics', () => {
  it('assembles the canonical LED experiment program', () => {
    const asm = new Assembler();
    const r = asm.assemble(`
      ORG 2000H
      MVI A, 80H
      OUT 83H
      MVI A, 55H
      OUT 80H
      HLT
    `);
    expect(r.errors).toEqual([]);
    expect(r.ok).toBe(true);
    expect(r.segments).toEqual([
      { start: 0x2000, bytes: [0x3e, 0x80, 0xd3, 0x83, 0x3e, 0x55, 0xd3, 0x80, 0x76] },
    ]);
    expect(r.entry).toBe(0x2000);
  });

  it('supports labels, forward references, and all number formats', () => {
    const asm = new Assembler();
    const r = asm.assemble(`
      ORG 2000H
      MVI A, 01010101B
      LOOP: DCR A
      JNZ LOOP
      JMP DONE
      DONE: HLT
    `);
    expect(r.errors).toEqual([]);
    // LOOP = 2002 (after MVI), DONE = 2009 (after DCR + JNZ + JMP)
    expect(r.segments[0]!.bytes).toEqual([
      0x3e, 0x55,
      0x3d,
      0xc2, 0x02, 0x20,
      0xc3, 0x09, 0x20,
      0x76,
    ]);
  });

  it('supports decimal and 0x hex and character literals', () => {
    const asm = new Assembler();
    const r = asm.assemble(`
      ORG 2000H
      MVI B, 65
      MVI C, 0x1F
      MVI D, 'A'
      HLT
    `);
    expect(r.errors).toEqual([]);
    expect(r.segments[0]!.bytes).toEqual([0x06, 65, 0x0e, 0x1f, 0x16, 0x41, 0x76]);
  });

  it('EQU and symbol references', () => {
    const asm = new Assembler();
    const r = asm.assemble(`
      PORTA EQU 80H
      CTRL  EQU 83H
      ORG 2000H
      MVI A, 80H
      OUT CTRL
      OUT PORTA
      HLT
    `);
    expect(r.errors).toEqual([]);
    expect(r.segments[0]!.bytes).toEqual([0x3e, 0x80, 0xd3, 0x83, 0xd3, 0x80, 0x76]);
  });

  it('DB / DW / DS directives', () => {
    const asm = new Assembler();
    const r = asm.assemble(`
      ORG 2100H
      DB 01H, 02H, 03H
      DB "HI"
      DW 1234H
      DS 4
      HLT
    `);
    expect(r.errors).toEqual([]);
    expect(r.segments[0]!.bytes).toEqual([
      0x01, 0x02, 0x03,
      0x48, 0x49,
      0x34, 0x12,
      0x00, 0x00, 0x00, 0x00,
      0x76,
    ]);
  });

  it('multiple ORG segments', () => {
    const asm = new Assembler();
    const r = asm.assemble(`
      ORG 2000H
      JMP MAIN
      ORG 2100H
      MAIN: HLT
    `);
    expect(r.errors).toEqual([]);
    expect(r.segments).toEqual([
      { start: 0x2000, bytes: [0xc3, 0x00, 0x21] },
      { start: 0x2100, bytes: [0x76] },
    ]);
  });

  it('bare label on its own line (no colon)', () => {
    const asm = new Assembler();
    const r = asm.assemble(`
      ORG 2000H
      START
      MVI A, 05H
      JMP START
      HLT
    `);
    expect(r.errors).toEqual([]);
    // START = 2000
    expect(r.segments[0]!.bytes).toEqual([0x3e, 0x05, 0xc3, 0x00, 0x20, 0x76]);
  });

  it('comments with ; and //', () => {
    const asm = new Assembler();
    const r = asm.assemble(`
      ORG 2000H      ; trainer kit default
      MVI A, 0FFH    // all LEDs on
      HLT
    `);
    expect(r.errors).toEqual([]);
    expect(r.segments[0]!.bytes).toEqual([0x3e, 0xff, 0x76]);
  });

  it('RST and PUSH PSW / POP PSW', () => {
    const asm = new Assembler();
    const r = asm.assemble('ORG 2000H\nRST 1\nPUSH PSW\nPOP PSW\nHLT');
    expect(r.errors).toEqual([]);
    expect(r.segments[0]!.bytes).toEqual([0xcf, 0xf5, 0xf1, 0x76]);
  });
});

describe('assembler errors', () => {
  it('rejects unknown instructions with a line number', () => {
    const asm = new Assembler();
    const r = asm.assemble(`
      ORG 2000H
      MVI A, 05H
      FOO B
      HLT
    `);
    expect(r.ok).toBe(false);
    expect(r.errors.length).toBeGreaterThan(0);
    expect(r.errors[0]!.line).toBe(4); // line 1 is the empty template-literal line
    expect(r.errors[0]!.message).toMatch(/Unknown instruction/i);
  });

  it('rejects OUT with a 16-bit address', () => {
    const asm = new Assembler();
    const r = asm.assemble('ORG 2000H\nOUT 2000H\nHLT');
    expect(r.ok).toBe(false);
    expect(r.errors[0]!.message).toMatch(/8-bit port address/);
  });

  it('rejects undefined symbols', () => {
    const asm = new Assembler();
    const r = asm.assemble('ORG 2000H\nJMP NOWHERE\nHLT');
    expect(r.ok).toBe(false);
    expect(r.errors[0]!.message).toMatch(/Undefined symbol/);
  });

  it('rejects duplicate labels', () => {
    const asm = new Assembler();
    const r = asm.assemble('ORG 2000H\nX: NOP\nX: NOP\nHLT');
    expect(r.ok).toBe(false);
    expect(r.errors[0]!.message).toMatch(/Duplicate label/);
  });

  it('rejects MOV M,M', () => {
    const asm = new Assembler();
    const r = asm.assemble('MOV M, M');
    expect(r.ok).toBe(false);
    expect(r.errors[0]!.message).toMatch(/MOV M,M/);
  });

  it('rejects MVI value over 8 bits', () => {
    const asm = new Assembler();
    const r = asm.assemble('MVI A, 1FFH');
    expect(r.ok).toBe(false);
    expect(r.errors[0]!.message).toMatch(/fit in 8 bits/);
  });

  it('rejects invalid register names', () => {
    const asm = new Assembler();
    const r = asm.assemble('MOV X, A');
    expect(r.ok).toBe(false);
    expect(r.errors[0]!.message).toMatch(/not a register/);
  });

  it('rejects RST 8', () => {
    const asm = new Assembler();
    const r = asm.assemble('RST 8');
    expect(r.ok).toBe(false);
    expect(r.errors[0]!.message).toMatch(/0–7/);
  });
});

describe('listing', () => {
  it('records addresses and bytes per line', () => {
    const asm = new Assembler();
    const r = asm.assemble('ORG 2000H\nMVI A, 55H\nOUT 80H\nHLT');
    const withAddr = r.listing.filter((l) => l.addr !== null);
    expect(withAddr).toEqual([
      { line: 2, addr: 0x2000, bytes: [0x3e, 0x55], text: 'MVI A, 55H' },
      { line: 3, addr: 0x2002, bytes: [0xd3, 0x80], text: 'OUT 80H' },
      { line: 4, addr: 0x2004, bytes: [0x76], text: 'HLT' },
    ]);
  });
});

describe('instance reuse', () => {
  it('re-assembling keeps the entry from the first ORG (pass 1 resets passNum)', () => {
    const asm = new Assembler();
    const first = asm.assemble('ORG 2000H\nMVI A, 80H\nHLT');
    expect(first.entry).toBe(0x2000);

    // The store reuses one Assembler across edits. The second assemble must
    // still resolve the entry from the first ORG — pass 1 has to reset
    // passNum, or the ORG handler skips itself and entry comes back null.
    const second = asm.assemble('ORG 3000H\nMVI A, 80H\nHLT');
    expect(second.entry).toBe(0x3000);
  });

  it('re-assembling does not duplicate errors or phantom-fail forward references', () => {
    const asm = new Assembler();
    asm.assemble('NOP');

    // A forward reference is resolved by pass 1's second walk; with passNum
    // stuck at 2 the pass-1 dummy-lookup guard is off and it would error.
    const fwd = asm.assemble('ORG 2000H\nJMP DONE\nDONE: HLT');
    expect(fwd.errors).toEqual([]);
    expect(fwd.ok).toBe(true);

    // Pass-1 diagnostics must stay suppressed — an error is recorded once,
    // not once per pass.
    asm.assemble('NOP');
    const bad = asm.assemble('MVI A, ZZ\nHLT');
    expect(bad.ok).toBe(false);
    expect(bad.errors).toEqual([{ line: 1, message: 'Undefined symbol "ZZ".' }]);
  });

  it('re-assembling on the same instance does not append to the previous program', () => {
    const asm = new Assembler();
    const first = asm.assemble('MVI A, 11H\nOUT 80H\nHLT');
    expect(first.ok).toBe(true);
    expect(first.segments[0]!.bytes).toHaveLength(5);

    const second = asm.assemble('MVI A, 66H\nOUT 82H\nHLT');
    expect(second.ok).toBe(true);
    expect(second.segments).toHaveLength(1);
    expect(second.segments[0]!.bytes).toEqual([0x3e, 0x66, 0xd3, 0x82, 0x76]);
    expect(second.listing.map((l) => l.line)).toEqual([1, 2, 3]);
    // A previously-failing assembly must not leak errors into a later one.
    asm.assemble('BOGUS');
    const third = asm.assemble('NOP');
    expect(third.ok).toBe(true);
    expect(third.errors).toHaveLength(0);
    expect(third.segments[0]!.bytes).toEqual([0x00]);
  });

  it('each assemble returns a fresh listing array (UI memo identity)', () => {
    const asm = new Assembler();
    const first = asm.assemble('MVI A, 11H\nOUT 80H\nHLT');
    const second = asm.assemble('MVI A, 66H\nOUT 82H\nHLT');

    // The store's listing is a useMemo dependency in CodePanel: a reused array
    // reference never invalidates the memo, so the opcode column keeps showing
    // the previous program's bytes after re-assembly.
    expect(second.listing).not.toBe(first.listing);
    expect(second.listing.map((l) => ({ line: l.line, addr: l.addr, bytes: l.bytes }))).toEqual([
      { line: 1, addr: 0, bytes: [0x3e, 0x66] },
      { line: 2, addr: 2, bytes: [0xd3, 0x82] },
      { line: 3, addr: 4, bytes: [0x76] },
    ]);
  });
});

describe('assembler label/expression resolution', () => {
  it('resolves a forward-referenced ORG through an EQU (label addresses follow)', () => {
    const asm = new Assembler();
    const r = asm.assemble(`
      ORG LOAD
      LOAD EQU 8000H
      START: MVI A, 1
      JMP START
    `);
    expect(r.errors).toEqual([]);
    expect(r.ok).toBe(true);
    // Code placed at 8000H and START resolves to 8000H, not 0000H.
    expect(r.segments).toEqual([{ start: 0x8000, bytes: [0x3e, 0x01, 0xc3, 0x00, 0x80] }]);
    expect(r.symbols.START).toBe(0x8000);
  });

  it('a label made of hex digits resolves as a label, not a number', () => {
    const asm = new Assembler();
    const r = asm.assemble(`
      ORG 2000H
      FEEDH: MVI A, 1
      JMP FEEDH
    `);
    expect(r.errors).toEqual([]);
    expect(r.ok).toBe(true);
    // JMP must encode the label's address 2000H, not the number 0xFEED.
    expect(r.segments[0]!.bytes).toEqual([0x3e, 0x01, 0xc3, 0x00, 0x20]);
    expect(r.symbols.FEEDH).toBe(0x2000);
  });

  it('letter-leading hex literals are accepted as hex numbers', () => {
    const asm = new Assembler();
    const r = asm.assemble('MVI A, FEH');
    expect(r.errors).toEqual([]);
    // FFH/FEH etc. are accepted (educational kits write them this way);
    // a defined label still wins over the same-looking hex (see below).
    expect(r.segments[0]!.bytes).toEqual([0x3e, 0xfe]);

    const r2 = asm.assemble('MVI A, FFH\nOUT 82H');
    expect(r2.errors).toEqual([]);
    expect(r2.segments[0]!.bytes).toEqual([0x3e, 0xff, 0xd3, 0x82]);
  });

  it('a label still wins over a letter-leading hex literal in EQU operands', () => {
    const asm = new Assembler();
    const r = asm.assemble(`
      ORG 2000H
      FEEDH: NOP
      X EQU FEEDH
      JMP X
    `);
    expect(r.errors).toEqual([]);
    // X must be the label address 2000H, not the number 0xFEED.
    expect(r.symbols.X).toBe(0x2000);
  });

  it('DS with a forward-referenced EQU size keeps later labels aligned', () => {
    const asm = new Assembler();
    const r = asm.assemble(`
      ORG 2000H
      BUF: DS SIZE
      SIZE EQU 10H
      START: NOP
      JMP START
    `);
    expect(r.errors).toEqual([]);
    expect(r.ok).toBe(true);
    // START must sit after the 16-byte buffer at 2010H.
    expect(r.symbols.START).toBe(0x2010);
    expect(r.segments).toEqual([
      { start: 0x2000, bytes: Array(16).fill(0) },
      { start: 0x2010, bytes: [0x00, 0xc3, 0x10, 0x20] }, // NOP; JMP START → 2010H
    ]);
  });
});
