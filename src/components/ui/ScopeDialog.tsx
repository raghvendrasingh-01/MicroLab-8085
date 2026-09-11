/**
 * Expanded oscilloscope view (spec §37): a large overlay with the same
 * channels and window, channel-visibility chips, Esc / outside-click to
 * close. The canvas card keeps its modest default size.
 */
import { useEffect } from 'react';
import { machine, useLab } from '../../store/labStore';
import { useUi } from '../../store/uiStore';
import type { Oscilloscope } from '../scope';
import { ScopeTrace, ScopeChips } from './bodies';

export function ScopeDialog(): React.JSX.Element | null {
  const id = useUi((s) => s.expandedScope);
  useLab((s) => s.version); // re-render as the trace advances
  const interact = useLab((s) => s.interact);

  useEffect(() => {
    if (id === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        useUi.getState().setExpandedScope(null);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [id]);

  if (id === null) return null;
  const c = machine.circuit.get(id);
  if (!c || c.type !== 'scope') return null;
  const scope = c as Oscilloscope;

  return (
    <div
      className="dialog-overlay"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) useUi.getState().setExpandedScope(null);
      }}
    >
      <div className="dialog scope-dialog" role="dialog" aria-label={`${c.label} — expanded view`}>
        <div className="dialog-title">{c.label} — expanded view</div>
        <div className="scope-dialog-controls">
          <ScopeChips scope={scope} onToggle={(ch) => interact(scope.id, `ch${ch}`)} />
          <span className="scope-info">
            window {scope.windowTstates.toLocaleString('en-US')} T · t ={' '}
            {scope.now().toLocaleString('en-US')} T · {machine.totalInstructions.toLocaleString('en-US')} instr
          </span>
        </div>
        <div className="scope-dialog-body">
          <ScopeTrace scope={scope} W={880} laneH={96} />
        </div>
        <div className="dialog-actions">
          <button
            type="button"
            className="btn"
            autoFocus
            onClick={() => useUi.getState().setExpandedScope(null)}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
