/**
 * Memory panel: one 256-byte page as a 16×16 hex grid with change
 * highlighting (cells written since the last render flash), the PC
 * location marked, and the focused source line's bytes highlighted
 * (click a line's bytes in the editor to see where it landed).
 */
import { useEffect, useMemo, useRef } from 'react';
import { machine, useLab, hex4 } from '../../store/labStore';
import { Panel } from './Panel';

export function MemoryPanel(): React.JSX.Element {
  const version = useLab((s) => s.version);
  const base = useLab((s) => s.memoryBase);
  const setMemoryBase = useLab((s) => s.setMemoryBase);
  const focusLine = useLab((s) => s.focusLine);
  const listing = useLab((s) => s.listing);

  /** Address range of the focused source line (from the last assembly). */
  const focusRange = useMemo(() => {
    if (focusLine === null) return null;
    const e = listing.find((l) => l.line === focusLine && l.addr !== null);
    if (!e || e.addr === null || e.bytes.length === 0) return null;
    return { from: e.addr, to: e.addr + e.bytes.length - 1 };
  }, [focusLine, listing]);

  // Follow the focused line: jump to its page when it's out of view.
  useEffect(() => {
    if (!focusRange) return;
    if (focusRange.from < base || focusRange.to >= base + 0x100) {
      setMemoryBase(focusRange.from);
    }
  }, [focusRange, base, setMemoryBase]);

  // Union of cells changed across (possibly double-) renders since last paint.
  const changedRef = useRef<Set<number>>(new Set());
  useEffect(() => {
    const c = machine.memory.takeChanged();
    const merged = changedRef.current;
    for (const a of c) merged.add(a);
    const t = setTimeout(() => merged.clear(), 900); // let the flash fade
    return () => clearTimeout(t);
  }, [version]);

  const pc = machine.cpu.pc;
  const rows = [];
  for (let r = 0; r < 16; r++) {
    const cells = [];
    for (let cIdx = 0; cIdx < 16; cIdx++) {
      const addr = base + r * 16 + cIdx;
      const v = machine.memory.read(addr);
      const changed = changedRef.current.has(addr);
      const isPc = addr === pc;
      const inLine = focusRange !== null && addr >= focusRange.from && addr <= focusRange.to;
      cells.push(
        <td
          key={cIdx}
          className={`mem-cell ${changed ? 'mem-changed' : ''} ${isPc ? 'mem-pc' : ''} ${inLine ? 'mem-line' : ''}`}
        >
          {v.toString(16).toUpperCase().padStart(2, '0')}
        </td>,
      );
    }
    rows.push(
      <tr key={r}>
        <td className="mem-addr">{hex4(base + r * 16)}</td>
        {cells}
      </tr>,
    );
  }

  return (
    <Panel
      id="memory"
      title="Memory"
      extra={
        <span className="mem-nav">
          <button type="button" className="btn btn-small" onClick={() => setMemoryBase(base - 0x100)} title="Previous page">
            ◀
          </button>
          <input
            className="mem-goto"
            value={hex4(base)}
            onChange={(e) => {
              const m = /^([0-9a-f]{1,4})h?$/i.exec(e.target.value.trim());
              if (m && m[1]) setMemoryBase(parseInt(m[1], 16));
            }}
            title="Page base address (hex)"
          />
          <button type="button" className="btn btn-small" onClick={() => setMemoryBase(base + 0x100)} title="Next page">
            ▶
          </button>
        </span>
      }
    >
      <div className="mem-scroll">
        <table className="mem-table">
          <tbody>{rows}</tbody>
        </table>
      </div>
    </Panel>
  );
}
