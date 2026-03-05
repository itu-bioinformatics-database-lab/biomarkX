import React, { useState, useEffect } from 'react';
import HelpTooltip from './common/HelpTooltip';
import '../css/ResamplingConfigModal.css';

const RESAMPLING_METHODS = [
  { value: 'smote', label: 'SMOTE (Synthetic Minority Over-sampling Technique)' },
  { value: 'adasyn', label: 'ADASYN (Adaptive Synthetic Sampling)' },
];

const SAMPLING_STRATEGY_OPTIONS = [
  { value: 'auto', label: 'Auto — resample all classes except the majority' },
  { value: 'minority', label: 'Minority — resample only the minority class' },
  { value: 'not minority', label: 'Not Minority — resample all classes except the minority' },
  { value: 'all', label: 'All — resample all classes' },
];

const DEFAULT_CONFIG = {
  method: 'smote',
  smote: {
    k_neighbors: 5,
    sampling_strategy: 'auto',
  },
  adasyn: {
    n_neighbors: 5,
    sampling_strategy: 'auto',
  },
};

/**
 * ResamplingConfigModal
 *
 * An optional Step 4.5 panel that lets users configure SMOTE or ADASYN
 * oversampling before running the analysis pipeline.  The component follows
 * the same UI conventions as NormalizationConfigModal.
 *
 * Props
 * -----
 * onClose   : () => void   — called when the user cancels
 * onApply   : (config) => void — called with the resampling config object
 * classDistribution : Array<{ name: string, count: number }> — optional class counts shown as a hint
 */
const ResamplingConfigModal = ({ onClose, onApply, classDistribution = [] }) => {
  const [config, setConfig] = useState(DEFAULT_CONFIG);

  useEffect(() => {
    document.body.classList.add('resampling-modal-open');
    return () => document.body.classList.remove('resampling-modal-open');
  }, []);

  const updateSmote = (field, value) => {
    setConfig((prev) => ({
      ...prev,
      smote: { ...prev.smote, [field]: value },
    }));
  };

  const updateAdasyn = (field, value) => {
    setConfig((prev) => ({
      ...prev,
      adasyn: { ...prev.adasyn, [field]: value },
    }));
  };

  const handleApply = () => {
    const method = config.method;

    // Normalise numeric values
    const params = {};
    if (method === 'smote') {
      params.k_neighbors = Math.max(1, parseInt(config.smote.k_neighbors, 10) || 5);
      params.sampling_strategy = config.smote.sampling_strategy;
    } else {
      params.n_neighbors = Math.max(1, parseInt(config.adasyn.n_neighbors, 10) || 5);
      params.sampling_strategy = config.adasyn.sampling_strategy;
    }

    onApply({ method, params });
  };

  // Compute per-class training estimates for the distribution table (shown only when counts are available)
  const hasCounts = classDistribution.some((c) => c.count > 0);
  const sortedDist = classDistribution.slice().sort((a, b) => b.count - a.count);
  const maxTrain = Math.max(...sortedDist.map((c) => Math.round(c.count * 0.8)), 0);

  return (
    <div className="resampling-modal-overlay" onClick={onClose}>
      <div className="resampling-modal" onClick={(e) => e.stopPropagation()}>

        {/* Header */}
        <div className="resampling-modal-header">
          <h3>Step 4.5 — Class Imbalance Resampling</h3>
          <button className="resampling-modal-close" onClick={onClose} aria-label="Close">&times;</button>
        </div>

        <div className="resampling-modal-body">

          {/* Info banner */}
          <div className="resampling-info-banner">
            <p>
              Oversampling creates additional synthetic training samples for minority
              classes so all classes are better represented during model training.
              The resampling is applied <strong>only to the training set</strong> to
              prevent data leakage into the test set.
            </p>

            {/* Class distribution table */}
            {classDistribution.length > 0 && (
              <div className="resampling-modal-dist">
                <p className="resampling-modal-dist__title">Class distribution in your dataset:</p>
                <table className="resampling-modal-dist__table">
                  <thead>
                    <tr>
                      <th>Class</th>
                      <th>Total samples</th>
                      {hasCounts && <th>~Training (80%)</th>}
                      {hasCounts && <th>After resampling (auto)</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {sortedDist.map((cls) => {
                      const trainCount = Math.round(cls.count * 0.8);
                      const synthetic = hasCounts && trainCount < maxTrain ? maxTrain - trainCount : 0;
                      const isMajority = hasCounts && trainCount === maxTrain;
                      return (
                        <tr key={cls.name} className={hasCounts ? (isMajority ? 'resampling-row-majority' : 'resampling-row-minority') : ''}>
                          <td><strong>{cls.name}</strong></td>
                          <td>{hasCounts ? cls.count.toLocaleString() : '—'}</td>
                          {hasCounts && <td>{trainCount.toLocaleString()}</td>}
                          {hasCounts && (
                            <td>
                              {synthetic > 0
                                ? <span className="resampling-synthetic-badge">{trainCount.toLocaleString()} + {synthetic.toLocaleString()} synthetic → {maxTrain.toLocaleString()}</span>
                                : <span className="resampling-majority-badge">{maxTrain.toLocaleString()} (majority)</span>
                              }
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {hasCounts && (
                  <p className="resampling-modal-dist__note">
                    Training estimate based on 80/20 split. Synthetic counts are approximate for the <em>auto</em> strategy.
                  </p>
                )}
              </div>
            )}
          </div>

          {/* 1. Method */}
          <div className="resampling-pipeline-step">
            <div className="resampling-step-header">
              <span className="resampling-step-title">1. Resampling Method</span>
              <HelpTooltip
                useFixedPosition
                placement="right"
                text="SMOTE creates synthetic samples by interpolating between existing minority-class samples. ADASYN adapts the number of synthetic samples per region based on local class density — it generates more samples in harder-to-learn areas."
              >
                info
              </HelpTooltip>
            </div>
            <div className="resampling-step-params">
              <div className="resampling-param-row">
                <label>Method</label>
                <select
                  value={config.method}
                  onChange={(e) => setConfig((prev) => ({ ...prev, method: e.target.value }))}
                >
                  {RESAMPLING_METHODS.map((m) => (
                    <option key={m.value} value={m.value}>{m.label}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* 2. Method-specific parameters */}
          {config.method === 'smote' && (
            <div className="resampling-pipeline-step">
              <div className="resampling-step-header">
                <span className="resampling-step-title">2. SMOTE Parameters</span>
              </div>
              <div className="resampling-step-params">
                <div className="resampling-param-row">
                  <label>
                    k Neighbors
                    <HelpTooltip
                      useFixedPosition
                      text="Number of nearest neighbours used when constructing synthetic samples. Must be less than the number of minority-class samples. Default: 5."
                    >
                      info
                    </HelpTooltip>
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={20}
                    value={config.smote.k_neighbors}
                    onChange={(e) => updateSmote('k_neighbors', parseInt(e.target.value, 10) || 5)}
                  />
                </div>
                <div className="resampling-param-row">
                  <label>
                    Sampling Strategy
                    <HelpTooltip
                      useFixedPosition
                      text="Determines which classes are resampled. 'Auto' resamples all classes except the majority class to match its count."
                    >
                      info
                    </HelpTooltip>
                  </label>
                  <select
                    value={config.smote.sampling_strategy}
                    onChange={(e) => updateSmote('sampling_strategy', e.target.value)}
                  >
                    {SAMPLING_STRATEGY_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
          )}

          {config.method === 'adasyn' && (
            <div className="resampling-pipeline-step">
              <div className="resampling-step-header">
                <span className="resampling-step-title">2. ADASYN Parameters</span>
              </div>
              <div className="resampling-step-params">
                <div className="resampling-param-row">
                  <label>
                    n Neighbors
                    <HelpTooltip
                      useFixedPosition
                      text="Number of nearest neighbours used to compute the density distribution. Must be less than the number of minority-class samples. Default: 5."
                    >
                      info
                    </HelpTooltip>
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={20}
                    value={config.adasyn.n_neighbors}
                    onChange={(e) => updateAdasyn('n_neighbors', parseInt(e.target.value, 10) || 5)}
                  />
                </div>
                <div className="resampling-param-row">
                  <label>
                    Sampling Strategy
                    <HelpTooltip
                      useFixedPosition
                      text="Determines which classes are resampled. 'Auto' resamples all classes except the majority class to match its count."
                    >
                      info
                    </HelpTooltip>
                  </label>
                  <select
                    value={config.adasyn.sampling_strategy}
                    onChange={(e) => updateAdasyn('sampling_strategy', e.target.value)}
                  >
                    {SAMPLING_STRATEGY_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
          )}

          {/* Warning */}
          <div className="resampling-warning-banner">
            <strong>Note:</strong> Resampling increases training-set size and may extend analysis time.
            If a minority class has fewer samples than <em>k/n neighbors + 1</em>, the pipeline will
            automatically skip resampling for that run and log a warning.
          </div>

        </div>

        {/* Footer */}
        <div className="resampling-modal-footer">
          <div className="resampling-footer-buttons">
            <button className="resampling-btn-cancel" onClick={onClose}>Cancel</button>
            <button className="resampling-btn-apply" onClick={handleApply}>
              Apply Resampling
            </button>
          </div>
        </div>

      </div>
    </div>
  );
};

export default ResamplingConfigModal;
