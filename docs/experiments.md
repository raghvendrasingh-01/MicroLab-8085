# The prebuilt experiments

The **Experiments** panel loads any of these with one click: the circuit is
wired, the program assembled and loaded, and the explanation appears in the
panel and the console. Every experiment is executed end-to-end by the test
suite (`tests/experiments.test.ts`), so they cannot silently rot.

## 1 · LEDs on Port A

The classic first program: configure the 8255 at 80H (mode word 80H → all
ports output), then `MVI A,55H / OUT 80H`. LEDs D0, D2, D4, D6 light —
pattern 01010101. Teaches: mode word, port writes, bit-to-pin mapping.

## 2 · Switch echo

Port A becomes an *input* (mode word 90H) reading DIP switches; port B
drives the LEDs. `IN 80H / OUT 81H` in a loop mirrors switch state to the
LEDs — flip switches while it runs and the LEDs follow live. Teaches: port
direction, input reads, that an unwired input reads 00H.

## 3 · 7-segment counter

A lookup table of segment codes (3FH = "0", 06H = "1", …) is walked and
OUT to Port A, with a software delay between digits. Watch it count 0-9 on
a slower speed setting. Teaches: lookup tables, segment encoding, delay
loops (and why you need `LXI SP` before `CALL`).

## 4 · ADC: digitize a knob

The full ADC handshake: pulse ALE+START from PC0/PC1, poll EOC on PC4
until it goes high, then read the byte on Port A into B. With the pot at
50 % and Vref 5 V the result is 80H (128). Teaches: control/status
handshake, polling, conversion math (V = byte/256 × Vref).

## 5 · DAC sawtooth

`XRA A / LOOP: OUT 80H / INR A / JNZ LOOP` ramps the DAC code 0→255. The
card shows the voltage (code/256 × Vref, one LSB steps); the oscilloscope
on CH1 shows the staircase. Teaches: D/A conversion, LSB size, why a DAC
is one LSB short of full scale, using the scope.

## 6 · LM35 thermometer

Same handshake as experiment 4, but the ADC's Vref is set to **2.56 V** —
so `byte = V/2.56 × 256 = V × 100` = temperature in °C directly. The
sensor starts at 100 °C: the program halts with B = 64H (100). Teaches:
choosing Vref to make the math disappear.

## 7 · Keypad scanner

Port A drives the rows, Port B reads the columns (mode word 82H). The
scanner walks a one-hot row pattern, finds the column bit when a key
connects them, and computes `row × 4 + col`. Press a key — it halts with
the key's code in B ("5" → 05H, "A" → 03H). Teaches: matrix scanning,
rotate instructions, key encoding.

## 8 · LCD: write HELLO

The HD44780 init sequence (38H, 0EH, 01H, 06H) then five characters with
RS=1, each latched by an EN pulse from a `PULSE` subroutine that toggles
PC2 while preserving RS. The LCD shows **HELLO**. Teaches: control-signal
sequencing, subroutines with register conventions, EN edge latching.

## Using them in a lab session

1. Load the experiment, read the explanation in the panel.
2. Press Space to run; compare what you see with the "Expected" line.
3. Break it on purpose — delete a wire, comment out the control word —
   run, and read the **Why isn't it working?** panel.
4. Modify the program (change 55H to 0AAH, retime the delay, write your
   own message) and re-assemble with Ctrl+Enter.

## Writing your own experiment

Append to `src/experiments.ts`: a `ProjectFile` (components with positions
and configs, connections by index) plus `id`, `title`, `blurb`,
`explanation`, `expected`. Add a test that loads it through
`instantiateProject` and asserts the outcome — the eight existing tests
are the template.
