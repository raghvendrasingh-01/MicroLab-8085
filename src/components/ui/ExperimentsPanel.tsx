/**
 * ExperimentsPanel: the prebuilt lab library. One click loads a wired
 * circuit + a working program; the active experiment's explanation and
 * expected result stay visible while it runs.
 */
import { useLab } from '../../store/labStore';
import { EXPERIMENTS } from '../../experiments';
import { Panel } from './Panel';

export function ExperimentsPanel(): React.JSX.Element {
  const loadExperiment = useLab((s) => s.loadExperiment);
  const activeExperiment = useLab((s) => s.activeExperiment);
  const active = EXPERIMENTS.find((e) => e.id === activeExperiment);

  return (
    <Panel id="experiments" title="Experiments">
      <div className="experiments">
        {EXPERIMENTS.map((exp) => (
          <div
            key={exp.id}
            className={'experiment-row' + (exp.id === activeExperiment ? ' experiment-active' : '')}
          >
            <div className="experiment-text">
              <span className="experiment-title">{exp.title}</span>
              <span className="experiment-blurb">{exp.blurb}</span>
            </div>
            <button
              type="button"
              className="btn btn-small btn-primary"
              title={`Load "${exp.title}" — wires the circuit and loads its program`}
              onClick={() => loadExperiment(exp.id)}
            >
              Load
            </button>
          </div>
        ))}
      </div>
      {active && (
        <div className="experiment-detail">
          <div className="experiment-detail-title">{active.title}</div>
          <p>{active.explanation}</p>
          <p className="experiment-expected">
            <strong>Expected:</strong> {active.expected}
          </p>
        </div>
      )}
    </Panel>
  );
}
