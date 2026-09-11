/**
 * I/O map panel: the 256-address 8085 I/O space. Occupied addresses are
 * colored; the list below shows each peripheral's window and what each
 * address decodes to. Clicking a device selects it on the canvas.
 */
import { machine, useLab } from '../../store/labStore';
import { Panel } from './Panel';
import { isPeripheral, type Peripheral } from '../../core/circuit';

export function IoMapPanel(): React.JSX.Element {
  useLab((s) => s.version);
  const select = useLab((s) => s.select);

  const devices: Array<{ p: Peripheral; addrs: number[] }> = [];
  for (const c of machine.circuit.components.values()) {
    if (isPeripheral(c)) {
      const p = c as Peripheral;
      const addrs = machine.io.occupiedBy(p);
      if (addrs.length > 0) devices.push({ p, addrs });
    }
  }
  const ownerAt = new Map<number, { p: Peripheral; off: number }>();
  for (const { p, addrs } of devices) {
    addrs.forEach((a) => ownerAt.set(a, { p, off: a - p.baseAddress }));
  }

  const cells = [];
  for (let a = 0; a < 256; a++) {
    const o = ownerAt.get(a);
    cells.push(
      <div
        key={a}
        className={`io-cell ${o ? 'io-used' : ''}`}
        title={o ? `${hex2(a)}H — ${o.p.label}: ${o.p.describeAddress(o.off)}` : `${hex2(a)}H — free`}
      />,
    );
  }

  return (
    <Panel id="iomap" title="I/O map">
      <div className="io-grid">{cells}</div>
      <div className="io-list">
        {devices.length === 0 && <div className="io-empty">No I/O devices — add an 8255 from the palette.</div>}
        {devices.map(({ p, addrs }) => (
          <button type="button" key={p.id} className="io-row" onClick={() => select(p.id)}>
            <span className="io-name">{p.label}</span>
            <span className="io-range">
              {hex2(addrs[0]!)}H{addrs.length > 1 ? `–${hex2(addrs[addrs.length - 1]!)}` : ''}H
            </span>
            <span className="io-what">
              {p.describeAddress(0)}
              {addrs.length > 1 ? ` … ${p.describeAddress(addrs.length - 1)}` : ''}
            </span>
          </button>
        ))}
      </div>
      {machine.io.getConflicts().length > 0 && (
        <div className="io-conflict">
          ⚠ {machine.io.getConflicts().length} address conflict(s) recorded — see console.
        </div>
      )}
    </Panel>
  );
}

function hex2(v: number): string {
  return (v & 0xff).toString(16).toUpperCase().padStart(2, '0');
}
