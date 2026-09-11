/**
 * "Why isn't it working?" — a live checklist computed from the simulation.
 * Re-runs runDiagnostics on every store version bump (each instruction batch,
 * wire change, assembly…), so it always describes the machine as it is now.
 */
import { machine, useLab } from '../../store/labStore';
import { Panel } from './Panel';
import { runDiagnostics } from '../../diagnostics';

export function DiagnosticsPanel(): React.JSX.Element {
  const version = useLab((s) => s.version);
  const asmErrors = useLab((s) => s.asmErrors);
  const asmOk = useLab((s) => s.asmOk);
  void version; // re-render trigger

  const checks = runDiagnostics(machine, {
    asmErrorCount: asmOk ? 0 : asmErrors.length,
    hasProgram: machine.entryPoint !== null,
  });
  const bad = checks.filter((c) => c.status === 'bad').length;
  const headline =
    bad > 0 ? `${bad} problem${bad === 1 ? '' : 's'} found` : checks.length > 0 ? 'All checks pass' : '';

  return (
    <Panel
      id="diagnostics"
      title="Diagnostics"
      extra={
        headline ? (
          <span className={'diag-headline' + (bad > 0 ? ' diag-bad-text' : ' diag-ok-text')}>{headline}</span>
        ) : undefined
      }
    >
      <ul className="diag-list">
        {checks.map((c, i) => (
          <li key={i} className={`diag diag-${c.status}`}>
            <span className="diag-mark" aria-hidden>
              {c.status === 'ok' ? '✓' : c.status === 'bad' ? '✗' : '•'}
            </span>
            <span className="diag-text">{c.text}</span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
