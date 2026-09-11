# Peripheral reference

Every device is a `Component` (see [architecture.md](architecture.md)):
pins with digital (0/1) and analog (volts) values, an `onPinChange`
callback the engine fires on real changes, a `tick(tstates)` for internal
time, and config that survives project save/load. Pins marked *(in)* are
driven by other components; *(out)* drive the net; *(io)* act as inputs
until the device enables them.

Wires carry both domains: a potentiometer's 2.5 V reaches the ADC as an
analog value, and lights a wired LED's activity highlight at logic 1.

## LED bank — `ledBank`

Pins: **D0-7 (in)**. Eight LEDs, bit 0 → D0. A pin at logic 1 lights its
LED (invert the sense with the *active low* property for wired-LED
hardware). Pure display device: state survives CPU reset because it only
reflects the wires.

## DIP switches — `dipSwitches`

Pins: **S0-7 (out)**. Eight manual toggles clicked on the card. Switches
are physical state — deliberately *not* cleared on CPU reset — so a
program can be reset and re-run against the same input pattern.

## 7-segment display — `sevenSegment`

Pins: **a-g, dp (in)**, bit 0 = a … bit 6 = g, bit 7 = dp. Common cathode
by default (1 lights the segment); enable *common anode* to invert, like
wiring the common pin to VCC. Drive from one output port with a segment
lookup table (see experiment 3).

## 4×4 keypad — `keypad`

Pins: **R0-3 (in)**, **C0-3 (out)**. Layout `1 2 3 A / 4 5 6 B / 7 8 9 C / * 0 # D`;
a pressed key connects its row to its column, so column *c* reads the OR
of pressed rows' levels. Scan like real hardware: energize one row at a
time, read the columns, decode `row × 4 + col`. Keys are ideal contacts
(no bounce, no ghosting — as if the matrix had diodes) and presses survive
reset.

## LCD 16×2 — `lcd1602`

Pins: **D0-7 (io)**, **RS, RW, EN (in)**. An HD44780 command subset:
function set, display on/off, clear, entry mode (increment/decrement,
in-place shift ignored with a warning), return home, cursor/display shift,
set DDRAM address, CGRAM address (ignored with a warning). Characters
latch on **EN's falling edge** with RS selecting command (0) or data (1);
RW low = write. The visible window is 2×16 after display shift; the cursor
and blink are rendered. 4-bit mode (DL=0) is not simulated.

## ADC0808 — `adc0808`

Pins: **IN0-7 (in, analog)**, **ADD A/B/C (in)**, **ALE, START, OE (in)**,
**EOC (out)**, **D0-7 (io)**.

Behavior: a rising edge on ALE latches the channel from the ADD pins (until
the first ALE the channel follows ADD live). A rising edge on START samples
the selected input's voltage and begins a conversion — restarting one in
progress, like the real chip. Conversion takes 64 cycles of an internal
~500 kHz clock derived from CPU T-states (≈384 T-states); EOC is high when
idle, low while converting, high when the result is latched. The result is
`floor(V/Vref × 256)`, one LSB = Vref/256; OE gates the data pins.

*Simplifications, stated plainly:* the internal clock is derived from the
CPU rather than an external CLK pin; OE is strapped high on this module
(wire it low to tristate); unlatched ADD state is well-defined rather than
floating.

## DAC0808 — `dac0808`

Pins: **D0-7 (in)**, **OUT (out, analog)**. Vout = code/256 × Vref —
full code (FFH) gives 255/256 × Vref, one LSB short of the rail, like the
real R-2R ladder into an I-to-V converter. The card shows the digital
code, the voltage and the LSB size; Vref is inspector-adjustable. Wire OUT
to an oscilloscope channel to see the staircase.

## Sensors — `potentiometer`, `tempSensor`, `lightSensor`

One analog **OUT (out)** each, driven from a slider that is physical state
(survives CPU reset):

- **Potentiometer**: 10 kΩ divider, 0-100 % → 0-5 V.
- **LM35**: 10 mV/°C, 0-150 °C → 0-1.5 V. With ADC Vref = 2.56 V the byte
  *is* the temperature in °C.
- **Light sensor (LDR)**: CdS cell + 10 kΩ divider, log response — ≈0.05 V
  dark, 2.5 V at half brightness, ≈4.95 V bright.

*One analog domain: 0-5 V, no negative voltages; power pins implied.*

## Oscilloscope — `scope`

Pins: **CH1-4 (in)**. Each channel records a sample every time its pin
value changes (digital and/or analog), stamped in T-states; the display
shows a sliding window (configurable, default 20,000 T ≈ 10 ms at 2 MHz).
Traces clear on CPU reset; there is no trigger. Digital channels draw step
waveforms; analog channels draw the voltage against 0-5 V. 4096 samples
per channel, oldest dropped.

## LED / wiring interactions worth knowing

- An **input pin wired only to another input** is pulled to 0 (digital and
  analog) — reading it gives 00H.
- **Two outputs on one net** contend: neither wins. The simulator refuses
  the wire when it can (out→out at connect time) and the diagnostics panel
  flags out→out that arises later (e.g. after a control word flips a port).
- The 8255's data pins are *io*: before its control word, its ports act as
  inputs; wiring to them early is fine.
