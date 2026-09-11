/**
 * Lab Mode dialog: the educational "about" text for a component type.
 */
import { useLab } from '../../store/labStore';
import { metaFor } from '../registry';

export function AboutDialog(): React.JSX.Element | null {
  const aboutType = useLab((s) => s.aboutType);
  const openAbout = useLab((s) => s.openAbout);
  if (!aboutType) return null;
  const meta = metaFor(aboutType);
  if (!meta) return null;

  return (
    <div className="modal-backdrop" onClick={() => openAbout(null)}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-title">
          {meta.title}
          <button type="button" className="btn btn-small" onClick={() => openAbout(null)}>
            ✕
          </button>
        </div>
        <div className="modal-body">
          <p className="modal-short">{meta.short}</p>
          <p>{meta.about}</p>
        </div>
      </div>
    </div>
  );
}
