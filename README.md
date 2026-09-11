# MicroLab 8085 — Virtual 8085 Microprocessor Interfacing Laboratory

A browser-based virtual laboratory where students write 8085 assembly, wire
peripherals pin-to-pin on a circuit canvas, and watch real simulated
hardware respond. It is **not** a code runner with pictures: every LED that
lights, every waveform on the scope, every character on the LCD derives from
the simulated signal path

```
8085 assembly → assembler → 8085 CPU → I/O bus → peripheral → wires → virtual hardware → visible output
```

## Highlights

- **Full 8085 CPU** — all 251 valid opcode encodings (the five undefined
  opcodes are rejected like on real silicon), correct S/Z/AC/P/CY flags,
  T-state timing per instruction, RIM/SIM included.
- **Two-pass assembler** — labels, hex/decimal/binary/char constants,
  comments, `ORG` / `DB` / `DW` / `EQU`, and line-numbered errors.
- **Modular hardware platform** — the CPU knows nothing about peripherals;
  everything is a `Component` with pins, registered in one registry. Twelve
  components ship today, more can be added without touching the CPU.
- **Visual pin-to-pin wiring** — click a pin, click a destination; shift-click
  to wire an 8-bit bus in one gesture. Active signals are highlighted live.
- **Event-driven circuit engine** — digital *and* analog values propagate
  across wires; in-in nets are pulled low, output contention is detected.
- **I/O address space** — `IN`/`OUT` route to whichever peripheral owns the
  address; conflicts are refused and displayed.
- **Oscilloscope** — probe up to 4 channels (digital or analog) against a
  T-state time base; watch control pulses, EOC handshakes and DAC waveforms.
- **8 prebuilt experiments** — one click loads a wired circuit *and* a
  working program, from blinking LEDs to an LM35 thermometer.
- **"Why isn't it working?"** — a live checklist that catches missing control
  words, unwired control pins, output conflicts, tight loops and more.
- **Project save/load** — whole bench (circuit + wiring + program) as JSON,
  in localStorage or as a downloadable file.

## Run it

```bash
npm install
npm run dev        # http://localhost:5173
```

Production build (static site — host it anywhere):

```bash
npm run build      # emits dist/
npm run preview
```

Tests (158 of them — CPU, assembler, every peripheral, every experiment):

```bash
npm test
npm run test:watch
```

## Quick start: the LED experiment

1. Open the app. In the **Experiments** panel click **Load** on
   *“1 · LEDs on Port A”* — it wires an 8255 to an LED bank and loads the
   program.
2. Press **Space** (or ▶ Run). The LEDs light pattern `01010101` (55H).
3. Open the **Why isn't it working?** panel: it should be all ✓.
4. Try breaking it: delete a wire, rerun, and watch the checklist explain.

## The interface

```
┌──────────────────────────────────────────────────────────────────────┐
│ Toolbar: Assemble ▶Run ⏸Pause ⏭Step ↺Reset Speed Projects Export    │
├───────────────┬───────────────────────────────┬──────────────────────┤
│ Code editor   │                               │ Experiments          │
│ Registers+flags│      Circuit canvas          │ Components palette   │
│ Memory        │  (cards, pins, live wires)    │ Inspector            │
│               │                               │ I/O map              │
├───────────────┴───────────────────────────────┤ Diagnostics          │
│ Console (assembler/build/simulation messages) │                      │
└──────────────────────────────────────────────────────────────────────┘
```

**Keyboard shortcuts** — `Space` Run/Pause · `F10` Step · `R` Reset ·
`Ctrl+Enter` Assemble · `Ctrl+S` Save project · `Delete` delete selected
component/wire · `Esc` cancel pending wire / close dialog.

## Supported instructions

The complete 8085 instruction set: data transfer (`MOV MVI LDA STA LHLD
SHLD LDAX STAX XCHG`), arithmetic (`ADD ADI ADC ACI SUB SUI SBB SBI INR DCR
INX DCX DAD`), logical (`ANA ANI ORA ORI XRA XRI CMA CMC STC CMP CPI RLC
RRC RAL RAR`), branching (`JMP JC JNC JZ JNZ JP JM JPE JPO CALL CC CNC CZ
CNZ CP CM CPE CPO RET RC RNC RZ RNZ RP RM RPE RPO RST PCHL`), stack
(`PUSH POP XTHL SPHL`), I/O (`IN OUT`), machine control (`NOP HLT EI DI`)
and the 8085-specific `RIM SIM`. See [docs/8085.md](docs/8085.md).

## Supported peripherals

| Component | Pins | Role |
|---|---|---|
| 8255 PPI | PA0-7, PB0-7, PC0-7 | 3 parallel ports, Mode 0 + BSR, programmable base address |
| LED bank | D0-7 | 8 LEDs, common-anode option |
| DIP switches | S0-7 | 8 manual toggles |
| 7-segment | a-g, dp | one digit, common-anode option |
| Keypad 4×4 | R0-3 (in), C0-3 (out) | matrix scan, hex keys |
| LCD 16×2 | D0-7, RS, RW, EN | HD44780 subset, latches on EN falling edge |
| ADC0808 | IN0-7, ADD A/B/C, ALE, START, OE, EOC, D0-7 | 8-channel 8-bit SAR, 64-clock conversion |
| DAC0808 | D0-7, OUT | R-2R ladder, Vout = code/256 × Vref |
| Potentiometer | OUT | 0-5 V knob |
| LM35 sensor | OUT | 10 mV/°C |
| Light sensor | OUT | LDR divider, log response |
| Oscilloscope | CH1-4 | 4-channel trace, T-state time base |

Details, pin maps and documented simplifications:
[docs/peripherals.md](docs/peripherals.md) · [docs/8255.md](docs/8255.md).

## The I/O system

The 8085's 256-address I/O space is managed by an `IoBus`. Peripherals
register a window (the 8255: 4 addresses, e.g. 80H-83H). `OUT 80H` routes
the byte to the owner of 80H; `IN 81H` reads it. Overlapping registrations
are refused and shown in the I/O map panel and diagnostics.

## Adding a new peripheral

1. Create `src/components/myThing.ts` implementing `Component` (pins,
   `onPinChange`, `tick`, `reset`, `getConfig`/`setConfig`, …) — copy a
   small one like `ledBank.ts` to start.
2. Export a `ComponentMeta` and register it in `src/components/registry.ts`.
3. That's it for non-mapped devices. To make it `IN`/`OUT`-addressable,
   also implement the `Peripheral` interface (`baseAddress`, `addressCount`,
   `ioRead`, `ioWrite`) — the CPU and I/O bus need no changes.
4. Optionally add a card body in `src/components/ui/bodies.tsx` and tests.

The full walkthrough with code: [docs/architecture.md](docs/architecture.md).

## Project file format

Save/Load/Export use one JSON shape (see `src/projectLoad.ts`):

```json
{
  "format": "microlab-8085-project",
  "version": 1,
  "name": "LED Experiment",
  "source": "        ORG 2000H\n        MVI A,80H\n…",
  "components": [
    { "type": "i8255", "label": "8255 PPI", "x": 60, "y": 100,
      "config": { "baseAddress": 128 } }
  ],
  "connections": [
    { "fromIndex": 0, "fromPin": "PA0", "toIndex": 1, "toPin": "D0" }
  ]
}
```

## Known limitations (honest ones)

- **8255 Mode 1/2 (handshake I/O) is not simulated** — Mode 0 and the
  bit-set/reset mode are complete; a Mode 1/2 control word is accepted but
  flagged, with a console warning.
- **Multi-driver nets are not detected during simulation** — two outputs on
  one net silently leave it unchanged (diagnostics flags out→out wires).
- **ADC internal clock** is derived from CPU T-states (~500 kHz); the real
  chip wants an external clock on its CLK pin.
- **One analog domain**: all analog pins share a 0-5 V scale; no negative
  voltages, no rail-to-rail op-amp modeling. DAC output is an ideal
  I-to-V conversion (code/256 × Vref, i.e. 255/256 at full code — one LSB
  short, like the real chip).
- **Oscilloscope has no trigger** — it shows the most recent window.
- LCD: CGRAM custom characters and 4-bit mode are not simulated (warned).

## Documentation index

- [docs/architecture.md](docs/architecture.md) — modules, data flow, engine
  semantics, how to extend
- [docs/8085.md](docs/8085.md) — instruction set, flags, timing, debugger
- [docs/8255.md](docs/8255.md) — control word, modes, wiring recipes
- [docs/peripherals.md](docs/peripherals.md) — every component in detail
- [docs/experiments.md](docs/experiments.md) — the 8 prebuilt labs
