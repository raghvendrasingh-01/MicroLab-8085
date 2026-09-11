/**
 * Code panel: line-numbered assembly editor with breakpoints in the gutter,
 * a per-line machine-code column (toggleable), source-line ↔ memory
 * correlation (click a line's bytes → the memory panel highlights them),
 * the PC line marked, and clickable assembly errors.
 */
import { useEffect, useMemo, useRef } from 'react';
import { useLab, machine, hex4 } from '../../store/labStore';
import { useUi } from '../../store/uiStore';
import { Panel } from './Panel';
import { HSep } from './Sep';

const ROW_H = 18.5;

export function CodePanel(): React.JSX.Element {
  const source = useLab((s) => s.source);
  const setSource = useLab((s) => s.setSource);
  const assemble = useLab((s) => s.assemble);
  const asmErrors = useLab((s) => s.asmErrors);
  const listing = useLab((s) => s.listing);
  const version = useLab((s) => s.version);
  const toggleBreakpoint = useLab((s) => s.toggleBreakpoint);
  const focusLine = useLab((s) => s.focusLine);
  const setFocusLine = useLab((s) => s.setFocusLine);
  const editorH = useUi((s) => s.editorH);
  const setEditorH = useUi((s) => s.setEditorH);
  const showOpcodes = useUi((s) => s.showOpcodes);
  const toggleOpcodes = useUi((s) => s.toggleOpcodes);

  const taRef = useRef<HTMLTextAreaElement>(null);
  const gutterRef = useRef<HTMLDivElement>(null);
  const opcRef = useRef<HTMLDivElement>(null);

  const lines = useMemo(() => source.split('\n'), [source]);
  /** line number → listing entry (address + emitted bytes). */
  const byLine = useMemo(() => {
    const m = new Map<number, { addr: number; bytes: number[] }>();
    for (const l of listing) if (l.addr !== null) m.set(l.line, { addr: l.addr, bytes: l.bytes });
    return m;
  }, [listing]);
  const errorLines = useMemo(() => new Set(asmErrors.map((e) => e.line)), [asmErrors]);

  const pc = machine.cpu.pc; // re-rendered via version
  const pcLine = useMemo(() => {
    let best: number | null = null;
    for (const [line, { addr }] of byLine) {
      if (addr <= pc && (best === null || addr > (byLine.get(best)?.addr ?? -1))) best = line;
    }
    return best;
  }, [byLine, pc, version]);

  /* A newly focused line (error click / opcode click) scrolls into view. */
  useEffect(() => {
    if (focusLine === null || !taRef.current) return;
    const ta = taRef.current;
    const top = (focusLine - 1) * ROW_H;
    if (top < ta.scrollTop || top + ROW_H > ta.scrollTop + ta.clientHeight - ROW_H) {
      ta.scrollTop = Math.max(0, top - ta.clientHeight / 2);
      if (gutterRef.current) gutterRef.current.scrollTop = ta.scrollTop;
      if (opcRef.current) opcRef.current.scrollTop = ta.scrollTop;
    }
  }, [focusLine]);

  const onScroll = () => {
    if (gutterRef.current && taRef.current) gutterRef.current.scrollTop = taRef.current.scrollTop;
    if (opcRef.current && taRef.current) opcRef.current.scrollTop = taRef.current.scrollTop;
  };

  const rowCls = (ln: number) =>
    `${ln === focusLine ? 'is-focused' : ''} ${ln === pcLine ? 'is-pc' : ''} ${errorLines.has(ln) ? 'is-err' : ''}`;

  return (
    <Panel
      id="program"
      title="Program"
      className="code-panel"
      style={{ '--editor-h': editorH !== null ? `${editorH}px` : undefined } as React.CSSProperties}
      extra={
        <>
          <button
            type="button"
            className={`btn btn-small ${showOpcodes ? 'btn-active' : ''}`}
            onClick={toggleOpcodes}
            title="Show / hide the machine-code column (hex bytes per line)"
          >
            ⌗ Bytes
          </button>
          <button type="button" className="btn btn-small" onClick={() => assemble()} title="Ctrl+Enter">
            Assemble ▶
          </button>
        </>
      }
    >
      <div className="editor-wrap">
        <div className="gutter" ref={gutterRef}>
          {lines.map((_, i) => {
            const ln = i + 1;
            const e = byLine.get(ln);
            const hasBp = e !== undefined && machine.breakpoints.has(e.addr);
            return (
              <div
                key={ln}
                className={`gutter-row ${rowCls(ln)}`}
                onClick={() => e !== undefined && toggleBreakpoint(e.addr)}
                title={e !== undefined ? `${hex4(e.addr)}H — click to toggle breakpoint` : undefined}
              >
                <span className={`bp-dot ${hasBp ? 'bp-on' : ''}`} />
                <span className="ln">{ln}</span>
                {ln === pcLine && <span className="pc-arrow">▶</span>}
              </div>
            );
          })}
        </div>
        {showOpcodes && (
          <div className="opc-col" ref={opcRef}>
            {lines.map((_, i) => {
              const ln = i + 1;
              const e = byLine.get(ln);
              return (
                <button
                  key={ln}
                  type="button"
                  className={`opc-row ${rowCls(ln)} ${e ? 'has-bytes' : ''}`}
                  onClick={() => {
                    setFocusLine(ln === focusLine ? null : ln);
                    if (ln !== focusLine) useUi.getState().setCollapsed('memory', false);
                  }}
                  title={
                    e
                      ? `${hex4(e.addr)}H — ${e.bytes.map((b) => b.toString(16).toUpperCase().padStart(2, '0')).join(' ')} — click to highlight these bytes in Memory`
                      : undefined
                  }
                >
                  {e ? e.bytes.map((b) => b.toString(16).toUpperCase().padStart(2, '0')).join(' ') : ''}
                </button>
              );
            })}
          </div>
        )}
        <textarea
          ref={taRef}
          className="code-input"
          value={source}
          spellCheck={false}
          onChange={(e) => setSource(e.target.value)}
          onScroll={onScroll}
          onKeyDown={(e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
              e.preventDefault();
              assemble();
            }
          }}
        />
      </div>
      <HSep
        getStart={() => taRef.current?.parentElement?.getBoundingClientRect().height ?? 300}
        setH={setEditorH}
        min={140}
        max={720}
        dir="down"
        label="Resize program editor"
      />
      {asmErrors.length > 0 && (
        <div className="asm-errors">
          {asmErrors.map((e, i) => (
            <button key={i} type="button" className="asm-error" onClick={() => setFocusLine(e.line)}>
              <b>line {e.line}</b> {e.message}
            </button>
          ))}
        </div>
      )}
    </Panel>
  );
}
