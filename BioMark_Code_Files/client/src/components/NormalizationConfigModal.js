import React, { useState, useMemo, useEffect } from 'react';
import HelpTooltip from './common/HelpTooltip';
import '../css/NormalizationConfigModal.css';

const NORMALIZATION_METHODS = [
  { value: 'zscore', label: 'Z-Score' },
  { value: 'minmax', label: 'Min-Max' },
  { value: 'quantile', label: 'Quantile Normalization' },
];

const OUTLIER_METHODS = [
  { value: 'iqr', label: 'IQR' },
  { value: 'zscore', label: 'Z-Score' },
  { value: 'isolation_forest', label: 'Isolation Forest' },
];

const OUTLIER_ACTIONS = [
  { value: 'impute', label: 'Impute (fill with average)' },
  { value: 'remove', label: 'Remove' },
];

const DEFAULT_CONFIG = {
  selectedProtectedColumns: [],
  logTransform: {
    enabled: true,
    base: 2,
    offset: 1,
  },
  batchCorrection: {
    enabled: true,
    batchColumn: '',
    covariates: [],
    parametric: true,
  },
  normalization: {
    enabled: true,
    method: 'zscore',
    zscore: { center: true, scale: true },
    minmax: { rangeMin: 0, rangeMax: 1 },
    quantile: { tieBreaking: 'mean' },
  },
  outlierDetection: {
    enabled: true,
    method: 'iqr',
    iqrCoefficient: 1.5,
    zscoreDeviation: 3,
    action: 'impute',
  },
};

const NormalizationConfigModal = ({ onClose, onNormalize, columns = [], illnessColumns = [] }) => {
  const [config, setConfig] = useState(DEFAULT_CONFIG);

  const selectableProtectedColumns = useMemo(() => {
    const illnessSet = new Set(
      (illnessColumns || [])
        .filter((col) => typeof col === 'string')
        .map((col) => col.trim())
        .filter(Boolean)
    );

    return (columns || []).filter((col) => {
      if (typeof col !== 'string') return false;
      const normalized = col.trim();
      return Boolean(normalized) && !illnessSet.has(normalized);
    });
  }, [columns, illnessColumns]);

  const availableCovariateColumns = useMemo(() => {
    const selectedBatchColumn = config.batchCorrection.batchColumn;
    return (columns || []).filter((col) => col && col !== selectedBatchColumn);
  }, [columns, config.batchCorrection.batchColumn]);

  useEffect(() => {
    document.body.classList.add('norm-modal-open');
    return () => {
      document.body.classList.remove('norm-modal-open');
    };
  }, []);

  const update = (section, field, value) => {
    setConfig((prev) => ({
      ...prev,
      [section]: { ...prev[section], [field]: value },
    }));
  };

  const updateNested = (section, sub, field, value) => {
    setConfig((prev) => ({
      ...prev,
      [section]: {
        ...prev[section],
        [sub]: { ...prev[section][sub], [field]: value },
      },
    }));
  };

  const toggleCovariate = (columnName) => {
    setConfig((prev) => {
      const current = Array.isArray(prev.batchCorrection.covariates)
        ? prev.batchCorrection.covariates
        : [];
      const next = current.includes(columnName)
        ? current.filter((item) => item !== columnName)
        : [...current, columnName];

      return {
        ...prev,
        batchCorrection: {
          ...prev.batchCorrection,
          covariates: next,
        },
      };
    });
  };

  const toggleProtectedColumn = (columnName) => {
    setConfig((prev) => {
      const current = Array.isArray(prev.selectedProtectedColumns)
        ? prev.selectedProtectedColumns
        : [];
      const next = current.includes(columnName)
        ? current.filter((item) => item !== columnName)
        : [...current, columnName];

      return {
        ...prev,
        selectedProtectedColumns: next,
      };
    });
  };

  const selectAllProtectedColumns = () => {
    setConfig((prev) => ({
      ...prev,
      selectedProtectedColumns: [...selectableProtectedColumns],
    }));
  };

  const clearAllProtectedColumns = () => {
    setConfig((prev) => ({
      ...prev,
      selectedProtectedColumns: [],
    }));
  };

  const selectAllCovariates = () => {
    setConfig((prev) => ({
      ...prev,
      batchCorrection: {
        ...prev.batchCorrection,
        covariates: [...availableCovariateColumns],
      },
    }));
  };

  const clearAllCovariates = () => {
    setConfig((prev) => ({
      ...prev,
      batchCorrection: {
        ...prev.batchCorrection,
        covariates: [],
      },
    }));
  };

  // Normalize button disabled when batch correction is enabled but no batch column selected
  const normalizeDisabled = useMemo(() => {
    if (config.batchCorrection.enabled && !config.batchCorrection.batchColumn) {
      return true;
    }
    return false;
  }, [config.batchCorrection.enabled, config.batchCorrection.batchColumn]);

  const handleNormalize = () => {
    if (normalizeDisabled) return;
    onNormalize(config);
  };

  return (
    <div className="norm-modal-overlay" onClick={onClose}>
      <div className="norm-modal" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="norm-modal-header">
          <h3>Normalization Pipeline Configuration</h3>
          <button className="norm-modal-close" onClick={onClose} aria-label="Close">&times;</button>
        </div>

        <div className="norm-modal-body">

          {/*  0. Protected Columns  */}
          <div className="norm-pipeline-step">
            <div className="norm-step-header">
              <span className="norm-step-title">0. Protect Columns from All Normalization Steps</span>
              <HelpTooltip useFixedPosition placement="right" text="Select columns to protect from all normalization steps (log transform, batch correction, normalization, outlier detection). Illness columns are already protected automatically and are excluded from this list.">info</HelpTooltip>
            </div>
            <div className="norm-step-params">
              <div className="norm-param-row">
                <label>
                  Protected Columns
                  <HelpTooltip useFixedPosition text="Selected columns are treated as non-feature columns and remain unchanged by the normalization pipeline.">info</HelpTooltip>
                </label>
                <div className="norm-covariate-panel">
                  <div className="norm-covariate-actions">
                    <button type="button" onClick={selectAllProtectedColumns}>Select all</button>
                    <button type="button" onClick={clearAllProtectedColumns}>Clear</button>
                  </div>

                  {selectableProtectedColumns.length > 0 ? (
                    <div className="norm-covariate-list">
                      {selectableProtectedColumns.map((columnName) => {
                        const checked = Array.isArray(config.selectedProtectedColumns)
                          ? config.selectedProtectedColumns.includes(columnName)
                          : false;
                        return (
                          <label key={columnName} className="norm-covariate-item">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => toggleProtectedColumn(columnName)}
                            />
                            <span>{columnName}</span>
                          </label>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="norm-covariate-empty">No columns available for manual protection.</div>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/*  1. Log Transformation  */}
          <div className={`norm-pipeline-step ${!config.logTransform.enabled ? 'is-disabled' : ''}`}>
            <div className="norm-step-header">
              <label className="norm-checkbox-label">
                <input
                  type="checkbox"
                  checked={config.logTransform.enabled}
                  onChange={(e) => update('logTransform', 'enabled', e.target.checked)}
                />
                <span className="norm-step-title">1. Log Transformation</span>
              </label>
              <HelpTooltip useFixedPosition placement="right" text="Applies a logarithmic transformation to reduce skewness in expression data. Useful when values span several orders of magnitude.">info</HelpTooltip>
            </div>
            {config.logTransform.enabled && (
              <div className="norm-step-params">
                <div className="norm-param-row">
                  <label>
                    Base
                    <HelpTooltip useFixedPosition text="The base of the logarithm. Common choices are 2 (log2) and 10 (log10). Log2 is standard for omics data.">info</HelpTooltip>
                  </label>
                  <input
                    type="number"
                    min={2}
                    value={config.logTransform.base}
                    onChange={(e) => update('logTransform', 'base', Number(e.target.value))}
                  />
                </div>
                <div className="norm-param-row">
                  <label>
                    Offset
                    <HelpTooltip useFixedPosition text="A small constant added before taking the log to avoid log(0). Default is 1, so log(0+1) = 0.">info</HelpTooltip>
                  </label>
                  <input
                    type="number"
                    min={0}
                    step={0.1}
                    value={config.logTransform.offset}
                    onChange={(e) => update('logTransform', 'offset', Number(e.target.value))}
                  />
                </div>
              </div>
            )}
          </div>

          {/*  2. Batch Effect Correction  */}
          <div className={`norm-pipeline-step ${!config.batchCorrection.enabled ? 'is-disabled' : ''}`}>
            <div className="norm-step-header">
              <label className="norm-checkbox-label">
                <input
                  type="checkbox"
                  checked={config.batchCorrection.enabled}
                  onChange={(e) => update('batchCorrection', 'enabled', e.target.checked)}
                />
                <span className="norm-step-title">2. Batch Effect Correction (ComBat)</span>
              </label>
              <HelpTooltip useFixedPosition placement="right" text="Removes technical variation introduced by processing samples in different batches while preserving biological signal. Uses the ComBat algorithm.">info</HelpTooltip>
            </div>
            {config.batchCorrection.enabled && (
              <div className="norm-step-params">
                <div className="norm-param-row">
                  <label>
                    Batch Column <span className="norm-required">*</span>
                    <HelpTooltip useFixedPosition text="Select the column that identifies which batch each sample belongs to. This is required when batch correction is enabled.">info</HelpTooltip>
                  </label>
                  <select
                    value={config.batchCorrection.batchColumn}
                    onChange={(e) => update('batchCorrection', 'batchColumn', e.target.value)}
                    className={!config.batchCorrection.batchColumn ? 'norm-select-placeholder' : ''}
                  >
                    <option value="" disabled>Select batch column...</option>
                    {columns.map((col) => (
                      <option key={col} value={col}>{col}</option>
                    ))}
                  </select>
                  {!config.batchCorrection.batchColumn && (
                    <span className="norm-validation-hint">Required</span>
                  )}
                </div>
                <div className="norm-param-row">
                  <label>
                    Model Covariates
                    <HelpTooltip useFixedPosition text="These are not just protected from Batch Correction; they are variables the batch model uses to preserve biological signal while removing batch effects. Example: age/gender/diagnosis/APOE4 may be included.">info</HelpTooltip>
                  </label>
                  <div className="norm-covariate-panel">
                    <div className="norm-covariate-actions">
                      <button type="button" onClick={selectAllCovariates}>Select all</button>
                      <button type="button" onClick={clearAllCovariates}>Clear</button>
                    </div>

                    {availableCovariateColumns.length > 0 ? (
                      <div className="norm-covariate-list">
                        {availableCovariateColumns.map((columnName) => {
                          const checked = Array.isArray(config.batchCorrection.covariates)
                            ? config.batchCorrection.covariates.includes(columnName)
                            : false;
                          return (
                            <label key={columnName} className="norm-covariate-item">
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() => toggleCovariate(columnName)}
                              />
                              <span>{columnName}</span>
                            </label>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="norm-covariate-empty">No columns available for covariates.</div>
                    )}
                  </div>
                </div>
                <div className="norm-param-row">
                  <label>
                    Adjustment Mode
                    <HelpTooltip useFixedPosition text="Parametric assumes batch effects follow a normal distribution (faster). Non-parametric makes no distributional assumption (more robust for skewed data).">info</HelpTooltip>
                  </label>
                  <select
                    value={config.batchCorrection.parametric ? 'parametric' : 'nonparametric'}
                    onChange={(e) => update('batchCorrection', 'parametric', e.target.value === 'parametric')}
                  >
                    <option value="parametric">Parametric</option>
                    <option value="nonparametric">Non-Parametric</option>
                  </select>
                </div>
              </div>
            )}
          </div>

          {/*  3. Normalization  */}
          <div className={`norm-pipeline-step ${!config.normalization.enabled ? 'is-disabled' : ''}`}>
            <div className="norm-step-header">
              <label className="norm-checkbox-label">
                <input
                  type="checkbox"
                  checked={config.normalization.enabled}
                  onChange={(e) => update('normalization', 'enabled', e.target.checked)}
                />
                <span className="norm-step-title">3. Normalization</span>
              </label>
              <HelpTooltip useFixedPosition placement="right" text="Scales feature values so they are comparable across samples, which is critical for distance-based and gradient-based algorithms.">info</HelpTooltip>
            </div>
            {config.normalization.enabled && (
              <div className="norm-step-params">
                <div className="norm-param-row">
                  <label>
                    Method
                    <HelpTooltip useFixedPosition text="Z-Score: centers to mean 0, std 1. Min-Max: rescales to a fixed range. Quantile Normalization: forces identical distributions across samples.">info</HelpTooltip>
                  </label>
                  <select
                    value={config.normalization.method}
                    onChange={(e) => update('normalization', 'method', e.target.value)}
                  >
                    {NORMALIZATION_METHODS.map((m) => (
                      <option key={m.value} value={m.value}>{m.label}</option>
                    ))}
                  </select>
                </div>

                {/* Z-Score sub-params */}
                {config.normalization.method === 'zscore' && (
                  <>
                    <div className="norm-param-row">
                      <label>
                        Center
                        <HelpTooltip useFixedPosition text="Subtract the mean from each feature so the result has mean less than 0.">info</HelpTooltip>
                      </label>
                      <select
                        value={config.normalization.zscore.center ? 'true' : 'false'}
                        onChange={(e) => updateNested('normalization', 'zscore', 'center', e.target.value === 'true')}
                      >
                        <option value="true">True</option>
                        <option value="false">False</option>
                      </select>
                    </div>
                    <div className="norm-param-row">
                      <label>
                        Scale
                        <HelpTooltip useFixedPosition text="Divide each feature by its standard deviation so the result has std less than 1.">info</HelpTooltip>
                      </label>
                      <select
                        value={config.normalization.zscore.scale ? 'true' : 'false'}
                        onChange={(e) => updateNested('normalization', 'zscore', 'scale', e.target.value === 'true')}
                      >
                        <option value="true">True</option>
                        <option value="false">False</option>
                      </select>
                    </div>
                  </>
                )}

                {/* Min-Max sub-params */}
                {config.normalization.method === 'minmax' && (
                  <div className="norm-param-row norm-param-row--inline">
                    <label>
                      Range
                      <HelpTooltip useFixedPosition text="The target [min, max] range to rescale features into. Default is [0, 1].">info</HelpTooltip>
                    </label>
                    <div className="norm-range-inputs">
                      <input
                        type="number"
                        step={0.1}
                        value={config.normalization.minmax.rangeMin}
                        onChange={(e) => updateNested('normalization', 'minmax', 'rangeMin', Number(e.target.value))}
                        style={{ width: 70 }}
                      />
                      <span>to</span>
                      <input
                        type="number"
                        step={0.1}
                        value={config.normalization.minmax.rangeMax}
                        onChange={(e) => updateNested('normalization', 'minmax', 'rangeMax', Number(e.target.value))}
                        style={{ width: 70 }}
                      />
                    </div>
                  </div>
                )}

                {/* Quantile sub-params */}
                {config.normalization.method === 'quantile' && (
                  <div className="norm-param-row">
                    <label>
                      Tie-Breaking Method
                      <HelpTooltip useFixedPosition text="When multiple values share the same rank, choose how to resolve ties. Mean averages tied ranks; Random breaks ties randomly.">info</HelpTooltip>
                    </label>
                    <select
                      value={config.normalization.quantile.tieBreaking}
                      onChange={(e) => updateNested('normalization', 'quantile', 'tieBreaking', e.target.value)}
                    >
                      <option value="mean">Mean</option>
                      <option value="random">Random</option>
                    </select>
                  </div>
                )}
              </div>
            )}
          </div>

          {/*  4. Outlier Detection  */}
          <div className={`norm-pipeline-step ${!config.outlierDetection.enabled ? 'is-disabled' : ''}`}>
            <div className="norm-step-header">
              <label className="norm-checkbox-label">
                <input
                  type="checkbox"
                  checked={config.outlierDetection.enabled}
                  onChange={(e) => update('outlierDetection', 'enabled', e.target.checked)}
                />
                <span className="norm-step-title">4. Outlier Detection</span>
              </label>
              <HelpTooltip useFixedPosition placement="right" text="Identifies extreme values that may distort downstream analysis. You can choose to replace them with imputed values or remove the samples entirely.">info</HelpTooltip>
            </div>
            {config.outlierDetection.enabled && (
              <div className="norm-step-params">
                <div className="norm-param-row">
                  <label>
                    Method
                    <HelpTooltip useFixedPosition text="IQR: uses inter-quartile range (robust to skew). Z-Score: flags points beyond k standard deviations. Isolation Forest: a tree-based anomaly detector.">info</HelpTooltip>
                  </label>
                  <select
                    value={config.outlierDetection.method}
                    onChange={(e) => update('outlierDetection', 'method', e.target.value)}
                  >
                    {OUTLIER_METHODS.map((m) => (
                      <option key={m.value} value={m.value}>{m.label}</option>
                    ))}
                  </select>
                </div>

                {/* IQR threshold */}
                {config.outlierDetection.method === 'iqr' && (
                  <div className="norm-param-row">
                    <label>
                      IQR Coefficient
                      <HelpTooltip useFixedPosition text="Points beyond Q1 - k&#215;IQR or Q3 + k&#215;IQR are flagged as outliers. Default k = 1.5 (standard). Use 3.0 for extreme outliers only.">info</HelpTooltip>
                    </label>
                    <input
                      type="number"
                      min={0}
                      step={0.1}
                      value={config.outlierDetection.iqrCoefficient}
                      onChange={(e) => update('outlierDetection', 'iqrCoefficient', Number(e.target.value))}
                    />
                  </div>
                )}
                {/* Z-Score threshold */}
                {config.outlierDetection.method === 'zscore' && (
                  <div className="norm-param-row">
                    <label>
                      Z-Score Deviation
                      <HelpTooltip useFixedPosition text="Points with |z| greater than this threshold are flagged as outliers. Default is 3 standard deviations.">info</HelpTooltip>
                    </label>
                    <input
                      type="number"
                      min={0}
                      step={0.1}
                      value={config.outlierDetection.zscoreDeviation}
                      onChange={(e) => update('outlierDetection', 'zscoreDeviation', Number(e.target.value))}
                    />
                  </div>
                )}

                <div className="norm-param-row">
                  <label>
                    Action
                    <HelpTooltip useFixedPosition text="Impute replaces outliers with the column mean, preserving sample count. Remove drops the entire sample row.">info</HelpTooltip>
                  </label>
                  <select
                    value={config.outlierDetection.action}
                    onChange={(e) => update('outlierDetection', 'action', e.target.value)}
                  >
                    {OUTLIER_ACTIONS.map((a) => (
                      <option key={a.value} value={a.value}>{a.label}</option>
                    ))}
                  </select>
                </div>
              </div>
            )}
          </div>

        </div>

        {/* Footer */}
        <div className="norm-modal-footer">
          {normalizeDisabled && (
            <span className="norm-footer-hint">Select a Batch Column to enable normalization</span>
          )}
          <div className="norm-footer-buttons">
            <button className="norm-btn-cancel" onClick={onClose}>Cancel</button>
            <button
              className="norm-btn-normalize"
              onClick={handleNormalize}
              disabled={normalizeDisabled}
            >
              Normalize
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default NormalizationConfigModal;
