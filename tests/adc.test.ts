/**
 * Phase 4 tests: analog sensors + ADC0808, from component physics up to a
 * full CPU-driven convert-and-poll program.
 */
import { describe, it, expect } from 'vitest';
import { Machine } from '../src/system/machine';
import { Assembler } from '../src/asm/assembler';
import { I8255 } from '../src/components/i8255';
import { Adc0808, ADC_CLOCK_TSTATES, CONVERSION_CLOCKS } from '../src/components/adc0808';
import { Potentiometer, TempSensor, LightSensor } from '../src/components/sensors';
import { DipSwitches } from '../src/components/dipSwitches';

/**
 * Bench: 8255 at 80H reading the ADC data bus on port A and EOC on PC4;
 * DIP switches drive ALE/START/ADD A/B/C (and OE for the gate test); a pot
 * feeds IN0. Everything is wired pin-to-pin like the canvas would.
 */
function bench() {
  const machine = new Machine();
  const ppi = new I8255('ppi', 40, 40);
  const adc = new Adc0808('adc', 400, 40);
  const pot = new Potentiometer('pot', 800, 40);
  const ctl = new DipSwitches('ctl', 800, 300);
  machine.addPeripheral(ppi);
  machine.circuit.add(adc);
  machine.circuit.add(pot);
  machine.circuit.add(ctl);

  const wire = (a: string, ap: string, b: string, bp: string) =>
    machine.circuit.connect(a, ap, b, bp);

  for (let i = 0; i < 8; i++) wire('adc', `D${i}`, 'ppi', `PA${i}`);
  wire('adc', 'EOC', 'ppi', 'PC4');
  wire('pot', 'out', 'adc', 'IN0');
  wire('ctl', 'S0', 'adc', 'ALE');
  wire('ctl', 'S1', 'adc', 'START');
  wire('ctl', 'S2', 'adc', 'ADDA');
  wire('ctl', 'S3', 'adc', 'ADDB');
  wire('ctl', 'S4', 'adc', 'ADDC');

  const ctlSet = (n: number, on: boolean) => {
    ctl.setSwitch(`S${n}`, on);
    machine.circuit.propagate();
  };
  /** Latch channel 0 (ALE pulse) and start a conversion. */
  const start = () => {
    ctlSet(0, true); // ALE rising edge → latch ADD pins
    ctlSet(1, true); // START rising edge → begin
    ctlSet(0, false);
    ctlSet(1, false);
  };
  const finish = () => {
    adc.tick(ADC_CLOCK_TSTATES * CONVERSION_CLOCKS);
    machine.circuit.propagate();
  };

  return { machine, ppi, adc, pot, ctl, wire, ctlSet, start, finish };
}

/** Convert `volts` with Vref `vref` and read the byte through port A. */
const code = (volts: number, vref: number) => Math.min(255, Math.floor((volts / vref) * 256));

describe('sensors', () => {
  it('potentiometer maps position to 0–5 V and drives the pin', () => {
    const pot = new Potentiometer('p', 0, 0);
    expect(pot.volts()).toBe(0);
    pot.setLevel(50);
    expect(pot.volts()).toBeCloseTo(2.5);
    pot.setLevel(100);
    expect(pot.volts()).toBeCloseTo(5);
    expect(pot.getPin('out').analog).toBeCloseTo(5);
    expect(pot.getPin('out').digital).toBe(1);
    pot.setLevel(0);
    expect(pot.getPin('out').digital).toBe(0);
  });

  it('clamps and rounds levels', () => {
    const pot = new Potentiometer('p', 0, 0);
    pot.setLevel(1234);
    expect(pot.getLevel()).toBe(100);
    pot.setLevel(-5);
    expect(pot.getLevel()).toBe(0);
    pot.setLevel(42.7);
    expect(pot.getLevel()).toBe(43);
  });

  it('LM35 gives 10 mV/°C', () => {
    const t = new TempSensor('t', 0, 0);
    t.setLevel(100);
    expect(t.volts()).toBeCloseTo(1.0);
    t.setLevel(25);
    expect(t.volts()).toBeCloseTo(0.25);
  });

  it('LDR rises with light, log response', () => {
    const l = new LightSensor('l', 0, 0);
    expect(l.volts()).toBeLessThan(0.06); // dark ≈ 0.05 V
    l.setLevel(50);
    expect(l.volts()).toBeCloseTo(2.5); // 10 kΩ midpoint
    l.setLevel(100);
    expect(l.volts()).toBeGreaterThan(4.9); // bright ≈ 4.95 V
  });

  it('settings survive reset and round-trip through config', () => {
    const t = new TempSensor('t', 0, 0);
    t.setLevel(72);
    t.reset();
    expect(t.getLevel()).toBe(72);
    expect(t.volts()).toBeCloseTo(0.72);
    const cfg = t.getConfig();
    const t2 = new TempSensor('t2', 0, 0);
    t2.setConfig(cfg);
    expect(t2.getLevel()).toBe(72);
  });
});

describe('ADC0808 conversion physics', () => {
  it('converts a mid-scale voltage to the expected byte', () => {
    const b = bench();
    b.pot.setLevel(50); // 2.5 V
    b.machine.circuit.propagate();
    b.start();
    expect(b.adc.isConverting()).toBe(true);
    expect(b.ppi.ioRead(0x82) & 0x10).toBe(0); // EOC low through PC4
    b.finish();
    expect(b.adc.isConverting()).toBe(false);
    expect(b.adc.isEoc()).toBe(true);
    expect(b.adc.lastResult()).toBe(code(2.5, 5));
    expect(b.ppi.ioRead(0x80)).toBe(code(2.5, 5)); // data on port A
  });

  it('hits 0 at 0 V and 255 at full scale', () => {
    const b = bench();
    b.pot.setLevel(0);
    b.machine.circuit.propagate();
    b.start();
    b.finish();
    expect(b.adc.lastResult()).toBe(0);

    b.pot.setLevel(100); // exactly Vref
    b.machine.circuit.propagate();
    b.start();
    b.finish();
    expect(b.adc.lastResult()).toBe(255);
  });

  it('unwired analog input reads as 0 V', () => {
    const machine = new Machine();
    const adc = new Adc0808('adc', 0, 0);
    machine.circuit.add(adc);
    // Nothing wired to IN0-7: START straight from a switch bank.
    const ctl = new DipSwitches('ctl', 400, 0);
    machine.circuit.add(ctl);
    machine.circuit.connect('ctl', 'S1', 'adc', 'START');
    ctl.toggle('S1');
    machine.circuit.propagate();
    adc.tick(ADC_CLOCK_TSTATES * CONVERSION_CLOCKS);
    machine.circuit.propagate();
    expect(adc.lastResult()).toBe(0);
  });

  it('samples the input at START, not at completion', () => {
    const b = bench();
    b.pot.setLevel(80); // 4 V
    b.machine.circuit.propagate();
    b.start();
    b.pot.setLevel(0); // move the knob mid-conversion
    b.machine.circuit.propagate();
    b.finish();
    expect(b.adc.lastResult()).toBe(code(4, 5)); // holds the sampled value
  });

  it('START during a conversion restarts it', () => {
    const b = bench();
    b.pot.setLevel(50);
    b.machine.circuit.propagate();
    b.start();
    b.adc.tick(300); // most of the way (needs 384)
    b.ctlSet(1, true); // START high again → restart
    b.ctlSet(1, false);
    expect(b.adc.isConverting()).toBe(true);
    b.adc.tick(ADC_CLOCK_TSTATES * (CONVERSION_CLOCKS - 1));
    expect(b.adc.isConverting()).toBe(true); // one clock short
    b.adc.tick(ADC_CLOCK_TSTATES);
    expect(b.adc.isConverting()).toBe(false);
    expect(b.adc.lastResult()).toBe(code(2.5, 5));
  });

  it('ADD pins + ALE latch select the channel', () => {
    const b = bench();
    const lm = new TempSensor('lm', 1000, 40);
    b.machine.circuit.add(lm);
    b.wire('lm', 'out', 'adc', 'IN1');
    lm.setLevel(25); // 0.25 V

    b.pot.setLevel(50); // 2.5 V on IN0
    b.machine.circuit.propagate();
    b.ctlSet(2, true); // ADD A = 1 → channel 1
    b.start(); // ALE latches channel 1
    expect(b.adc.channel()).toBe(1);
    b.finish();
    expect(b.adc.lastResult()).toBe(code(0.25, 5));

    // ALE latched: changing ADD after the latch must not matter.
    b.ctlSet(2, false);
    b.machine.circuit.propagate();
    expect(b.adc.channel()).toBe(1);
  });

  it('without an ALE pulse the channel follows ADD live', () => {
    const b = bench();
    const lm = new TempSensor('lm', 1000, 40);
    b.machine.circuit.add(lm);
    b.wire('lm', 'out', 'adc', 'IN1');
    lm.setLevel(100);
    b.pot.setLevel(0);
    b.machine.circuit.propagate();
    b.ctlSet(2, true); // ADD A = 1, no ALE ever pulsed
    expect(b.adc.channel()).toBe(1);
    b.ctlSet(1, true); // START only
    b.ctlSet(1, false);
    b.finish();
    expect(b.adc.lastResult()).toBe(code(1.0, 5));
  });

  it('LM35 with Vref 2.56 V reads the temperature directly', () => {
    const b = bench();
    const lm = new TempSensor('lm', 1000, 40);
    b.machine.circuit.add(lm);
    b.wire('lm', 'out', 'adc', 'IN1');
    b.pot.setLevel(0);
    b.adc.setConfig({ vref: 2.56 });
    lm.setLevel(100);
    b.machine.circuit.propagate();
    b.ctlSet(2, true); // ADD A = 1 → channel 1
    b.start();
    b.finish();
    expect(b.adc.lastResult()).toBe(100); // 1.00 V / 2.56 V × 256
  });

  it('OE gates the data pins (strapped high, overridable)', () => {
    const b = bench();
    b.ctlSet(5, true); // drive the switch high BEFORE wiring (strap stays 1)
    b.wire('ctl', 'S5', 'adc', 'OE');
    b.machine.circuit.propagate();
    b.pot.setLevel(50);
    b.machine.circuit.propagate();
    b.start();
    b.finish();
    expect(b.adc.lastResult()).toBe(code(2.5, 5));
    expect(b.adc.getPinDir('D0')).toBe('out');
    expect(b.ppi.ioRead(0x80)).toBe(code(2.5, 5));

    b.ctlSet(5, false); // OE driven low → tristate
    expect(b.adc.getPinDir('D0')).toBe('in');
    expect(b.ppi.ioRead(0x80)).toBe(0); // pulled-low net

    b.ctlSet(5, true); // OE high again → data reappears
    expect(b.ppi.ioRead(0x80)).toBe(code(2.5, 5));
  });

  it('reset returns the chip to idle with EOC high', () => {
    const b = bench();
    b.pot.setLevel(50);
    b.machine.circuit.propagate();
    b.start();
    b.machine.reset(false);
    expect(b.adc.isConverting()).toBe(false);
    expect(b.adc.isEoc()).toBe(true);
    expect(b.adc.lastResult()).toBe(0);
    expect(b.ppi.ioRead(0x80)).toBe(0); // 8255 reverts to input, net quiet
  });
});

describe('ADC through the CPU', () => {
  it('a full program: pulse START, poll EOC, read the byte', () => {
    const machine = new Machine();
    const ppi = new I8255('ppi', 40, 40);
    const adc = new Adc0808('adc', 400, 40);
    const pot = new Potentiometer('pot', 800, 40);
    machine.addPeripheral(ppi);
    machine.circuit.add(adc);
    machine.circuit.add(pot);
    for (let i = 0; i < 8; i++) machine.circuit.connect('adc', `D${i}`, 'ppi', `PA${i}`);
    machine.circuit.connect('ppi', 'PC0', 'adc', 'ALE');
    machine.circuit.connect('ppi', 'PC1', 'adc', 'START');
    machine.circuit.connect('adc', 'EOC', 'ppi', 'PC4');
    machine.circuit.connect('pot', 'out', 'adc', 'IN0');

    pot.setLevel(62); // 3.1 V → floor(3.1/5×256) = 158
    machine.circuit.propagate();

    const src = `
        MVI A,98H    ; PA in, PC upper in, PC lower out
        OUT 83H
        MVI A,03H    ; ALE=1, START=1
        OUT 82H
        MVI A,00H    ; pulse low — conversion runs
        OUT 82H
WT:     IN 82H       ; read port C
        ANI 10H      ; EOC on PC4?
        JZ WT
        IN 80H       ; the converted byte
        MOV B,A
        HLT`;
    const r = new Assembler().assemble(src);
    expect(r.ok).toBe(true);
    machine.loadProgram(r.segments, r.entry);
    machine.runState = 'running';
    let guard = 0;
    while (machine.runState === 'running' && guard++ < 50) machine.runBatch(500);
    expect(machine.runState).toBe('halted');
    expect(machine.cpu.b).toBe(code(3.1, 5));
    expect(adc.lastResult()).toBe(code(3.1, 5));
  });
});
