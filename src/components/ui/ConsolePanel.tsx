/**
 * Console panel: lab messages — assembly results, wiring feedback, CPU
 * errors, peripheral warnings. Newest at the bottom, auto-scrolled.
 */
import { useEffect, useRef } from 'react';
import { useLab } from '../../store/labStore';
import { useUi } from '../../store/uiStore';
import { Panel } from './Panel';
import { HSep } from './Sep';

export function ConsolePanel(): React.JSX.Element {
  const entries = useLab((s) => s.console);
  const clearConsole = useLab((s) => s.clearConsole);
  const consoleH = useUi((s) => s.consoleH);
  const setConsoleH = useUi((s) => s.setConsoleH);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [entries]);

  return (
    <Panel
      id="console"
      title="Console"
      className="console-panel"
      style={{ '--console-h': consoleH !== null ? `${consoleH}px` : undefined } as React.CSSProperties}
      extra={
        <button type="button" className="btn btn-small" onClick={() => clearConsole()}>
          Clear
        </button>
      }
    >
      <HSep
        getStart={() => document.querySelector<HTMLElement>('[data-panel="console"]')?.getBoundingClientRect().height ?? 190}
        setH={setConsoleH}
        min={100}
        max={420}
        dir="up"
        label="Resize console"
      />
      <div className="console-scroll" ref={ref}>
        {entries.map((e) =>
          e.line !== undefined ? (
            <button
              key={e.id}
              type="button"
              className={`console-line console-${e.kind} console-jump`}
              onClick={() => {
                useLab.getState().setFocusLine(e.line!);
                useUi.getState().setCollapsed('memory', false);
              }}
              title="Jump to this line in the editor"
            >
              {e.text}
            </button>
          ) : (
            <div key={e.id} className={`console-line console-${e.kind}`}>
              {e.text}
            </div>
          ),
        )}
      </div>
    </Panel>
  );
}
