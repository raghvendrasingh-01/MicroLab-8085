/**
 * Inspector: properties of the selected component (label, base address,
 * options), address decoding summary for peripherals, and delete buttons for
 * components and wires.
 */
import { useState } from 'react';
import { machine, useLab, hex2 } from '../../store/labStore';
import { Panel } from './Panel';
import { isPeripheral, type Peripheral } from '../../core/circuit';
import { metaFor } from '../registry';

export function InspectorPanel(): React.JSX.Element {
  const version = useLab((s) => s.version);
  const selected = useLab((s) => s.selected);
  const selectedWire = useLab((s) => s.selectedWire);
  const setProp = useLab((s) => s.setProp);
  const setLabel = useLab((s) => s.setLabel);
  const removeComponent = useLab((s) => s.removeComponent);
  const disconnectWire = useLab((s) => s.disconnectWire);
  const openAbout = useLab((s) => s.openAbout);

  const c = selected ? machine.circuit.get(selected) : undefined;
  const [labelDraft, setLabelDraft] = useState(c?.label ?? '');
  const [labelFor, setLabelFor] = useState(selected);
  if (selected !== labelFor) {
    setLabelFor(selected);
    setLabelDraft(c?.label ?? '');
  }

  const wire = selectedWire ? machine.circuit.connections.find((w) => w.id === selectedWire) : undefined;

  if (wire && !c) {
    const a = machine.circuit.get(wire.fromComponent);
    const b = machine.circuit.get(wire.toComponent);
    return (
      <Panel id="inspector" title="Wire">
        <div className="insp-body">
          <div className="insp-line">
            {a?.label}.{wire.fromPin} → {b?.label}.{wire.toPin}
          </div>
          <button type="button" className="btn btn-danger" onClick={() => disconnectWire(wire.id)}>
            Delete wire
          </button>
        </div>
      </Panel>
    );
  }

  if (!c) {
    return (
      <Panel id="inspector" title="Inspector">
        <div className="insp-body insp-hint">
          Select a component on the canvas to edit its properties. Click a pin,
          then another pin, to wire them (shift-click wires an 8-bit bus).
        </div>
      </Panel>
    );
  }

  const meta = metaFor(c.type);
  const peripheral = isPeripheral(c) ? (c as Peripheral) : null;
  void version; // re-render on simulation changes (pin dirs shown below)

  return (
    <Panel
      id="inspector"
      title="Inspector"
      extra={
        meta ? (
          <button type="button" className="btn btn-small" onClick={() => openAbout(c.type)}>
            About {meta.title}
          </button>
        ) : undefined
      }
    >
      <div className="insp-body">
        <label className="insp-field">
          Label
          <input
            value={labelDraft}
            onChange={(e) => setLabelDraft(e.target.value)}
            onBlur={() => labelDraft.trim() && setLabel(c.id, labelDraft)}
            onKeyDown={(e) => e.key === 'Enter' && labelDraft.trim() && setLabel(c.id, labelDraft)}
          />
        </label>

        {peripheral && (
          <div className="insp-field">
            <span>Addresses ({hex2(peripheral.baseAddress)}H–{hex2(peripheral.baseAddress + peripheral.addressCount - 1)}H)</span>
            <div className="addr-list">
              {Array.from({ length: peripheral.addressCount }, (_, i) => (
                <div key={i} className="addr-row">
                  <code>{hex2(peripheral.baseAddress + i)}H</code> {peripheral.describeAddress(i)}
                </div>
              ))}
            </div>
          </div>
        )}

        {c.getProperties().map((prop) => (
          <label key={prop.key} className="insp-field">
            {prop.label}
            {prop.kind === 'boolean' ? (
              <input
                type="checkbox"
                checked={Boolean(c.getConfig()[prop.key])}
                onChange={(e) => setProp(c.id, prop.key, e.target.checked)}
              />
            ) : prop.kind === 'select' ? (
              <select
                value={String(c.getConfig()[prop.key] ?? '')}
                onChange={(e) => setProp(c.id, prop.key, e.target.value)}
              >
                {prop.options?.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            ) : (
              <input
                type="number"
                min={prop.min}
                max={prop.max}
                value={Number(c.getConfig()[prop.key] ?? 0)}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  if (!Number.isNaN(v)) setProp(c.id, prop.key, v);
                }}
              />
            )}
          </label>
        ))}

        <button type="button" className="btn btn-danger" onClick={() => removeComponent(c.id)}>
          Delete {c.label}
        </button>
      </div>
    </Panel>
  );
}
