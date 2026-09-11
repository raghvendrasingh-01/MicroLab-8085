/**
 * CPU registers + flags + disassembly of the next instruction.
 * Values flash briefly when they change (spec §27). The flash is applied
 * imperatively from an effect — computing it during render is discarded by
 * StrictMode's double render, so the class would never reach the DOM.
 */
import { useEffect, useMemo, useRef } from 'react';
import { machine, useLab, hex4 } from '../../store/labStore';
import { Panel } from './Panel';

export function RegistersPanel(): React.JSX.Element {
  useLab((s) => s.version); // re-render on every simulation change
  const cpu = machine.cpu;

  const next = useMemo(
    () => {
      try {
        return cpu.disassembleAt(cpu.pc);
      } catch {
        return { text: '??', bytes: [] as number[] };
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cpu.pc, cpu.a, cpu.b, cpu.c, cpu.d, cpu.e, cpu.h, cpu.l, machine.totalInstructions],
  );

  const regs: Array<[string, number]> = [
    ['A', cpu.a], ['B', cpu.b], ['C', cpu.c], ['D', cpu.d],
    ['E', cpu.e], ['H', cpu.h], ['L', cpu.l],
  ];
  const flags: Array<[string, boolean]> = [
    ['S', cpu.fS], ['Z', cpu.fZ], ['AC', cpu.fAC], ['P', cpu.fP], ['CY', cpu.fCY],
  ];

  /* --- flash-on-change (§27) --- */
  const valEls = useRef(new Map<string, HTMLElement>());
  const prevVals = useRef<Record<string, number>>({});
  const setValRef = (name: string) => (el: HTMLElement | null) => {
    if (el) valEls.current.set(name, el);
    else valEls.current.delete(name);
  };
  const current: Record<string, number> = {};
  for (const [name, v] of regs) current[name] = v;
  current['PC'] = cpu.pc;
  current['SP'] = cpu.sp;
  for (const [name, on] of flags) current[name] = on ? 1 : 0;

  useEffect(() => {
    for (const [name, el] of valEls.current) {
      const v = current[name] ?? 0;
      const p = prevVals.current[name];
      if (p !== undefined && p !== v) {
        // Remove + forced reflow + re-add so consecutive changes replay the
        // animation even though the class is still attached.
        el.classList.remove('reg-flash');
        void el.offsetWidth;
        el.classList.add('reg-flash');
      }
      prevVals.current[name] = v;
    }
  });

  return (
    <Panel id="cpu" title="CPU 8085">
      <div className="regs-grid">
        {regs.map(([name, v]) => (
          <div key={name} className="reg">
            <span className="reg-name">{name}</span>
            <span className="reg-val" ref={setValRef(name)}>{hex2(v)}</span>
          </div>
        ))}
      </div>
      <div className="reg-row">
        <div className="reg wide">
          <span className="reg-name">PC</span>
          <span className="reg-val" ref={setValRef('PC')}>{hex4(cpu.pc)}</span>
        </div>
        <div className="reg wide">
          <span className="reg-name">SP</span>
          <span className="reg-val" ref={setValRef('SP')}>{hex4(cpu.sp)}</span>
        </div>
      </div>
      <div className="flags">
        {flags.map(([name, on]) => (
          <span key={name} className={`flag ${on ? 'flag-on' : ''}`}>
            {name}
          </span>
        ))}
      </div>
      <div className="next-instr" title="Instruction at PC">
        <code>{next.text}</code>
      </div>
      <div className="counters">
        {machine.totalInstructions} instr · {machine.totalTstates} T
      </div>
    </Panel>
  );
}

function hex2(v: number): string {
  return (v & 0xff).toString(16).toUpperCase().padStart(2, '0');
}
