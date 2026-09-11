/**
 * Component card bodies: type-specific visuals rendered inside the generic
 * canvas card. Adding custom visuals for a new component = add one entry to
 * BODIES (or rely on DefaultBody). Core component files stay React-free.
 */
import type { FC } from 'react';
import type { Component } from '../../core/circuit';
import { useUi } from '../../store/uiStore';
import { metaFor } from '../registry';
import type { I8255 } from '../i8255';
import type { LedBank } from '../ledBank';
import type { DipSwitches } from '../dipSwitches';
import type { SevenSegment } from '../sevenSegment';
import { KEYS, type Keypad } from '../keypad';
import type { Lcd1602 } from '../lcd';
import { type AnalogSensor } from '../sensors';
import { type Adc0808 } from '../adc0808';
import { type Dac0808 } from '../dac0808';
import { type Oscilloscope, type ScopeSample, SCOPE_CHANNELS } from '../scope';

interface BodyProps {
  component: Component;
  /** Store re-render tick — read live values from the component. */
  version: number;
  /** Called when the user interacts (switch toggles re-propagate). */
  onInteract: (componentId: string, pinId: string) => void;
}

const LedBankBody: FC<BodyProps> = ({ component }) => {
  const leds = component as LedBank;
  const rows = [];
  for (let i = 7; i >= 0; i--) {
    const lit = leds.lit(i);
    rows.push(
      <div className="led-row" key={i}>
        <span className={`led ${lit ? 'led-on' : ''}`} />
        <span className="led-name">D{i}</span>
      </div>,
    );
  }
  return <div className="led-bank">{rows}</div>;
};

const DipSwitchBody: FC<BodyProps> = ({ component, onInteract }) => {
  const sw = component as DipSwitches;
  const rows = [];
  for (let i = 7; i >= 0; i--) {
    const on = sw.getPin(`S${i}`).digital === 1;
    rows.push(
      <div className="sw-row" key={i}>
        <button
          type="button"
          className={`switch ${on ? 'sw-on' : 'sw-off'}`}
          title={`S${i} — click to ${on ? 'open (0)' : 'close (1)'}`}
          onClick={() => onInteract(sw.id, `S${i}`)}
        >
          <span className="sw-lever" />
        </button>
        <span className="led-name">S{i}</span>
      </div>,
    );
  }
  return <div className="led-bank">{rows}</div>;
};

const I8255Body: FC<BodyProps> = ({ component }) => {
  const p = component as I8255;
  const s = p.portSummary();
  const dirMark = (d: 'in' | 'out') => (d === 'out' ? '▶ out' : '◀ in');
  return (
    <div className="i8255-body">
      <div className="port-line">
        <span className="port-name">Port A</span>
        <span className="port-val">{hex2(s.A)}</span>
        <span className={`port-dir ${p.dirA}`}>{dirMark(p.dirA)}</span>
      </div>
      <div className="port-line">
        <span className="port-name">Port B</span>
        <span className="port-val">{hex2(s.B)}</span>
        <span className={`port-dir ${p.dirB}`}>{dirMark(p.dirB)}</span>
      </div>
      <div className="port-line">
        <span className="port-name">Port C</span>
        <span className="port-val">{hex2(s.C)}</span>
      </div>
      <div className="port-line cw">
        <span className="port-name">Ctrl</span>
        <span className="port-val">{hex2(s.CW)}</span>
      </div>
      <div className={`cw-note ${p.modeUnsupported ? 'cw-bad' : ''}`}>
        {p.modeUnsupported ? 'Mode 1/2 not simulated (see console)' : `base ${hex2(p.baseAddress)}H–${hex2(p.baseAddress + 3)}H`}
      </div>
    </div>
  );
};

const DefaultBody: FC<BodyProps> = ({ component }) => {
  const meta = metaFor(component.type);
  return <div className="default-body">{meta?.short ?? component.type}</div>;
};

/** Classic seven-segment glyph geometry, drawn in a 100×160 viewBox. */
const SEG_POINTS: Record<string, string> = {
  a: '20,8 80,8 72,16 28,16',
  b: '84,12 84,68 76,60 76,20',
  c: '84,76 84,132 76,124 76,84',
  d: '20,140 80,140 72,132 28,132',
  e: '16,76 16,132 24,124 24,84',
  f: '16,12 16,68 24,60 24,20',
  g: '20,72 28,78 72,78 80,72 72,70 28,70',
};

const SevenSegmentBody: FC<BodyProps> = ({ component }) => {
  const seg = component as SevenSegment;
  return (
    <div className="sevenseg">
      <svg viewBox="0 0 100 160" className="sevenseg-svg">
        {(['a', 'b', 'c', 'd', 'e', 'f', 'g'] as const).map((s) => (
          <polygon
            key={s}
            points={SEG_POINTS[s]}
            className={`seg ${seg.segmentLit(s) ? 'seg-on' : ''}`}
          />
        ))}
        <circle
          cx="86"
          cy="146"
          r="6"
          className={`seg ${seg.segmentLit('dp') ? 'seg-on' : ''}`}
        />
      </svg>
      <div className="sevenseg-hex">{seg.segmentValue().toString(16).toUpperCase().padStart(2, '0')}H</div>
    </div>
  );
};

const KeypadBody: FC<BodyProps> = ({ component, onInteract }) => {
  const kp = component as Keypad;
  const rows = [];
  for (let r = 0; r < 4; r++) {
    const cells = [];
    for (let c = 0; c < 4; c++) {
      const key = r * 4 + c;
      const down = kp.isPressed(key);
      cells.push(
        <button
          type="button"
          key={c}
          className={`key ${down ? 'key-down' : ''}`}
          title={`${KEYS[r]![c]} — click to ${down ? 'release' : 'press'}`}
          onClick={() => onInteract(kp.id, `${r},${c}`)}
        >
          {KEYS[r]![c]}
        </button>,
      );
    }
    rows.push(<div className="key-row" key={r}>{cells}</div>);
  }
  return (
    <div className="keypad">
      {rows}
      <div className="keypad-hint">rows scan in · cols read out</div>
    </div>
  );
};

const LcdBody: FC<BodyProps> = ({ component }) => {
  const lcd = component as Lcd1602;
  const lines = lcd.text();
  const cur = lcd.cursorVisible();
  const rows = lines.map((line, r) => {
    const cells = [];
    for (let cIdx = 0; cIdx < 16; cIdx++) {
      const isCursor = cur !== null && cur.row === r && cur.col === cIdx;
      cells.push(
        <span key={cIdx} className={`lcd-cell ${isCursor ? (lcd.isBlinking() ? 'lcd-blink' : 'lcd-cursor') : ''}`}>
          {line[cIdx] ?? ' '}
        </span>,
      );
    }
    return <div key={r} className="lcd-line">{cells}</div>;
  });
  return (
    <div className={`lcd ${lcd.isDisplayOn() ? '' : 'lcd-off'}`}>
      {rows}
    </div>
  );
};

/* --- analog sensors --- */

const SensorBody: FC<BodyProps> = ({ component, onInteract }) => {
  const s = component as AnalogSensor;
  return (
    <div className="sensor">
      <div className="sensor-read">
        <span className="sensor-val">
          {s.getLevel()}
          {s.unit}
        </span>
        <span className="sensor-volts">{s.volts().toFixed(2)} V</span>
      </div>
      <input
        type="range"
        className="sensor-slider"
        min={0}
        max={s.maxLevel}
        step={1}
        value={s.getLevel()}
        onChange={(e) => onInteract(s.id, e.target.value)}
      />
      <div className="sensor-bar">
        <div className="sensor-bar-fill" style={{ width: `${(s.volts() / 5) * 100}%` }} />
      </div>
    </div>
  );
};

/* --- ADC0808 --- */

const AdcBody: FC<BodyProps> = ({ component }) => {
  const adc = component as Adc0808;
  const conv = adc.isConverting();
  const r = adc.lastResult();
  const bits = [];
  for (let i = 7; i >= 0; i--) bits.push(<span key={i} className={(r >> i) & 1 ? 'on' : ''} />);
  return (
    <div className="adc">
      <div className="adc-row">
        <span className="adc-k">Channel</span>
        <span className="adc-v">IN{adc.channel()}</span>
        <span className="adc-k">V<sub>in</sub></span>
        <span className="adc-v">{adc.channelVolts().toFixed(2)} V</span>
      </div>
      <div className="adc-row">
        <span className="adc-k">Vref+</span>
        <span className="adc-v">{adc.vref.toFixed(2)} V</span>
        <span className="adc-k">EOC</span>
        <span className={`adc-v ${adc.isEoc() ? 'adc-hi' : 'adc-lo'}`}>{adc.isEoc() ? '1' : '0'}</span>
      </div>
      <div className={`adc-status ${conv ? 'adc-conv' : ''}`}>
        {conv ? 'Converting…' : adc.lastResult() > 0 || adc.sampledVolts() > 0 ? 'Done' : 'Idle'}
      </div>
      {conv && (
        <div className="adc-progress">
          <div style={{ width: `${adc.progress() * 100}%` }} />
        </div>
      )}
      <div className="adc-result">
        <span className="adc-hex">{hex2(r)}H</span>
        <span className="adc-dec">{r}</span>
        <div className="adc-bar">{bits}</div>
      </div>
    </div>
  );
};

/* --- DAC0808 --- */

const DacBody: FC<BodyProps> = ({ component }) => {
  const dac = component as Dac0808;
  const b = dac.outputByte();
  const v = dac.outputVolts();
  const bits = [];
  for (let i = 7; i >= 0; i--) bits.push(<span key={i} className={(b >> i) & 1 ? 'on' : ''} />);
  return (
    <div className="dac">
      <div className="adc-row">
        <span className="adc-k">Code</span>
        <span className="adc-hex">{hex2(b)}H</span>
        <span className="dac-dec">{b}</span>
      </div>
      <div className="adc-bar dac-bits">{bits}</div>
      <div className="adc-row">
        <span className="adc-k">Vout</span>
        <span className="dac-volts">{v.toFixed(2)} V</span>
        <span className="adc-k">Vref</span>
        <span className="adc-v">{dac.vref.toFixed(2)} V</span>
      </div>
      <div className="sensor-bar">
        <div className="sensor-bar-fill" style={{ width: `${Math.min(100, (v / 5) * 100)}%` }} />
      </div>
      <div className="dac-lsb">1 LSB = {dac.lsbVolts().toFixed(3)} V</div>
    </div>
  );
};

/* --- Oscilloscope --- */

interface ScopeTraceProps {
  scope: Oscilloscope;
  /** Drawing-grid width (viewBox units); the svg scales to its container. */
  W: number;
  /** Lane height in viewBox units. */
  laneH: number;
}

/**
 * Waveform lanes shared by the card body and the expanded dialog view.
 * Channels currently hidden (chVisible) are skipped; the rest stack.
 */
export const ScopeTrace: FC<ScopeTraceProps> = ({ scope, W, laneH }) => {
  const gap = 6;
  const top = 2;
  const visible: number[] = [];
  for (let ch = 1; ch <= SCOPE_CHANNELS; ch++) if (scope.chVisible[ch - 1]) visible.push(ch);
  const H = top + Math.max(1, visible.length) * (laneH + gap);
  const now = scope.now();
  const win = scope.windowTstates;
  // Sliding window: ends at 'now' once the trace is longer than the window.
  const tEnd = Math.max(now, win);
  const tStart = tEnd - win;
  const xOf = (t: number) => 1 + ((t - tStart) / win) * (W - 5);

  const lanes: React.JSX.Element[] = [];
  visible.forEach((ch, vi) => {
    const all = scope.getChannel(ch);
    const yTop = top + vi * (laneH + gap);
    // Carry-in: the last sample before the window anchors the left edge.
    let carry: ScopeSample | null = null;
    for (let i = all.length - 1; i >= 0; i--) {
      if (all[i]!.t < tStart) {
        carry = all[i]!;
        break;
      }
    }
    const pts = carry ? [carry, ...all.filter((s) => s.t >= tStart)] : [...all.filter((s) => s.t >= tStart)];
    const isAnalog = pts.some((s) => s.analog !== null);
    const lastVal = all.length ? all[all.length - 1]! : null;
    let path = '';
    if (pts.length > 0) {
      const yFor = (s: ScopeSample): number => {
        if (isAnalog) {
          const v = Math.max(0, Math.min(5, s.analog ?? 0));
          return yTop + laneH - 3 - (v / 5) * (laneH - 6);
        }
        return s.digital === 1 ? yTop + 5 : yTop + laneH - 5;
      };
      const yFirst = yFor(pts[0]!);
      path = `M ${xOf(pts[0]!.t).toFixed(1)} ${yFirst.toFixed(1)}`;
      if (isAnalog) {
        for (let i = 1; i < pts.length; i++) {
          path += ` L ${xOf(pts[i]!.t).toFixed(1)} ${yFor(pts[i]!).toFixed(1)}`;
        }
        path += ` L ${(W - 4).toFixed(1)} ${yFor(pts[pts.length - 1]!).toFixed(1)}`;
      } else {
        let yPrev = yFirst;
        for (let i = 1; i < pts.length; i++) {
          const x = xOf(pts[i]!.t).toFixed(1);
          const y = yFor(pts[i]!).toFixed(1);
          path += ` L ${x} ${yPrev.toFixed(1)} L ${x} ${y}`;
          yPrev = yFor(pts[i]!);
        }
        path += ` L ${(W - 4).toFixed(1)} ${yPrev.toFixed(1)}`;
      }
    }
    lanes.push(
      <g key={ch} className={`scope-lane ch${ch} ${pts.length ? '' : 'scope-empty'}`}>
        <rect className="scope-bg" x={1} y={yTop} width={W - 5} height={laneH} rx={3} />
        <line className="scope-mid" x1={1} y1={yTop + laneH / 2} x2={W - 4} y2={yTop + laneH / 2} />
        <text className="scope-ch" x={6} y={yTop + 12}>
          CH{ch}
        </text>
        <text className="scope-val" x={W - 10} y={yTop + 12} textAnchor="end">
          {lastVal ? (isAnalog ? `${(lastVal.analog ?? 0).toFixed(2)} V` : `${lastVal.digital}`) : '—'}
        </text>
        {path ? <path className="scope-trace" d={path} /> : null}
      </g>,
    );
  });
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height="100%" role="img" aria-label="oscilloscope waveform">
      {lanes}
    </svg>
  );
};

/** Channel-visibility chips + expand button, shared by card and dialog. */
export const ScopeChips: FC<{
  scope: Oscilloscope;
  onToggle: (ch: number) => void;
  onExpand?: () => void;
}> = ({ scope, onToggle, onExpand }) => (
  <div className="scope-controls">
    {[1, 2, 3, 4].map((ch) => (
      <button
        key={ch}
        type="button"
        className={`btn btn-small scope-chip ${scope.chVisible[ch - 1] ? 'btn-active' : ''}`}
        title={`Show / hide CH${ch}`}
        onClick={() => onToggle(ch)}
      >
        CH{ch}
      </button>
    ))}
    {onExpand && (
      <button
        type="button"
        className="btn btn-small scope-expand"
        title="Expand the oscilloscope view"
        onClick={onExpand}
      >
        ⛶ Expand
      </button>
    )}
  </div>
);

const ScopeBody: FC<BodyProps> = ({ component, onInteract }) => {
  const scope = component as Oscilloscope;
  return (
    <div className="scope">
      <ScopeChips
        scope={scope}
        onToggle={(ch) => onInteract(scope.id, `ch${ch}`)}
        onExpand={() => useUi.getState().setExpandedScope(scope.id)}
      />
      <div className="scope-view">
        <ScopeTrace scope={scope} W={350} laneH={44} />
      </div>
      <div className="scope-info">
        window {scope.windowTstates.toLocaleString('en-US')} T · t = {scope.now().toLocaleString('en-US')} T
      </div>
    </div>
  );
};

export const BODIES: Record<string, FC<BodyProps>> = {
  ledBank: LedBankBody,
  dipSwitches: DipSwitchBody,
  i8255: I8255Body,
  sevenSegment: SevenSegmentBody,
  keypad: KeypadBody,
  lcd1602: LcdBody,
  adc0808: AdcBody,
  dac0808: DacBody,
  scope: ScopeBody,
  potentiometer: SensorBody,
  tempSensor: SensorBody,
  lightSensor: SensorBody,
};

export function bodyFor(type: string): FC<BodyProps> {
  return BODIES[type] ?? DefaultBody;
}

function hex2(v: number): string {
  return (v & 0xff).toString(16).toUpperCase().padStart(2, '0');
}
