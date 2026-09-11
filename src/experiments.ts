/**
 * Prebuilt experiments: one click loads a wired circuit + a working program.
 *
 * Each experiment is a ProjectFile (the same format Save/Load uses) plus
 * educational metadata. Every program here assembles and runs against the
 * real simulated hardware — tests/experiments.test.ts executes all eight.
 */
import type { ProjectFile } from './store/labStore';

export interface Experiment {
  id: string;
  title: string;
  blurb: string;
  /** What the experiment teaches — logged to the console when loaded. */
  explanation: string;
  /** What you should see when it runs. */
  expected: string;
  project: ProjectFile;
}

/** Compact wire spec: [fromIndex, fromPin, toIndex, toPin]. */
type Wire = [number, string, number, string];

function project(
  name: string,
  source: string,
  components: ProjectFile['components'],
  wires: Wire[],
): ProjectFile {
  return {
    format: 'microlab-8085-project',
    version: 1,
    name,
    source,
    components,
    connections: wires.map(([fromIndex, fromPin, toIndex, toPin]) => ({
      fromIndex,
      fromPin,
      toIndex,
      toPin,
    })),
  };
}

export const EXPERIMENTS: Experiment[] = [
  {
    id: 'led-blink',
    title: '1 · LEDs on Port A',
    blurb: 'Light an LED pattern from an OUT instruction.',
    explanation:
      'The 8255 PPI is mapped at 80H–83H (A, B, C, control). Writing a mode word ' +
      'to 83H sets port directions; afterwards every OUT 80H places the byte on ' +
      'port A, and the LED bank wired to it shows each bit: bit 0 → D0 … bit 7 → D7.',
    expected: 'LEDs D0, D2, D4, D6 light (pattern 55H = 01010101b).',
    project: project(
      'Experiment 1 — LEDs',
      `; Experiment 1: light alternating LEDs on Port A
; 8255 at 80H, LED bank wired to PA0-7 (bit 0 = D0)

        ORG 2000H
        MVI A,80H    ; mode word: all ports output
        OUT 83H
        MVI A,55H    ; 01010101b
        OUT 80H      ; LEDs D0, D2, D4, D6 on
        HLT`,
      [
        { type: 'i8255', label: '8255 PPI', x: 60, y: 100, config: { baseAddress: 0x80 } },
        { type: 'ledBank', label: 'LED bank', x: 500, y: 80, config: { activeLow: false } },
      ],
      [
        [0, 'PA0', 1, 'D0'], [0, 'PA1', 1, 'D1'], [0, 'PA2', 1, 'D2'], [0, 'PA3', 1, 'D3'],
        [0, 'PA4', 1, 'D4'], [0, 'PA5', 1, 'D5'], [0, 'PA6', 1, 'D6'], [0, 'PA7', 1, 'D7'],
      ],
    ),
  },
  {
    id: 'switch-echo',
    title: '2 · Switch echo',
    blurb: 'Read DIP switches on Port A, mirror them to LEDs on Port B.',
    explanation:
      'Port A is configured as INPUT (mode word 90H: PA in, rest out) and reads the ' +
      'DIP switches; port B is an OUTPUT driving the LEDs. The loop IN 80H / OUT 81H ' +
      'copies switch state to the LEDs forever — flip any switch while it runs and ' +
      'the matching LED follows immediately.',
    expected: 'Each LED mirrors its switch. Flip switches while it runs — LEDs follow live.',
    project: project(
      'Experiment 2 — switch echo',
      `; Experiment 2: echo DIP switches (Port A, input) to LEDs (Port B, output)

        ORG 2000H
        MVI A,90H    ; PA input, PB/PC output
        OUT 83H
LOOP:   IN 80H       ; read the switches
        OUT 81H      ; write them to the LEDs
        JMP LOOP     ; forever`,
      [
        { type: 'i8255', label: '8255 PPI', x: 60, y: 100, config: { baseAddress: 0x80 } },
        { type: 'dipSwitches', label: 'DIP switches', x: 500, y: 60, config: {} },
        { type: 'ledBank', label: 'LED bank', x: 500, y: 340, config: { activeLow: false } },
      ],
      [
        [1, 'S0', 0, 'PA0'], [1, 'S1', 0, 'PA1'], [1, 'S2', 0, 'PA2'], [1, 'S3', 0, 'PA3'],
        [1, 'S4', 0, 'PA4'], [1, 'S5', 0, 'PA5'], [1, 'S6', 0, 'PA6'], [1, 'S7', 0, 'PA7'],
        [0, 'PB0', 2, 'D0'], [0, 'PB1', 2, 'D1'], [0, 'PB2', 2, 'D2'], [0, 'PB3', 2, 'D3'],
        [0, 'PB4', 2, 'D4'], [0, 'PB5', 2, 'D5'], [0, 'PB6', 2, 'D6'], [0, 'PB7', 2, 'D7'],
      ],
    ),
  },
  {
    id: 'seven-seg-counter',
    title: '3 · 7-segment counter',
    blurb: 'Count 0–9 on a seven-segment display from a lookup table.',
    explanation:
      'Each digit shape is a byte: bit 0 = segment a, bit 1 = b, … bit 6 = g, ' +
      'bit 7 = dp. The table TAB holds the ten codes (3FH = "0", 06H = "1", …). ' +
      'The program walks the table, OUTs each code to port A, waits, and repeats. ' +
      'Set the simulator Speed to Slow or Medium to watch it count.',
    expected: 'The display counts 0, 1, 2 … 9, 0, 1 … continuously (use a slower Speed).',
    project: project(
      'Experiment 3 — 7-segment counter',
      `; Experiment 3: count 0-9 on a 7-segment display (Port A)

        ORG 2000H
        MVI A,80H    ; PA output
        OUT 83H
        LXI SP,2100H ; stack for the delay subroutine
AGAIN:  LXI H,TAB    ; point at the digit table
        MVI C,0AH    ; 10 digits
NEXT:   MOV A,M      ; fetch the segment code
        OUT 80H      ; show it
        CALL DELAY
        INX H
        DCR C
        JNZ NEXT
        JMP AGAIN    ; wrap around forever

DELAY:  LXI D,4000H  ; ~49 ms at 2 MHz — tune to taste
DLOOP:  DCX D
        MOV A,D
        ORA E
        JNZ DLOOP
        RET

; segment codes for 0-9 (bit0=a … bit6=g, bit7=dp)
TAB:    DB 3FH,06H,5BH,4FH,66H,6DH,7DH,07H,7FH,6FH`,
      [
        { type: 'i8255', label: '8255 PPI', x: 60, y: 160, config: { baseAddress: 0x80 } },
        { type: 'sevenSegment', label: '7-segment', x: 500, y: 100, config: { commonAnode: false } },
      ],
      [
        [0, 'PA0', 1, 'a'], [0, 'PA1', 1, 'b'], [0, 'PA2', 1, 'c'], [0, 'PA3', 1, 'd'],
        [0, 'PA4', 1, 'e'], [0, 'PA5', 1, 'f'], [0, 'PA6', 1, 'g'], [0, 'PA7', 1, 'dp'],
      ],
    ),
  },
  {
    id: 'adc-pot',
    title: '4 · ADC: digitize a knob',
    blurb: 'Start a conversion, poll EOC, read the byte.',
    explanation:
      'The ADC0808 needs a handshake: pulse ALE+START (PC0/PC1) to begin, EOC ' +
      '(into PC4) goes low while converting and high when done, then the result ' +
      'appears on D0–D7 (into port A). The program polls port C until bit 4 ' +
      '(EOC) is 1, then reads the byte into B. 2.5 V with Vref 5 V reads 80H (128).',
    expected: 'ADC card shows Done; B = the knob position as a byte (50% → 80H/128).',
    project: project(
      'Experiment 4 — ADC + potentiometer',
      `; Experiment 4: convert the potentiometer on IN0
; PA <- D0-7, PC0 -> ALE, PC1 -> START, PC4 <- EOC

        ORG 2000H
        MVI A,98H    ; PA in, PC upper in, PC lower out
        OUT 83H
        MVI A,03H    ; ALE=1, START=1 (latch channel 0, begin)
        OUT 82H
        MVI A,00H    ; pulse low — conversion runs
        OUT 82H
WT:     IN 82H       ; read port C
        ANI 10H      ; EOC on PC4?
        JZ WT        ; wait for end of conversion
        IN 80H       ; the converted byte
        MOV B,A
        HLT`,
      [
        { type: 'i8255', label: '8255 PPI', x: 60, y: 80, config: { baseAddress: 0x80 } },
        { type: 'adc0808', label: 'ADC0808', x: 450, y: 40, config: { vref: 5 } },
        { type: 'potentiometer', label: 'Potentiometer', x: 850, y: 60, config: { level: 50 } },
      ],
      [
        [1, 'D0', 0, 'PA0'], [1, 'D1', 0, 'PA1'], [1, 'D2', 0, 'PA2'], [1, 'D3', 0, 'PA3'],
        [1, 'D4', 0, 'PA4'], [1, 'D5', 0, 'PA5'], [1, 'D6', 0, 'PA6'], [1, 'D7', 0, 'PA7'],
        [0, 'PC0', 1, 'ALE'], [0, 'PC1', 1, 'START'], [1, 'EOC', 0, 'PC4'],
        [2, 'out', 1, 'IN0'],
      ],
    ),
  },
  {
    id: 'dac-sawtooth',
    title: '5 · DAC sawtooth',
    blurb: 'Emit a ramp and watch the staircase on the oscilloscope.',
    explanation:
      'Every OUT 80H writes a code to the DAC; Vout = code/256 × Vref. Stepping ' +
      'the code 0→255 produces the classic DAC staircase, and the oscilloscope ' +
      '(CH1 wired to the DAC OUT pin) records it over T-states. One LSB = Vref/256 ' +
      '≈ 19.5 mV — the height of each step.',
    expected: 'Scope CH1 shows a rising staircase from 0 V to ≈4.98 V, wrapping back to 0 V.',
    project: project(
      'Experiment 5 — DAC sawtooth',
      `; Experiment 5: sawtooth ramp on the DAC (Port A -> D0-7)

        ORG 2000H
        MVI A,80H    ; PA output
        OUT 83H
        XRA A        ; code = 0
LOOP:   OUT 80H      ; emit it
        INR A        ; next code up
        JNZ LOOP     ; 0..255
        OUT 80H      ; A wrapped to 0 — one full tooth
        HLT`,
      [
        { type: 'i8255', label: '8255 PPI', x: 60, y: 80, config: { baseAddress: 0x80 } },
        { type: 'dac0808', label: 'DAC0808', x: 450, y: 60, config: { vref: 5 } },
        { type: 'scope', label: 'Oscilloscope', x: 800, y: 40, config: { windowTstates: 20000 } },
      ],
      [
        [0, 'PA0', 1, 'D0'], [0, 'PA1', 1, 'D1'], [0, 'PA2', 1, 'D2'], [0, 'PA3', 1, 'D3'],
        [0, 'PA4', 1, 'D4'], [0, 'PA5', 1, 'D5'], [0, 'PA6', 1, 'D6'], [0, 'PA7', 1, 'D7'],
        [1, 'OUT', 2, 'CH1'],
      ],
    ),
  },
  {
    id: 'adc-temp',
    title: '6 · LM35 thermometer',
    blurb: 'Read temperature directly as a byte using Vref = 2.56 V.',
    explanation:
      'The LM35 puts out 10 mV per °C. With the ADC Vref+ set to 2.56 V the math ' +
      'collapses: byte = V/2.56 × 256 = V × 100 = temperature in °C. No scaling ' +
      'needed — the converted byte IS the temperature. The sensor starts at 100 °C ' +
      'here; drag it and re-run to see B follow.',
    expected: 'B = the temperature: 100 °C → 64H (100). The ADC card shows ≈1.00 V on IN0.',
    project: project(
      'Experiment 6 — LM35 + ADC',
      `; Experiment 6: read the LM35 on IN0 — with Vref 2.56 V
; the byte IS the temperature in degrees C (V x 100).
; PA <- D0-7, PC0 -> ALE, PC1 -> START, PC4 <- EOC

        ORG 2000H
        MVI A,98H    ; PA in, PC upper in, PC lower out
        OUT 83H
        MVI A,03H    ; ALE=1, START=1
        OUT 82H
        MVI A,00H
        OUT 82H
WT:     IN 82H
        ANI 10H      ; EOC?
        JZ WT
        IN 80H       ; byte = temperature in C
        MOV B,A
        HLT`,
      [
        { type: 'i8255', label: '8255 PPI', x: 60, y: 80, config: { baseAddress: 0x80 } },
        { type: 'adc0808', label: 'ADC0808', x: 450, y: 40, config: { vref: 2.56 } },
        { type: 'tempSensor', label: 'LM35 sensor', x: 850, y: 60, config: { level: 100 } },
      ],
      [
        [1, 'D0', 0, 'PA0'], [1, 'D1', 0, 'PA1'], [1, 'D2', 0, 'PA2'], [1, 'D3', 0, 'PA3'],
        [1, 'D4', 0, 'PA4'], [1, 'D5', 0, 'PA5'], [1, 'D6', 0, 'PA6'], [1, 'D7', 0, 'PA7'],
        [0, 'PC0', 1, 'ALE'], [0, 'PC1', 1, 'START'], [1, 'EOC', 0, 'PC4'],
        [2, 'out', 1, 'IN0'],
      ],
    ),
  },
  {
    id: 'keypad-scan',
    title: '7 · Keypad scanner',
    blurb: 'Scan a 4×4 matrix: drive rows, read columns, decode the key.',
    explanation:
      'Rows R0–R3 are driven from Port A (output), columns C0–C3 are read on ' +
      'Port B (input). A pressed key connects its row to its column, so driving ' +
      'one row high at a time and reading the columns reveals the key: ' +
      'code = row × 4 + column. Press a key (or run first, then press) — the ' +
      'scanner loops until it finds one and halts with the code in B.',
    expected: 'Press a key → the program halts with its code in B (key "5" → 05H, "A" → 03H).',
    project: project(
      'Experiment 7 — keypad scanner',
      `; Experiment 7: scan the 4x4 keypad
; PA0-3 -> rows R0-3 (output), PB0-3 <- columns C0-3 (input)

        ORG 2000H
        MVI A,82H    ; PA output, PB input
        OUT 83H
SCAN:   MVI D,01H    ; row drive pattern, row 0 first
        MVI C,00H    ; row index
ROWLP:  MOV A,D
        OUT 80H      ; energize one row
        IN 81H       ; read the columns
        CPI 00H
        JNZ FOUND    ; a key in this row
        MOV A,D
        RLC          ; advance to the next row
        MOV D,A
        INR C
        MOV A,C
        CPI 04H
        JNZ ROWLP
        JMP SCAN     ; nothing pressed — keep scanning
FOUND:  MVI B,00H    ; column index
COLLP:  RRC          ; bit 0 -> carry
        JC GOTKEY
        INR B
        JMP COLLP
GOTKEY: MOV A,C
        RLC
        RLC          ; row x 4
        ADD B        ; + column
        MOV B,A      ; key code 0..15 in B
        HLT`,
      [
        { type: 'i8255', label: '8255 PPI', x: 60, y: 100, config: { baseAddress: 0x80 } },
        { type: 'keypad', label: 'Keypad', x: 500, y: 80, config: {} },
      ],
      [
        [0, 'PA0', 1, 'R0'], [0, 'PA1', 1, 'R1'], [0, 'PA2', 1, 'R2'], [0, 'PA3', 1, 'R3'],
        [1, 'C0', 0, 'PB0'], [1, 'C1', 0, 'PB1'], [1, 'C2', 0, 'PB2'], [1, 'C3', 0, 'PB3'],
      ],
    ),
  },
  {
    id: 'lcd-hello',
    title: '8 · LCD: write HELLO',
    blurb: 'Initialize an HD44780 LCD and send text.',
    explanation:
      'The LCD latches a byte on the EN falling edge (PC2), with RS (PC0) ' +
      'selecting command (0) or character (1); RW (PC1) stays low for writes. ' +
      'Init needs the standard sequence: 38H (8-bit, 2 lines), 0EH (display on), ' +
      '01H (clear), 06H (entry mode). Then RS=1 and one character per pulse. ' +
      'The PULSE subroutine toggles EN while preserving RS.',
    expected: 'The LCD shows HELLO on line 1.',
    project: project(
      'Experiment 8 — LCD text',
      `; Experiment 8: write HELLO on the 16x2 LCD
; PA -> D0-7, PC0 -> RS, PC1 -> RW, PC2 -> EN

        ORG 2000H
        MVI A,80H    ; PA output, PC output
        OUT 83H
        LXI SP,2100H ; stack for PULSE
        MVI C,00H    ; port C image: RS=0 (commands)
        MVI A,38H    ; function set: 8-bit, 2 lines
        OUT 80H
        CALL PULSE
        MVI A,0EH    ; display on, cursor on
        OUT 80H
        CALL PULSE
        MVI A,01H    ; clear display
        OUT 80H
        CALL PULSE
        MVI A,06H    ; entry mode: increment
        OUT 80H
        CALL PULSE
        MVI C,01H    ; RS=1 (characters now)
        MVI A,'H'
        OUT 80H
        CALL PULSE
        MVI A,'E'
        OUT 80H
        CALL PULSE
        MVI A,'L'
        OUT 80H
        CALL PULSE
        MVI A,'L'
        OUT 80H
        CALL PULSE
        MVI A,'O'
        OUT 80H
        CALL PULSE
        HLT

; pulse EN (bit 2) high then low, preserving RS in C
PULSE:  MOV A,C
        ORI 04H
        OUT 82H
        MOV A,C
        OUT 82H
        RET`,
      [
        { type: 'i8255', label: '8255 PPI', x: 60, y: 80, config: { baseAddress: 0x80 } },
        { type: 'lcd1602', label: 'LCD 16x2', x: 500, y: 60, config: {} },
      ],
      [
        [0, 'PA0', 1, 'D0'], [0, 'PA1', 1, 'D1'], [0, 'PA2', 1, 'D2'], [0, 'PA3', 1, 'D3'],
        [0, 'PA4', 1, 'D4'], [0, 'PA5', 1, 'D5'], [0, 'PA6', 1, 'D6'], [0, 'PA7', 1, 'D7'],
        [0, 'PC0', 1, 'RS'], [0, 'PC1', 1, 'RW'], [0, 'PC2', 1, 'EN'],
      ],
    ),
  },
];

export function experimentById(id: string): Experiment | undefined {
  return EXPERIMENTS.find((e) => e.id === id);
}
