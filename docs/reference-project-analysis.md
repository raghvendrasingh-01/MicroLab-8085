# Reference Project Analysis — Jubin's 8085 Simulator (Debian installer)

**Reference inspected:** `/home/raghvendra-singh/8085-simulator-installer-for-debian`
**Date inspected:** 2026-09-10
**Verdict up front:** the reference repo contains **no emulator source code** — it is a
bash installer (GPLv2) that downloads Jubin's 8085 Simulator (a closed-source-from-our-
perspective Java `.jar`, GPLv2 upstream) from `github.com/8085simulator/8085simulator`.
The jar *is* installed locally at `/usr/share/8085-sim/8085Compiler.jar`, and its user
manual (`~/Downloads/8085_Documentation.pdf`) plus ~25 bundled sample `.asm` programs
were inspected to understand its behavior and feature set. No Java code was reused;
MicroLab 8085 is an independent implementation.

---

## What the reference project actually is

| Item | Contents |
|---|---|
| `install.sh` / `webinstaller.sh` | Bash scripts; `apt-get install default-jdk/jre`, `wget` the jar, create a `.desktop` launcher |
| `8085-simulator.desktop` | Desktop entry launching `java -jar /usr/share/8085-sim/8085Compiler.jar` |
| `img/8085simIcon.png` | Icon |
| `8085Compiler.jar` (downloaded) | Jubin's 8085 Simulator v2.0 (2014/2017 build) — Java Swing app |
| Bundled in the jar | ~25 sample `.asm` programs (multiply, sort, Fibonacci, 1's/2's complement, …) |

## Existing functionality (of the Java simulator, from its manual + jar contents)

1. **Preprocessor + Assembler + Simulator engine + step-wise traversal controller**
   (its own documented four-stage architecture).
2. **Assembler directives:** `# ORG`, `# DB`, `# BEGIN` (entry point), `# EQU`-style
   defines; number formats H (hex), D (decimal), B (binary), character literals.
   Comments are `//`.
3. **Disassembler**, including hand-editing hex code and Intel HEX export.
4. **Static and dynamic timing-diagram generator** — machine-cycle level timing drawn
   per instruction as you single-step.
5. **Trainer-kit emulator** — a simulated 8085 kit keyboard (RESET, EXAMINE memory,
   GO, etc.).
6. **Debugging mode** — step execution, register/memory inspection.
7. **Tools:** insert delay subroutine, interrupt service subroutine template,
   number-conversion tool.
8. **Sample program library** (~25 educational programs).

## Useful components / ideas worth taking

| Idea from reference | How MicroLab 8085 adopts it |
|---|---|
| Sample program library bundled with the app | `src/experiments/` ships working programs for every experiment |
| Assembler directives (`ORG`, `DB`, `EQU`, entry point) | Same directives supported (plus `DW`); entry point via `# BEGIN`-like `ENTRY` or the first `ORG`'s start — we use `ORG` + explicit `EQU`/`END START` style label entry |
| Number formats (H/D/B, char literals) | Supported, with clear line-numbered errors |
| Disassembler for the memory view | Memory panel shows a disassembly column next to hex |
| Step-by-step execution with register watch | Debugger with run/pause/stop/reset/step, breakpoints, speed control |
| Timing diagrams | Digital waveform viewer (Phase 5) records selected pins over time |
| Delay-subroutine helper idea | Delay routine included in example programs; UI keeps it manual (no auto-insert) |

## Limitations of the reference simulator

1. **No peripherals at all** — no 8255, no ADC/DAC, no LEDs, switches, 7-segment,
   keypad or LCD. It simulates the CPU + flat memory only.
2. **No wiring / circuit concept** — nothing analogous to pins, ports, connections.
3. **No analog domain** — no sensors, no voltages, no waveform capture of signals.
4. **Java Swing desktop UI** — heavy install (needs a JDK), not browser-based, not
   shareable as a link, no dark/light theming.
5. **No project save/load format** for circuits (nothing to save — no circuits).
6. **No educational diagnostics** — errors are assembler/parser level only.
7. Installer itself is a thin wrapper; the actual simulator is unversioned upstream
   and effectively unmaintained since ~2018.

## How MicroLab 8085 improves on it

```
Existing Simulator (Jubin's)          MicroLab 8085
─────────────────────────             ─────────────────────────────
8085 CPU emulator                     8085 CPU emulator (full 246-opcode
                                      set, cycle-accurate T-state counts)
Assembler (// comments, # directives) Assembler (standard ; and // comments,
                                      ORG/DB/DW/EQU, labels, line errors)
Flat 64K memory                       64K memory + I/O address space with
                                      conflict detection
—                                     Modular peripheral bus: every device
                                      implements one Peripheral interface
—                                     8255 PPI (Mode 0 + BSR), ADC0808,
                                      DAC0808, LED bank, DIP switches,
                                      7-segment, 4x4 keypad, 16x2 LCD,
                                      potentiometer/temperature/light sensors
—                                     Visual pin-to-pin wiring system with
                                      live signal highlighting
—                                     Event-driven circuit simulation engine
                                      (signals propagate CPU → bus →
                                      peripheral → wire → hardware)
—                                     Waveform viewer, diagnostics panel,
                                      Lab Mode docs, 8 prebuilt experiments
Desktop Java app                      Browser app (Vite + React + TS),
                                      runs from `npm run dev` or as a
                                      static build
```

## Architecture impact on MicroLab 8085

Because the reference offers no reusable emulator code, MicroLab's CPU, assembler and
everything downstream are implemented from scratch. The reference's main architectural
lesson is the four-stage pipeline shape (preprocess → assemble → simulate → step
control), which maps cleanly onto our modules:

- `src/asm/` — preprocessor + two-pass assembler
- `src/cpu/` — 8085 CPU with T-state timing
- `src/system/` — memory, I/O bus, clock/simulation engine, circuit netlist
- `src/store/` + `src/ui/` — step controller and lab interface

## Licensing note

The reference project and the jar are GPLv2. **No code, assets or text from the
reference or the jar are copied into MicroLab 8085.** Sample programs in
`src/experiments/` were written fresh for MicroLab. MicroLab 8085 is an original
implementation; its license is chosen by its author (the user).
