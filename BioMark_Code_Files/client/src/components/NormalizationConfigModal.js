import React, { useState, useMemo, useEffect } from 'react';
import HelpTooltip from './common/HelpTooltip';
import '../css/NormalizationConfigModal.css';

const PIPELINE_OPTIONS = [
  { value: 'standard', label: 'Standard Pipeline' },
  { value: 'mogonet', label: 'MOGONET-Style Pipeline' },
];

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
  pipelineType: 'standard',
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
  mogonet: {
    applyLogTransform: false,
    fdrAlpha: 0.05,
    varThreshMrna: 0.1,
    varThreshMeth: 0.001,
    pc1Max: 0.5,
    minKeep: 200,
    maxKeep: 300,
    hm27Restriction: false,
    hm27ArtifactPath: '../artifacts/hm27_probe_ids.json',
    verbose: true,
  },
};

const NormalizationConfigModal = ({ onClose, onNormalize, columns = [], illnessColumns = [], sampleColumns = [] }) => {
  const [config, setConfig] = useState(DEFAULT_CONFIG);

  const alwaysProtectedColumns = useMemo(() => {
    const fixed = [];
    (illnessColumns || []).forEach((col) => {
      if (typeof col === 'string' && col.trim()) {
        fixed.push(col.trim());
      }
    });
    (sampleColumns || []).forEach((col) => {
      if (typeof col === 'string' && col.trim()) {
        fixed.push(col.trim());
      }
    });

    if ((sampleColumns || []).length === 0 && (columns || []).includes('Sample ID')) {
      fixed.push('Sample ID');
    }

    return Array.from(new Set(fixed));
  }, [illnessColumns, sampleColumns, columns]);

  const forcedProtectedColumns = useMemo(() => (
    Array.from(new Set([
      ...(config.selectedProtectedColumns || []),
      ...alwaysProtectedColumns,
    ]))
  ), [config.selectedProtectedColumns, alwaysProtectedColumns]);

  const selectableProtectedColumns = useMemo(() => {
    return (columns || []).filter((col) => {
      if (typeof col !== 'string') return false;
      const normalized = col.trim();
      return Boolean(normalized);
    });
  }, [columns]);

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

  useEffect(() => {
    setConfig((prev) => {
      const batchColumn = prev.batchCorrection.batchColumn;
      const forced = forcedProtectedColumns.filter((c) => c && c !== batchColumn);
      const existing = (prev.batchCorrection.covariates || []).filter((c) => c && c !== batchColumn);
      const merged = Array.from(new Set([...forced, ...existing]))
        .filter((c) => (columns || []).includes(c));

      if (
        merged.length === (prev.batchCorrection.covariates || []).length &&
        merged.every((c, i) => c === (prev.batchCorrection.covariates || [])[i])
      ) {
        return prev;
      }

      return {
        ...prev,
        batchCorrection: {
          ...prev.batchCorrection,
          covariates: merged,
        },
      };
    });
  }, [forcedProtectedColumns, config.batchCorrection.batchColumn, columns]);

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
      if (forcedProtectedColumns.includes(columnName)) return prev; // cannot uncheck forced

      const current = prev.batchCorrection.covariates || [];
      const next = current.includes(columnName)
        ? current.filter((c) => c !== columnName)
        : [...current, columnName];

      return {
        ...prev,
        batchCorrection: { ...prev.batchCorrection, covariates: next },
      };
    });
  };

  const toggleProtectedColumn = (columnName) => {
    setConfig((prev) => {
      const protectedCols = prev.selectedProtectedColumns || [];
      const covariates = prev.batchCorrection.covariates || [];
      const isProtected = protectedCols.includes(columnName);

      const nextProtected = isProtected
        ? protectedCols.filter((c) => c !== columnName)
        : [...protectedCols, columnName];

      const nextCovariates = isProtected
        ? covariates.filter((c) => c !== columnName)
        : covariates.includes(columnName)
          ? covariates
          : [...covariates, columnName];

      return {
        ...prev,
        selectedProtectedColumns: nextProtected,
        batchCorrection: { ...prev.batchCorrection, covariates: nextCovariates },
      };
    });
  };

  const selectAllProtectedColumns = () => {
    setConfig((prev) => {
      const covariatesCurrent = Array.isArray(prev.batchCorrection.covariates)
        ? prev.batchCorrection.covariates
        : [];
      const forced = [...selectableProtectedColumns];
      const nextCovariates = Array.from(new Set([...covariatesCurrent, ...forced]));

      return {
        ...prev,
        selectedProtectedColumns: forced,
        batchCorrection: {
          ...prev.batchCorrection,
          covariates: nextCovariates,
        },
      };
    });
  };

  const clearAllProtectedColumns = () => {
    setConfig((prev) => {
      const protectedCurrent = Array.isArray(prev.selectedProtectedColumns)
        ? prev.selectedProtectedColumns
        : [];
      const covariatesCurrent = Array.isArray(prev.batchCorrection.covariates)
        ? prev.batchCorrection.covariates
        : [];

      // remove previously forced columns from covariates
      const nextCovariates = covariatesCurrent.filter(
        (col) => !protectedCurrent.includes(col)
      );

      return {
        ...prev,
        selectedProtectedColumns: [],
        batchCorrection: {
          ...prev.batchCorrection,
          covariates: nextCovariates,
        },
      };
    });
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
    setConfig((prev) => {
      const batchColumn = prev.batchCorrection.batchColumn;
      const forced = forcedProtectedColumns.filter((c) => c && c !== batchColumn);
      return {
        ...prev,
        batchCorrection: {
          ...prev.batchCorrection,
          covariates: forced, // keep forced ones
        },
      };
    });
  };

  const isStandardPipeline = config.pipelineType === 'standard';

  // Normalize button disabled when required options are missing
  const normalizeDisabled = useMemo(() => {
    if (isStandardPipeline && config.batchCorrection.enabled && !config.batchCorrection.batchColumn) {
      return true;
    }
    return false;
  }, [isStandardPipeline, config.batchCorrection.enabled, config.batchCorrection.batchColumn]);

  const handleNormalize = () => {
    const batchColumn = config.batchCorrection.batchColumn;
    const protectedCols = forcedProtectedColumns.filter(Boolean);
    const forced = protectedCols.filter((c) => c !== batchColumn);
    const requested = (config.batchCorrection.covariates || []).filter((c) => c && c !== batchColumn);
    const mergedCovariates = Array.from(new Set([...forced, ...requested]));

    let payload;
    if (config.pipelineType === 'mogonet') {
      payload = {
        pipelineType: 'mogonet',
        selectedProtectedColumns: Array.from(new Set(protectedCols)),
        mogonet: {
          ...config.mogonet,
        },
      };
    } else {
      payload = {
        ...config,
        pipelineType: 'standard',
        selectedProtectedColumns: Array.from(new Set(protectedCols)),
        batchCorrection: {
          ...config.batchCorrection,
          covariates: mergedCovariates,
        },
      };
    }

    onNormalize(payload);
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

          {/* Pipeline Selection */}
          <div className="norm-pipeline-step">
            <div className="norm-step-header">
              <label className="norm-checkbox-label">
                <span className="norm-step-title">Pipeline Selection</span>
              </label>
              <HelpTooltip useFixedPosition placement="right" text="Choose one preprocessing pipeline. Selecting MOGONET-Style disables the Standard pipeline checks.">info</HelpTooltip>
            </div>
            <div className="norm-step-params">
              <div className="norm-pipeline-options">
                {PIPELINE_OPTIONS.map((option) => (
                  <label key={option.value} className="norm-pipeline-option">
                    <input
                      type="radio"
                      name="pipelineType"
                      checked={config.pipelineType === option.value}
                      onChange={() => setConfig((prev) => ({ ...prev, pipelineType: option.value }))}
                    />
                    <span>{option.label}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>

          {/*  0. Protected Columns  */}
          <div className="norm-pipeline-step">
            <div className="norm-step-header">
              <label className="norm-checkbox-label">
                <span className="norm-step-title">0. Protected Columns</span>
              </label>
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

                        const isSelectedIllness = (illnessColumns || []).includes(columnName);
                        const isSelectedSample = (sampleColumns || []).includes(columnName)
                          || ((sampleColumns || []).length === 0 && columnName === 'Sample ID');
                        return (
                          <label key={columnName} className="norm-covariate-item">
                            <input
                              type="checkbox"
                              checked={checked || isSelectedIllness || isSelectedSample}
                              disabled={isSelectedIllness || isSelectedSample}
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

          {/* Standard Pipeline */}
          {isStandardPipeline && (
            <>

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
                    <HelpTooltip useFixedPosition text="These are not just protected from Batch Correction; they are variables the batch model uses to preserve biological signal while removing batch effects. Columns from Step 0 are need to be selected. Example: age/gender/diagnosis/APOE4 may be included.">info</HelpTooltip>
                  </label>
                  <div className="norm-covariate-panel">
                    <div className="norm-covariate-actions">
                      <button type="button" onClick={selectAllCovariates}>Select all</button>
                      <button type="button" onClick={clearAllCovariates}>Clear</button>
                    </div>

                    {availableCovariateColumns.length > 0 ? (
                      <div className="norm-covariate-list">
                        {availableCovariateColumns.map((columnName) => {
                          const isProtected = forcedProtectedColumns.includes(columnName);
                          const isChecked = isProtected || (config.batchCorrection.covariates || []).includes(columnName);

                          return (
                            <label key={columnName} className="norm-covariate-item">
                              <input
                                type="checkbox"
                                checked={isChecked}
                                disabled={isProtected}
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

            </>
          )}

          {/* MOGONET-Style Pipeline */}
          {!isStandardPipeline && (
            <div className="norm-pipeline-step">
              <div className="norm-step-header">
                <label className="norm-checkbox-label">
                  <span className="norm-step-title">MOGONET-Style Feature Preprocessing</span>
                </label>
                <HelpTooltip useFixedPosition placement="right" text="Runs supervised feature preprocessing inspired by MOGONET: variance filtering, ANOVA+FDR ranking, PC1-constrained feature count selection, and min-max scaling.">info</HelpTooltip>
              </div>
              <div className="norm-step-params">
                <div className="norm-param-row">
                  <label>
                    Apply Log Transform
                    <HelpTooltip useFixedPosition text="Apply a log10 transform with training-derived pseudocount before feature selection.">info</HelpTooltip>
                  </label>
                  <div className="norm-param-row-control norm-param-row-control--checkbox">
                    <input
                      type="checkbox"
                      checked={Boolean(config.mogonet.applyLogTransform)}
                      onChange={(e) => update('mogonet', 'applyLogTransform', e.target.checked)}
                    />
                  </div>
                </div>

                <div className="norm-param-row">
                  <label>
                    FDR Alpha
                    <HelpTooltip useFixedPosition text="Benjamini-Hochberg FDR threshold used during ANOVA preselection.">info</HelpTooltip>
                  </label>
                  <input
                    type="number"
                    min={0}
                    max={1}
                    step={0.001}
                    value={config.mogonet.fdrAlpha}
                    onChange={(e) => update('mogonet', 'fdrAlpha', Number(e.target.value))}
                  />
                </div>

                <div className="norm-param-row">
                  <label>
                    PC1 Max Ratio
                    <HelpTooltip useFixedPosition text="Increase selected features until PC1 explained variance is below this threshold.">info</HelpTooltip>
                  </label>
                  <input
                    type="number"
                    min={0.01}
                    max={0.99}
                    step={0.01}
                    value={config.mogonet.pc1Max}
                    onChange={(e) => update('mogonet', 'pc1Max', Number(e.target.value))}
                  />
                </div>

                <div className="norm-param-row norm-param-row--inline">
                  <label>
                    Keep Range
                    <HelpTooltip useFixedPosition text="Minimum and maximum number of features to keep after ranking.">info</HelpTooltip>
                  </label>
                  <div className="norm-range-inputs">
                    <input
                      type="number"
                      min={1}
                      step={1}
                      value={config.mogonet.minKeep}
                      onChange={(e) => update('mogonet', 'minKeep', Number(e.target.value))}
                    />
                    <span>to</span>
                    <input
                      type="number"
                      min={1}
                      step={1}
                      value={config.mogonet.maxKeep}
                      onChange={(e) => update('mogonet', 'maxKeep', Number(e.target.value))}
                    />
                  </div>
                </div>

                <div className="norm-param-row norm-param-row--inline">
                  <label>
                    Variance Thresholds
                    <HelpTooltip useFixedPosition text="Type-specific variance thresholds: mRNA and methylation.">info</HelpTooltip>
                  </label>
                  <div className="norm-range-inputs">
                    <input
                      type="number"
                      min={0}
                      step={0.001}
                      value={config.mogonet.varThreshMrna}
                      onChange={(e) => update('mogonet', 'varThreshMrna', Number(e.target.value))}
                    />
                    <span>mRNA</span>
                    <input
                      type="number"
                      min={0}
                      step={0.0001}
                      value={config.mogonet.varThreshMeth}
                      onChange={(e) => update('mogonet', 'varThreshMeth', Number(e.target.value))}
                    />
                    <span>meth</span>
                  </div>
                </div>

                <div className="norm-param-row">
                  <label>
                    HM27 Restriction
                    <HelpTooltip useFixedPosition text="For methylation datasets, restrict probes to HM27 list from the artifact path.">info</HelpTooltip>
                  </label>
                  <select
                    value={config.mogonet.hm27Restriction ? 'true' : 'false'}
                    onChange={(e) => update('mogonet', 'hm27Restriction', e.target.value === 'true')}
                  >
                    <option value="false">False</option>
                    <option value="true">True</option>
                  </select>
                </div>

                {config.mogonet.hm27Restriction && (
                  <div className="norm-param-row">
                    <label>
                      HM27 Artifact Path
                      <HelpTooltip useFixedPosition text="JSON file path containing HM27 probe ids array.">info</HelpTooltip>
                    </label>
                    <input
                      type="text"
                      value={config.mogonet.hm27ArtifactPath}
                      onChange={(e) => update('mogonet', 'hm27ArtifactPath', e.target.value)}
                    />
                  </div>
                )}

                <div className="norm-param-row">
                  <label>
                    Verbose Logs
                    <HelpTooltip useFixedPosition text="Include detailed step statistics in the normalization log output.">info</HelpTooltip>
                  </label>
                  <select
                    value={config.mogonet.verbose ? 'true' : 'false'}
                    onChange={(e) => update('mogonet', 'verbose', e.target.value === 'true')}
                  >
                    <option value="true">True</option>
                    <option value="false">False</option>
                  </select>
                </div>
              </div>
            </div>
          )}

        </div>

        {/* Footer */}
        <div className="norm-modal-footer">
          {normalizeDisabled && (
            <span className="norm-footer-hint">
              {isStandardPipeline
                ? 'Select a Batch Column to enable normalization'
                : 'Review MOGONET options before preprocessing'}
            </span>
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
