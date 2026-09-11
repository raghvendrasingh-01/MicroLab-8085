/**
 * Palette: every registered component type, grouped into categories with a
 * search filter. The whole row adds the component — the [+] is an affordance,
 * not the only target (spec §32).
 */
import { useMemo, useState } from 'react';
import { useLab } from '../../store/labStore';
import { ALL_TYPES, metaFor } from '../registry';
import { Panel } from './Panel';

/** Category order in the palette. Only non-empty groups render (§30). */
const CATEGORIES: ReadonlyArray<Readonly<{ name: string; types: readonly string[] }>> = [
  { name: 'Interfaces', types: ['i8255'] },
  { name: 'Digital I/O', types: ['ledBank', 'dipSwitches', 'sevenSegment', 'keypad', 'lcd1602'] },
  { name: 'Analog', types: ['adc0808', 'potentiometer', 'tempSensor', 'lightSensor', 'dac0808'] },
  { name: 'Tools', types: ['scope'] },
];

export function Palette(): React.JSX.Element {
  const addComponent = useLab((s) => s.addComponent);
  const openAbout = useLab((s) => s.openAbout);
  const [query, setQuery] = useState('');

  /** Categories (with their types) that survive the current search. */
  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const inCategory = (name: string) => name.toLowerCase().includes(q);
    return CATEGORIES.map((cat) => ({
      name: cat.name,
      rows: cat.types
        .filter((t) => ALL_TYPES.includes(t))
        .filter((t) => {
          if (!q || inCategory(cat.name)) return true;
          const meta = metaFor(t);
          return (
            meta?.title.toLowerCase().includes(q) ||
            meta?.short.toLowerCase().includes(q) ||
            t.toLowerCase().includes(q)
          );
        })
        .map((t) => ({ t, meta: metaFor(t) }))
        .filter((r) => r.meta),
    })).filter((cat) => cat.rows.length > 0);
  }, [query]);

  return (
    <Panel id="components" title="Components">
      <input
        className="palette-search"
        type="text"
        placeholder="Search components…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        title="Filter by name, description or category"
      />
      <div className="palette">
        {groups.map((cat) => (
          <div key={cat.name} className="palette-cat">
            <div className="palette-cat-name">{cat.name}</div>
            {cat.rows.map(({ t, meta }) => (
              <div
                key={t}
                className="palette-row"
                role="button"
                tabIndex={0}
                title={`Add ${meta!.title} to the circuit`}
                onClick={() => addComponent(t)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    addComponent(t);
                  }
                }}
              >
                <div className="palette-text">
                  <span className="palette-title">{meta!.title}</span>
                  <span className="palette-short">{meta!.short}</span>
                </div>
                <button
                  type="button"
                  className="btn btn-small"
                  title={`What is a ${meta!.title}?`}
                  onClick={(e) => {
                    e.stopPropagation();
                    openAbout(t);
                  }}
                >
                  ⓘ
                </button>
                <button
                  type="button"
                  className="btn btn-small btn-primary"
                  title={`Add ${meta!.title} to the circuit`}
                  onClick={(e) => {
                    e.stopPropagation();
                    addComponent(t);
                  }}
                >
                  +
                </button>
              </div>
            ))}
          </div>
        ))}
        {groups.length === 0 && (
          <div className="palette-empty">No components match “{query.trim()}”.</div>
        )}
      </div>
    </Panel>
  );
}
