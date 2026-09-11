# Architecture

MicroLab 8085 is a modular hardware simulation platform. The CPU knows
nothing about LEDs or ADCs; the UI knows nothing about opcodes. Everything
meets through three small abstractions: **Component/Pin**, **IoBus**, and
**Machine**.

## Module map

```
src/
├── cpu/
│   ├── isa.ts        8085 opcode table: size, T-states, exec, disassembly
│   └── cpu.ts        register file, flags, step()
├── asm/
│   └── assembler.ts  two-pass assembler (pass 1 labels, pass 2 encode)
├── core/
│   ├── types.ts      Component, Peripheral, Pin, Connection interfaces
│   ├── circuit.ts    Circuit: components + wires + signal propagation
│   ├── memory.ts     64 KB RAM with changed-cell tracking
│   └── ioBus.ts      256-address I/O space, registration + conflicts
├── system/
│   └── machine.ts    Machine: CPU + memory + io + circuit + run loop
├── components/       one file per device, all shaped the same way
│   ├── registry.ts   ComponentMeta registry — the extension point
│   └── *.ts          i8255, ledBank, dipSwitches, sevenSegment, keypad,
│                     lcd, adc0808, dac0808, sensors, scope
├── experiments.ts    the 8 prebuilt labs (ProjectFile + metadata)
├── projectLoad.ts    instantiate a ProjectFile into a Machine
├── diagnostics.ts    the "Why isn't it working?" checklist
├── store/labStore.ts zustand store — the ONLY bridge to React
└── components/ui/    React panels + SVG circuit canvas
```

## The interfaces

```ts
// core/types.ts — every device implements this
interface Component {
  id; type; label; x; y;
  getPinDefs(): PinDef[];          // pins shown on the canvas
  getPinDir(pinId): 'in' | 'out';  // effective direction right now
  getPin(pinId): Pin;              // { digital: 0|1, analog?: number }
  onPinChange(pinId): void;        // the engine calls this on real changes
  tick(tstates: number): void;     // advance internal time
  reset(): void;
  getConfig(): object; setConfig(cfg): void;   // for project save/load
  getProperties(): PropertyDescriptor[];       // inspector schema
}

// A Component that also owns I/O addresses (IN/OUT reachable)
interface Peripheral extends Component {
  baseAddress: number; addressCount: number;
  ioRead(addr): number; ioWrite(addr, value): void;
}
```

Nothing else is required. The 8255 is a Peripheral; an LED bank is a plain
Component; both appear on the canvas and save into projects identically.

## Execution model

```
Assembler ──segments──▶ Memory + entryPoint
                            │
                 Machine.stepInstruction()
                   1. cpu.step()        ← executes one instruction,
                   2. tickPeripherals()   IN/OUT call io.ioRead/ioWrite,
                   3. circuit.propagate() T-states accumulate
                            │
                       Circuit wires
                            │
                  onPinChange(dst) when a value actually changed
                            │
                  device updates (LED lights, scope records, …)
```

`propagate()` copies each wire's source value (digital + analog) to its
destination and fires `onPinChange` **only when the value changed** — this
is what makes the scope's traces meaningful and stops feedback loops.
Rules, in evaluation order:

- **out → in**: copy the value, notify the destination.
- **in → in** (nobody drives the net): pull both ends to 0 (digital and
  analog), notify both.
- **out → out**: contention — nothing changes (diagnostics flags it).
- Repeat until stable, bounded at 8 passes (oscillating nets would be
  reported, not hang the tab).

Peripherals that need time (the ADC's 64-clock conversion, the scope's
time base) implement `tick(tstates)`; the Machine feeds them the T-states
each instruction consumed, so a conversion takes the same wall-of-sim-time
it would on real hardware at ~500 kHz internal clock.

## State management

The `Machine` is a **mutable singleton** at module scope in `labStore.ts`.
React never holds it in state; every mutation bumps a `version` counter in
the zustand store, and each panel re-reads live values from the machine on
render. This keeps one 64 KB memory + register file + circuit graph out of
React's reconciliation path — running at "max" speed executes hundreds of
thousands of instructions per frame without copying anything.

The displayed state is therefore *always* the simulation state. There is no
path where the UI shows something the engine didn't produce.

## Projects

`ProjectFile` (see README) is the one serialization format: save/load in
localStorage, export/import as a file, and the prebuilt experiments are
literally the same shape. `src/projectLoad.ts` turns a file into a live
bench — it is shared by the store and the test suite, so what a test
executes is exactly what a click in the UI loads.

## Extending

**A new passive device** (motor, relay, buzzer…): implement `Component`,
register a `ComponentMeta` in `components/registry.ts`, optionally add a
card body in `ui/bodies.tsx`. No other file changes.

**A new I/O-mapped chip** (8253 timer, 8251 USART…): also implement
`Peripheral`. The IoBus and CPU already know how to route `IN`/`OUT` to
whatever registers itself; conflicts with existing windows are refused and
surface in the I/O map and diagnostics.

**A new experiment**: append an `Experiment` to `src/experiments.ts` — a
ProjectFile plus explanation/expected text. Write the test alongside it in
`tests/experiments.test.ts` so it can never silently break.

## Testing strategy

- `tests/cpu.test.ts` — every instruction class, flags, timing.
- `tests/assembler.test.ts` — syntax, constants, directives, error lines.
- `tests/i8255.test.ts`, `components.test.ts`, `adc.test.ts`,
  `dac.test.ts` — device physics up to CPU-driven programs.
- `tests/integration.test.ts` — full pipeline 8085→8255→LED etc.
- `tests/experiments.test.ts` — all 8 prebuilt labs, executed end-to-end.
- `tests/diagnostics.test.ts` — the checklist fires on real failure states.
