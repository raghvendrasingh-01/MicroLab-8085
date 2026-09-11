/**
 * Delete confirmation: deleting a component also removes every wire attached
 * to it, so the action deserves one explicit "are you sure" — with the wire
 * count spelled out. Opened from the canvas context menu and the Delete key.
 */
import { useEffect } from 'react';
import { machine, useLab } from '../../store/labStore';
import { useUi } from '../../store/uiStore';

export function ConfirmDelete(): React.JSX.Element | null {
  const confirmDelete = useUi((s) => s.confirmDelete);
  const dismiss = useUi((s) => s.dismissDelete);

  const c = confirmDelete ? machine.circuit.get(confirmDelete.id) : undefined;
  const wires = confirmDelete
    ? machine.circuit.connections.filter((w) => w.fromComponent === confirmDelete.id || w.toComponent === confirmDelete.id)
        .length
    : 0;

  // Keyboard: Enter confirms, Escape cancels — while the dialog is open.
  useEffect(() => {
    if (!confirmDelete) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        dismiss();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        useLab.getState().removeComponent(confirmDelete.id);
        dismiss();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [confirmDelete, dismiss]);

  if (!confirmDelete) return null;

  return (
    <div
      className="dialog-overlay"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) dismiss();
      }}
    >
      <div className="dialog" role="alertdialog" aria-modal="true" aria-label="Delete component">
        <div className="dialog-title">Delete {c ? c.label : 'component'}?</div>
        <p className="dialog-text">
          {c ? <>{c.label} will be removed from the bench.</> : <>This component is already gone.</>}
          {wires > 0 && (
            <>
              {' '}
              <strong>{wires} wire{wires === 1 ? '' : 's'}</strong> connected to it will be removed as well.
            </>
          )}
        </p>
        <div className="dialog-actions">
          <button type="button" className="btn" onClick={dismiss}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-danger"
            autoFocus
            onClick={() => {
              useLab.getState().removeComponent(confirmDelete.id);
              dismiss();
            }}
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}
