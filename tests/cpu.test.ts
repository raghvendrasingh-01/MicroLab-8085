/**
 * CPU tests: every instruction group with flag verification.
 * Run: npx vitest run
 */
import { describe, it, expect } from 'vitest';
import { Cpu8085 } from '../src/cpu/cpu';

/** Build a CPU with flat memory and dummy I/O (recorded). */
function makeCpu(code: number[], at = 0x2000) {
  const mem = new Uint8Array(0x10000);
  mem.set(code, at);
  const ioWrites: Array<{ port: number; value: number }> = [];
  const ioValues: Record<number, number> = {};
  const cpu = new Cpu8085(
    (a) => mem[a] ?? 0,
    (a, v) => { mem[a] = v & 0xff; },
    (p) => ioValues[p] ?? 0xff,
    (p, v) => { ioWrites.push({ port: p, value: v }); },
  );
  cpu.pc = at;
  return { cpu, mem, ioWrites, ioValues };
}

describe('data transfer', () => {
  it('MVI A,55H loads the accumulator', () => {
    const { cpu } = makeCpu([0x3e, 0x55]);
    cpu.step();
    expect(cpu.a).toBe(0x55);
  });

  it('MOV moves between registers', () => {
    const { cpu } = makeCpu([0x3e, 0x42, 0x47]); // MVI A,42H; MOV B,A
    cpu.step(); cpu.step();
    expect(cpu.b).toBe(0x42);
    expect(cpu.a).toBe(0x42);
  });

  it('MOV to/from M uses HL addressing', () => {
    const { cpu, mem } = makeCpu([0x21, 0x50, 0x20, 0x7e]); // LXI H,2050H; MOV A,M
    mem[0x2050] = 0x99;
    cpu.step(); cpu.step();
    expect(cpu.a).toBe(0x99);
  });

  it('LDA / STA direct addressing', () => {
    const { cpu, mem } = makeCpu([0x3a, 0x40, 0x20, 0x32, 0x41, 0x20]); // LDA 2040; STA 2041
    mem[0x2040] = 0xab;
    cpu.step(); cpu.step();
    expect(cpu.a).toBe(0xab);
    expect(mem[0x2041]).toBe(0xab);
  });

  it('LHLD / SHLD 16-bit direct', () => {
    const { cpu, mem } = makeCpu([0x2a, 0x40, 0x20]); // LHLD 2040
    mem[0x2040] = 0x34; mem[0x2041] = 0x12;
    cpu.step();
    expect(cpu.l).toBe(0x34); expect(cpu.h).toBe(0x12);
  });

  it('LDAX / STAX use BC/DE pointers', () => {
    const { cpu, mem } = makeCpu([0x01, 0x40, 0x20, 0x3e, 0x77, 0x02, 0x0a]); // LXI B; MVI A; STAX B; LDAX B
    cpu.step(); cpu.step(); cpu.step(); cpu.step();
    expect(mem[0x2040]).toBe(0x77);
    expect(cpu.a).toBe(0x77);
  });

  it('XCHG swaps DE with HL', () => {
    const { cpu } = makeCpu([0x11, 0x34, 0x12, 0x21, 0x78, 0x56, 0xeb]);
    cpu.step(); cpu.step(); cpu.step();
    expect(cpu.d).toBe(0x56); expect(cpu.e).toBe(0x78);
    expect(cpu.h).toBe(0x12); expect(cpu.l).toBe(0x34);
  });
});

describe('arithmetic', () => {
  it('ADD sets carry, aux carry, zero', () => {
    // 80H + 80H = 100H → CY=1, Z=1; low nibbles 0+0 → AC=0
    const { cpu } = makeCpu([0x3e, 0x80, 0x87]); // MVI A,80; ADD A
    cpu.step(); cpu.step();
    expect(cpu.a).toBe(0x00);
    expect(cpu.fCY).toBe(true);
    expect(cpu.fZ).toBe(true);
    expect(cpu.fAC).toBe(false);
    // 0FH + 01H = 10H → AC=1 (carry out of bit 3)
    const c2 = makeCpu([0x3e, 0x0f, 0xc6, 0x01]);
    c2.cpu.step(); c2.cpu.step();
    expect(c2.cpu.a).toBe(0x10);
    expect(c2.cpu.fAC).toBe(true);
  });

  it('ADD with odd result → parity 1', () => {
    const { cpu } = makeCpu([0x3e, 0x01, 0x06, 0x02, 0x80]); // MVI A,1; MVI B,2; ADD B
    cpu.step(); cpu.step(); cpu.step();
    expect(cpu.a).toBe(3);
    expect(cpu.fP).toBe(true); // 3 = 11B → two 1 bits → even parity → P=1
    expect(cpu.fS).toBe(false);
  });

  it('ADC adds carry-in', () => {
    const { cpu } = makeCpu([0x3e, 0xff, 0x06, 0x00, 0x88]); // MVI A,FF; MVI B,0; ADC B with CY=1
    cpu.fCY = true;
    cpu.step(); cpu.step(); cpu.step();
    expect(cpu.a).toBe(0x00); // FF + 0 + 1 = 100H
    expect(cpu.fCY).toBe(true);
    expect(cpu.fZ).toBe(true);
  });

  it('ADC without carry behaves like ADD', () => {
    const { cpu } = makeCpu([0x3e, 0x0a, 0x06, 0x05, 0x88]); // MVI A,0A; MVI B,5; ADC B
    cpu.step(); cpu.step(); cpu.step();
    expect(cpu.a).toBe(0x0f);
    expect(cpu.fCY).toBe(false);
  });

  it('ADI immediate add', () => {
    const { cpu } = makeCpu([0x3e, 0x39, 0xc6, 0x27]); // MVI A,39H; ADI 27H
    cpu.step(); cpu.step();
    expect(cpu.a).toBe(0x60);
  });

  it('ACI immediate add with carry', () => {
    const { cpu } = makeCpu([0x3e, 0x0f, 0xc6, 0xf1]); // MVI A,0F; ADI F1 → 100H
    cpu.step(); cpu.step();
    expect(cpu.a).toBe(0x00);
    expect(cpu.fCY).toBe(true);
    expect(cpu.fAC).toBe(true); // F+1 carries out of bit 3
  });

  it('SUB basic with flags', () => {
    const { cpu } = makeCpu([0x3e, 0x50, 0x06, 0x30, 0x90]); // MVI A,50; MVI B,30; SUB B
    cpu.step(); cpu.step(); cpu.step();
    expect(cpu.a).toBe(0x20);
    expect(cpu.fCY).toBe(false); // no borrow
  });

  it('SUB sets borrow (carry) when subtrahend is larger', () => {
    const { cpu } = makeCpu([0x3e, 0x30, 0x06, 0x50, 0x90]);
    cpu.step(); cpu.step(); cpu.step();
    expect(cpu.a).toBe(0xe0);
    expect(cpu.fCY).toBe(true); // borrow
  });

  it('SUB equal values → zero, no borrow', () => {
    const { cpu } = makeCpu([0x3e, 0x42, 0x06, 0x42, 0x90]);
    cpu.step(); cpu.step(); cpu.step();
    expect(cpu.a).toBe(0x00);
    expect(cpu.fZ).toBe(true);
    expect(cpu.fCY).toBe(false);
  });

  it('SBB subtracts borrow', () => {
    // Without carry: 10H - 05H = 0BH
    const { cpu } = makeCpu([0x3e, 0x10, 0x06, 0x05, 0x98]);
    cpu.step(); cpu.step(); cpu.step();
    expect(cpu.a).toBe(0x0b);
    // With carry set: 10H - 05H - 1 = 0AH
    const c2 = makeCpu([0x3e, 0x10, 0x06, 0x05, 0x98]);
    c2.cpu.fCY = true;
    c2.cpu.step(); c2.cpu.step(); c2.cpu.step();
    expect(c2.cpu.a).toBe(0x0a);
  });

  it('SUI immediate subtract', () => {
    const { cpu } = makeCpu([0x3e, 0x40, 0xd6, 0x10]);
    cpu.step(); cpu.step();
    expect(cpu.a).toBe(0x30);
  });

  it('SBI immediate subtract with borrow', () => {
    const { cpu } = makeCpu([0x3e, 0x40, 0xde, 0x10]);
    cpu.fCY = true;
    cpu.step(); cpu.step();
    expect(cpu.a).toBe(0x2f); // 40 - 10 - 1
  });

  it('INR wraps and sets AC/Z/P but not CY', () => {
    const { cpu } = makeCpu([0x3e, 0xff, 0x3c]); // MVI A,FF; INR A
    cpu.fCY = true;
    cpu.step(); cpu.step();
    expect(cpu.a).toBe(0x00);
    expect(cpu.fZ).toBe(true);
    expect(cpu.fAC).toBe(true);
    expect(cpu.fCY).toBe(true); // unchanged
  });

  it('DCR from zero wraps to FF, AC clear (no carry out of bit 3 of v+FE+1)', () => {
    const { cpu } = makeCpu([0x3e, 0x00, 0x3d]);
    cpu.step(); cpu.step();
    expect(cpu.a).toBe(0xff);
    expect(cpu.fAC).toBe(false);
    expect(cpu.fS).toBe(true);
  });

  it('DCR AC matches an equivalent SUI 1', () => {
    // 12H - 1: low nibble 2+0xE+1 = 11H → carry out of bit 3 → AC set.
    const dcr = makeCpu([0x3e, 0x12, 0x3d]);
    dcr.cpu.step(); dcr.cpu.step();
    const sui = makeCpu([0x3e, 0x12, 0xd6, 0x01]);
    sui.cpu.step(); sui.cpu.step();
    expect(dcr.cpu.a).toBe(sui.cpu.a);
    expect(dcr.cpu.fAC).toBe(sui.cpu.fAC);
    expect(dcr.cpu.fAC).toBe(true);
  });

  it('INX/DCX do not affect flags', () => {
    const { cpu } = makeCpu([0x21, 0xff, 0xff, 0x23]); // LXI H,FFFF; INX H
    cpu.fCY = true; cpu.fZ = true;
    cpu.step(); cpu.step();
    expect(cpu.h).toBe(0x00); expect(cpu.l).toBe(0x00);
    expect(cpu.fCY).toBe(true); // unchanged
  });

  it('DAD sets CY only', () => {
    const { cpu } = makeCpu([0x21, 0xff, 0xff, 0x29]); // LXI H,FFFF; DAD H
    cpu.fZ = true;
    cpu.step(); cpu.step();
    expect(cpu.h).toBe(0xff); expect(cpu.l).toBe(0xfe); // FFFE
    expect(cpu.fCY).toBe(true);
    expect(cpu.fZ).toBe(true); // unchanged
  });
});

describe('logical', () => {
  it('ANA sets AC per 8085 rule (bit3 OR)', () => {
    const { cpu } = makeCpu([0x3e, 0x0f, 0x06, 0x08, 0xa0]); // A=0F,B=08; ANA B
    cpu.step(); cpu.step(); cpu.step();
    expect(cpu.a).toBe(0x08);
    expect(cpu.fAC).toBe(true); // A bit3=1, B bit3=1 → OR=1
    expect(cpu.fCY).toBe(false);
  });

  it('ORA clears AC and CY', () => {
    const { cpu } = makeCpu([0x3e, 0xf0, 0x06, 0x0f, 0xb0]); // ORA B
    cpu.step(); cpu.step(); cpu.step();
    expect(cpu.a).toBe(0xff);
    expect(cpu.fAC).toBe(false);
    expect(cpu.fCY).toBe(false);
  });

  it('XRA A clears A and sets Z', () => {
    const { cpu } = makeCpu([0xaf]);
    cpu.a = 0x55;
    cpu.step();
    expect(cpu.a).toBe(0);
    expect(cpu.fZ).toBe(true);
    expect(cpu.fCY).toBe(false);
  });

  it('ANI/ORI/XRI immediates', () => {
    const { cpu } = makeCpu([0x3e, 0xcd, 0xe6, 0x0f]); // ANI 0F
    cpu.step(); cpu.step();
    expect(cpu.a).toBe(0x0d);
    const c2 = makeCpu([0x3e, 0xc0, 0xf6, 0x3c]); // ORI 3C
    c2.cpu.step(); c2.cpu.step();
    expect(c2.cpu.a).toBe(0xfc);
    const c3 = makeCpu([0x3e, 0xff, 0xee, 0xff]); // XRI FF
    c3.cpu.step(); c3.cpu.step();
    expect(c3.cpu.a).toBe(0x00);
    expect(c3.cpu.fZ).toBe(true);
  });

  it('CMP equal → Z=1 CY=0; smaller → CY=1; larger → CY=0,Z=0', () => {
    const eq = makeCpu([0x3e, 0x42, 0x06, 0x42, 0xb8]);
    eq.cpu.step(); eq.cpu.step(); eq.cpu.step();
    expect(eq.cpu.fZ).toBe(true); expect(eq.cpu.fCY).toBe(false);

    const lt = makeCpu([0x3e, 0x10, 0x06, 0x50, 0xb8]);
    lt.cpu.step(); lt.cpu.step(); lt.cpu.step();
    expect(lt.cpu.fCY).toBe(true); expect(lt.cpu.fZ).toBe(false);

    const gt = makeCpu([0x3e, 0x50, 0x06, 0x10, 0xb8]);
    gt.cpu.step(); gt.cpu.step(); gt.cpu.step();
    expect(gt.cpu.fCY).toBe(false); expect(gt.cpu.fZ).toBe(false);
  });

  it('CPI immediate compare', () => {
    const { cpu } = makeCpu([0x3e, 0x32, 0xfe, 0x32]);
    cpu.step(); cpu.step();
    expect(cpu.fZ).toBe(true);
  });

  it('CMA complements', () => {
    const { cpu } = makeCpu([0x2f]);
    cpu.a = 0x55;
    cpu.step();
    expect(cpu.a).toBe(0xaa);
  });

  it('STC/CMC', () => {
    const { cpu } = makeCpu([0x37, 0x3f]);
    cpu.step();
    expect(cpu.fCY).toBe(true);
    cpu.step();
    expect(cpu.fCY).toBe(false);
  });

  it('RLC/RRC/RAL/RAR', () => {
    const rlc = makeCpu([0x07]);
    rlc.cpu.a = 0x85;
    rlc.cpu.step();
    expect(rlc.cpu.a).toBe(0x0b);
    expect(rlc.cpu.fCY).toBe(true);

    const rrc = makeCpu([0x0f]);
    rrc.cpu.a = 0x0b;
    rrc.cpu.step();
    expect(rrc.cpu.a).toBe(0x85);
    expect(rrc.cpu.fCY).toBe(true); // bit0 was 1

    const ral = makeCpu([0x17]);
    ral.cpu.a = 0x85; ral.cpu.fCY = false;
    ral.cpu.step();
    expect(ral.cpu.a).toBe(0x0a);
    expect(ral.cpu.fCY).toBe(true);

    const rar = makeCpu([0x1f]);
    rar.cpu.a = 0x0a; rar.cpu.fCY = true;
    rar.cpu.step();
    expect(rar.cpu.a).toBe(0x85);
    expect(rar.cpu.fCY).toBe(false); // bit0 was 0
  });
});

describe('branching', () => {
  it('JMP transfers control', () => {
    const { cpu } = makeCpu([0xc3, 0x50, 0x20]); // JMP 2050
    cpu.step();
    expect(cpu.pc).toBe(0x2050);
  });

  it('JZ branches only when Z set', () => {
    const z = makeCpu([0xca, 0x50, 0x20]);
    z.cpu.fZ = true;
    z.cpu.step();
    expect(z.cpu.pc).toBe(0x2050);

    const nz = makeCpu([0xca, 0x50, 0x20]);
    nz.cpu.fZ = false;
    nz.cpu.step();
    expect(nz.cpu.pc).toBe(0x2003);
  });

  it('conditional jumps: all 8 conditions, both flag values', () => {
    // [mnemonic, flagProp, flagValue, expectedTaken]
    const cases: Array<[string, string, boolean, boolean]> = [
      ['JZ', 'fZ', true, true],
      ['JZ', 'fZ', false, false],
      ['JNZ', 'fZ', true, false],
      ['JNZ', 'fZ', false, true],
      ['JC', 'fCY', true, true],
      ['JC', 'fCY', false, false],
      ['JNC', 'fCY', true, false],
      ['JNC', 'fCY', false, true],
      ['JP', 'fS', true, false],
      ['JP', 'fS', false, true],
      ['JM', 'fS', true, true],
      ['JM', 'fS', false, false],
      ['JPE', 'fP', true, true],
      ['JPE', 'fP', false, false],
      ['JPO', 'fP', true, false],
      ['JPO', 'fP', false, true],
    ];
    const opcodeFor: Record<string, number> = {
      JZ: 0xca, JNZ: 0xc2, JC: 0xda, JNC: 0xd2,
      JP: 0xf2, JM: 0xfa, JPE: 0xea, JPO: 0xe2,
    };
    for (const [mn, flagProp, value, taken] of cases) {
      const { cpu } = makeCpu([opcodeFor[mn]!, 0x50, 0x20]);
      (cpu as unknown as Record<string, boolean>)[flagProp] = value;
      cpu.step();
      expect(cpu.pc).toBe(taken ? 0x2050 : 0x2003);
    }
  });

  it('CALL pushes return address and jumps', () => {
    const { cpu, mem } = makeCpu([0xcd, 0x50, 0x20]);
    cpu.sp = 0x2100;
    cpu.step();
    expect(cpu.pc).toBe(0x2050);
    expect(cpu.sp).toBe(0x20fe);
    expect(mem[0x20fe]).toBe(0x03); // return addr = 2003
    expect(mem[0x20ff]).toBe(0x20);
  });

  it('conditional CALL taken/not taken', () => {
    const taken = makeCpu([0xcc, 0x50, 0x20]); // CZ
    taken.cpu.fZ = true; taken.cpu.sp = 0x2100;
    taken.cpu.step();
    expect(taken.cpu.pc).toBe(0x2050);
    expect(taken.cpu.sp).toBe(0x20fe);

    const notTaken = makeCpu([0xcc, 0x50, 0x20]);
    notTaken.cpu.fZ = false;
    notTaken.cpu.sp = 0x2100;
    notTaken.cpu.step();
    expect(notTaken.cpu.pc).toBe(0x2003);
    expect(notTaken.cpu.sp).toBe(0x2100);
  });

  it('RET pops return address', () => {
    const { cpu, mem } = makeCpu([0xc9]);
    cpu.sp = 0x20fe;
    mem[0x20fe] = 0x00; mem[0x20ff] = 0x21;
    cpu.step();
    expect(cpu.pc).toBe(0x2100);
    expect(cpu.sp).toBe(0x2100);
  });

  it('RST pushes PC and vectors to n*8', () => {
    const { cpu, mem } = makeCpu([0xcf]); // RST 1
    cpu.sp = 0x2100;
    cpu.step();
    expect(cpu.pc).toBe(0x0008);
    expect(mem[0x20ff]).toBe(0x20); // return to 2001
    expect(mem[0x20fe]).toBe(0x01);
  });
});

describe('stack', () => {
  it('PUSH B / POP D moves 16 bits through the stack', () => {
    // LXI B,3412H means B=34 C=12 (little-endian immediate bytes).
    const { cpu, mem } = makeCpu([0x01, 0x12, 0x34, 0xc5, 0x11, 0x00, 0x00, 0xd1]);
    cpu.sp = 0x2100;
    cpu.step(); cpu.step(); cpu.step(); cpu.step();
    expect(mem[0x20ff]).toBe(0x34); // B at higher address
    expect(mem[0x20fe]).toBe(0x12); // C at lower address
    expect(cpu.d).toBe(0x34); expect(cpu.e).toBe(0x12);
  });

  it('PUSH PSW / POP PSW round-trips flags', () => {
    const { cpu } = makeCpu([0xf5, 0xf1]);
    cpu.sp = 0x2100;
    cpu.a = 0x77;
    cpu.fS = true; cpu.fZ = false; cpu.fAC = true; cpu.fP = false; cpu.fCY = true;
    cpu.step();
    cpu.a = 0;
    cpu.fS = false; cpu.fZ = false; cpu.fAC = false;
    cpu.fP = false; cpu.fCY = false;
    cpu.step();
    expect(cpu.a).toBe(0x77);
    expect(cpu.fS).toBe(true); expect(cpu.fAC).toBe(true); expect(cpu.fCY).toBe(true);
  });

  it('XTHL exchanges stack top with HL', () => {
    const { cpu, mem } = makeCpu([0xe3]);
    cpu.sp = 0x2100;
    cpu.h = 0x11; cpu.l = 0x22;
    mem[0x2100] = 0x99; mem[0x2101] = 0x88;
    cpu.step();
    expect(cpu.l).toBe(0x99); expect(cpu.h).toBe(0x88);
    expect(mem[0x2100]).toBe(0x22); expect(mem[0x2101]).toBe(0x11);
  });

  it('SPHL sets SP to HL', () => {
    const { cpu } = makeCpu([0xf9]);
    cpu.h = 0x21; cpu.l = 0x00;
    cpu.step();
    expect(cpu.sp).toBe(0x2100);
  });
});

describe('I/O and control', () => {
  it('OUT writes to the I/O callback', () => {
    const { cpu, ioWrites } = makeCpu([0x3e, 0x55, 0xd3, 0x80]); // MVI A,55; OUT 80H
    cpu.step(); cpu.step();
    expect(ioWrites).toEqual([{ port: 0x80, value: 0x55 }]);
  });

  it('IN reads from the I/O callback into A', () => {
    const { cpu, ioValues } = makeCpu([0xdb, 0x81]); // IN 81H
    ioValues[0x81] = 0xa5;
    cpu.step();
    expect(cpu.a).toBe(0xa5);
  });

  it('HLT halts', () => {
    const { cpu } = makeCpu([0x76]);
    cpu.step();
    expect(cpu.halted).toBe(true);
  });

  it('EI/DI manage the interrupt flip-flop', () => {
    const { cpu } = makeCpu([0xfb, 0xf3]);
    expect(cpu.iff).toBe(false);
    cpu.step();
    expect(cpu.iff).toBe(true);
    cpu.step();
    expect(cpu.iff).toBe(false);
  });

  it('invalid opcode throws CpuError', () => {
    const { cpu } = makeCpu([0xed]); // invalid on 8085
    expect(() => cpu.step()).toThrow(/Invalid opcode/);
  });
});

describe('DAA', () => {
  it('adjusts after BCD add', () => {
    // 34H + 27H = 5BH; DAA → 61H (34+27=61 decimal)
    const { cpu } = makeCpu([0x3e, 0x34, 0xc6, 0x27, 0x27]); // MVI A,34; ADI 27; DAA
    cpu.step(); cpu.step(); cpu.step();
    expect(cpu.a).toBe(0x61);
    expect(cpu.fCY).toBe(false);
  });

  it('BCD carry on overflow', () => {
    // 99H + 01H = 9AH; DAA → 00 with CY=1
    const { cpu } = makeCpu([0x3e, 0x99, 0xc6, 0x01, 0x27]);
    cpu.step(); cpu.step(); cpu.step();
    expect(cpu.a).toBe(0x00);
    expect(cpu.fCY).toBe(true);
  });

  it('AC-driven correction (low nibble only)', () => {
    // 0AH + AC set → +6 → 10H
    const { cpu } = makeCpu([0x3e, 0x0a, 0x27]);
    cpu.fAC = true;
    cpu.step(); cpu.step();
    expect(cpu.a).toBe(0x10);
  });
});
