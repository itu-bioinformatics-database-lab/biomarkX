import React, { useState, useRef, useEffect } from 'react';
import HelpTooltip from './common/HelpTooltip';
import SearchableColumnList from './SearchableColumnList';
import { helpTexts } from '../content/helpTexts';
import Science from '@mui/icons-material/Science';
import Hub from '@mui/icons-material/Hub';
import AccountTree from '@mui/icons-material/AccountTree';
import Insights from '@mui/icons-material/Insights';
import FavoriteBorder from '@mui/icons-material/FavoriteBorder';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';


function AnalysisSelection({ onAnalysisSelection, onSelectionChange, afterFeatureSelection, onToggleAfterFS, canUseAfterFS, selectedTopFeaturesCount = 20, onSelectedTopFeaturesChange, numSelectedClasses, availableColumns = [], selectedIllnessColumn = '', selectedSampleColumn = '' }) {
  const [selectedAnalyses, setSelectedAnalyses] = useState({
    statisticalTest: [],
    dimensionalityReduction: [],
    survivalAnalysis: [],
    classificationAnalysis: [],
    modelExplanation: [],
  });
  // State for button and parameter dropdown
  const [buttonPressed, setButtonPressed] = useState(false);
  const [showParamsDropdown, setShowParamsDropdown] = useState(false);
  const [useDefaultParams, setUseDefaultParams] = useState(true);
  const [paramsChanged, setParamsChanged] = useState(false);
  const [confirmSelection, setConfirmSelection] = useState(false);
  
  // Ref for parameter settings section (for scrolling)
  const parameterSettingsRef = useRef(null);
  
  // Parameter states
  // Differential Analysis Parameters
  const [featureType, setFeatureType] = useState("microRNA");
  const [referenceClass, setReferenceClass] = useState("");
  const [limeGlobalExplanationSampleNum, setLimeGlobalExplanationSampleNum] = useState(50);
  const [shapModelFinetune, setShapModelFinetune] = useState(false);
  const [limeModelFinetune, setLimeModelFinetune] = useState(false);
  const [scoring, setScoring] = useState("f1");
  const [featureImportanceFinetune, setFeatureImportanceFinetune] = useState(false);
  const [numTopFeatures, setNumTopFeatures] = useState(20);
  const [volcanoPValueThreshold, setVolcanoPValueThreshold] = useState(0.05);
  const [volcanoLog2FcThreshold, setVolcanoLog2FcThreshold] = useState(1.0);
  
  // Clustering Analysis Parameters
  const [plotter, setPlotter] = useState("seaborn");
  const [dim, setDim] = useState("3D");
  
  // Classification Analysis Parameters
  const [paramFinetune, setParamFinetune] = useState(false);
  const [finetuneFraction, setFinetuneFraction] = useState(1.0);
  const [saveBestModel, setSaveBestModel] = useState(true);
  const [standardScaling, setStandardScaling] = useState(true);
  const [saveDataTransformer, setSaveDataTransformer] = useState(true);
  const [saveLabelEncoder, setSaveLabelEncoder] = useState(true);
  const [verbose, setVerbose] = useState(true);
  const [usePreprocessing, setUsePreprocessing] = useState(false);
  const [survivalTimeColumn, setSurvivalTimeColumn] = useState("");
  const [eventStatusColumn, setEventStatusColumn] = useState("");
  const [kmConfidenceLevel, setKmConfidenceLevel] = useState(0.95);
  const [coxPenalizer, setCoxPenalizer] = useState(0.0);
  const [coxTieMethod, setCoxTieMethod] = useState("efron");
  const [survivalValidationError, setSurvivalValidationError] = useState("");
  
  // Common parameters
  const [testSize, setTestSize] = useState(0.2);
  const [nFolds, setNFolds] = useState(5);

  const baseTopFeatureOptions = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
  const maxNumTopFeatures = afterFeatureSelection ? selectedTopFeaturesCount : 100;
  const allowedNumTopFeatureOptions = baseTopFeatureOptions.filter((num) => num <= maxNumTopFeatures);

  useEffect(() => {
    if (afterFeatureSelection && numTopFeatures > selectedTopFeaturesCount) {
      setNumTopFeatures(selectedTopFeaturesCount);
      setParamsChanged(true);
      setUseDefaultParams(false);
    }
  }, [afterFeatureSelection, selectedTopFeaturesCount, numTopFeatures]);

  const survivalColumnOptions = availableColumns.filter((column) => (
    column !== selectedIllnessColumn && column !== selectedSampleColumn
  ));
  
  // Scroll to parameter settings when shown
  useEffect(() => {
    // When parameter settings become visible, scroll to them
    if (showParamsDropdown && confirmSelection && parameterSettingsRef.current) {
      setTimeout(() => {
        // Offset for header/banner height
        const headerHeight = document.querySelector('.app-header')?.offsetHeight || 0;
        const yOffset = -headerHeight - 20;
        const element = parameterSettingsRef.current;
        const elementPosition = element.getBoundingClientRect().top + window.pageYOffset;
        window.scrollTo({
          top: elementPosition + yOffset,
          behavior: 'smooth'
        });
      }, 300);
    }
  }, [showParamsDropdown, confirmSelection]);
  
  const analysisOptions = {
    statisticalTest: ['T-test', 'Anova', 'Wilcoxon-rank-sum', 'Kruskal-Wallis', 'Volcano'],
    dimensionalityReduction: ['PCA', 'tSNE', 'UMAP'],
    survivalAnalysis: ['Kaplan-Meier', 'Cox Regression'],
    classificationAnalysis: ['Logistic Regression', 'Random Forest', 'XGBClassifier', 'Decision Tree', 'Gradient Boosting', 'CatBoosting Classifier', 'AdaBoost Classifier', 'MLPClassifier', 'SVC'],
    modelExplanation: ['SHAP', 'LIME', 'Permutation-Feature-Importance']
  };

  // Class count compatibility: methods that only work with exactly 2 classes
  const methodClassLimits = {
    'T-test': { min: 2, max: 2 },
    'Wilcoxon-rank-sum': { min: 2, max: 2 },
    'Volcano': { min: 2, max: 2 },
    // All others default to { min: 2, max: Infinity }
  };

  // Check if a method is compatible with the current number of selected classes
  const isMethodCompatible = (method) => {
    const limits = methodClassLimits[method] || { min: 2, max: Infinity };
    return numSelectedClasses >= limits.min && numSelectedClasses <= limits.max;
  };

  // Get tooltip text for disabled methods
  const getDisabledTooltip = (method) => {
    const limits = methodClassLimits[method];
    if (!limits) return '';
    if (limits.max === 2) return 'This method requires exactly 2 classes for comparison.';
    return `This method requires at least ${limits.min} classes.`;
  };

  // Handle selection of analysis method
  const handleSelection = (method, category) => {
    // Block selection of incompatible methods
    if (!isMethodCompatible(method)) return;

    setSelectedAnalyses(prev => {
      const isDeselecting = prev[category].includes(method);

      // If it's an explanation method, handle it as single-choice
      if (category === 'modelExplanation') {
        const newExplanations = isDeselecting ? [] : [method];
        return { ...prev, modelExplanation: newExplanations };
      }

      // For primary categories (statistical, dimensionality, classification)
      const emptyState = {
        statisticalTest: [],
        dimensionalityReduction: [],
        survivalAnalysis: [],
        classificationAnalysis: [],
        modelExplanation: [],
      };

      if (isDeselecting) {
        // If deselecting the active primary analysis, clear only that primary category.
        // Also clear model explanation if deselecting classification
        if (category === 'classificationAnalysis') {
          return { ...prev, [category]: [], modelExplanation: [] };
        }
        return { ...prev, [category]: [] };
      } else {
        // If selecting a new primary analysis:
        // 1. Clear primary categories.
        // 2. Set the new selection in its category.
        // 3. Only preserve modelExplanation when selecting classification.
        return {
          ...emptyState,
          modelExplanation: category === 'classificationAnalysis' ? prev.modelExplanation : [],
          [category]: [method]
        };
      }
    });

    // Reset confirmation status whenever the selection changes
    setConfirmSelection(false);
    setShowParamsDropdown(false);
    setButtonPressed(false);
    if (onSelectionChange) onSelectionChange();
  };
  
  // Handle confirm selection button click
  const handleConfirmSelection = () => {
    setButtonPressed(true);
    setShowParamsDropdown(true);
    setConfirmSelection(true);
    // Scroll to parameter settings after render
    setTimeout(() => {
      if (parameterSettingsRef.current) {
        const headerHeight = document.querySelector('.app-header')?.offsetHeight || 0;
        const yOffset = -headerHeight - 20;
        const element = parameterSettingsRef.current;
        const elementPosition = element.getBoundingClientRect().top + window.pageYOffset;
        window.scrollTo({
          top: elementPosition + yOffset,
          behavior: 'smooth'
        });
      }
    }, 300);
  }
  
  // Track parameter changes
  const handleParamChange = () => {
    setParamsChanged(true);
    setUseDefaultParams(false);
    if (survivalValidationError) {
      setSurvivalValidationError('');
    }
  };

  // Update parameter settings
  const handleUpdateParams = () => {
    setParamsChanged(false);
    completeSelection();
  };

  // Use default parameter settings
  const handleUseDefaultParams = () => {
    setUseDefaultParams(true);
    setParamsChanged(false);
    // Reset all parameters to default values
    setFeatureType("microRNA");
    setReferenceClass("");
    setLimeGlobalExplanationSampleNum(50);
    setShapModelFinetune(false);
    setLimeModelFinetune(false);
    setScoring("f1");
    setFeatureImportanceFinetune(false);
    setNumTopFeatures(20);
    setPlotter("seaborn");
    setDim("3D");
    setParamFinetune(false);
    setFinetuneFraction(1.0);
    setSaveBestModel(true);
    setStandardScaling(true);
    setSaveDataTransformer(true);
    setSaveLabelEncoder(true);
    setVerbose(true);
    setTestSize(0.2);
    setNFolds(5);
    setUsePreprocessing(false);
    setSurvivalTimeColumn("");
    setEventStatusColumn("");
    setKmConfidenceLevel(0.95);
    setCoxPenalizer(0.0);
    setCoxTieMethod("efron");
    setSurvivalValidationError("");
    completeSelection();
  };

  const isSurvivalSelected = selectedAnalyses.survivalAnalysis.length > 0;
  const hasBothSurvivalColumns = survivalTimeColumn && eventStatusColumn;
  const hasDistinctSurvivalColumns = survivalTimeColumn !== eventStatusColumn;
  const isSurvivalConfigValid = !isSurvivalSelected || (hasBothSurvivalColumns && hasDistinctSurvivalColumns);
  const survivalInlineValidationMessage = survivalValidationError || (
    isSurvivalSelected && !isSurvivalConfigValid
      ? (!hasBothSurvivalColumns
          ? 'Select both Survival Time and Event Status columns to continue.'
          : 'Survival Time and Event Status must be different columns.')
      : ''
  );

  const validateSurvivalConfig = () => {
    if (!isSurvivalSelected) {
      setSurvivalValidationError('');
      return true;
    }

    if (!survivalTimeColumn || !eventStatusColumn) {
      setSurvivalValidationError('Select both Survival Time and Event Status columns to continue.');
      return false;
    }

    if (survivalTimeColumn === eventStatusColumn) {
      setSurvivalValidationError('Survival Time and Event Status must be different columns.');
      return false;
    }

    setSurvivalValidationError('');
    return true;
  };
  
  // Send selection and parameters to parent component
  const completeSelection = () => {
    if (!validateSurvivalConfig()) {
      return;
    }

    const { statisticalTest, dimensionalityReduction, survivalAnalysis, classificationAnalysis, modelExplanation } = selectedAnalyses;
    
    const result = {
      statisticalTest,
      dimensionalityReduction,
      survivalAnalysis,
      classificationAnalysis,
      modelExplanation,
      useDefaultParams: useDefaultParams,
      parameters: {
        featureType,
        referenceClass,
        limeGlobalExplanationSampleNum,
        shapModelFinetune,
        limeModelFinetune,
        scoring,
        featureImportanceFinetune,
        numTopFeatures,
        volcanoPValueThreshold,
        volcanoLog2FcThreshold,
        plotter,
        dim,
        paramFinetune,
        finetuneFraction,
        saveBestModel,
        standardScaling,
        saveDataTransformer,
        saveLabelEncoder,
        verbose,
        testSize,
        nFolds,
        usePreprocessing,
        survivalTimeColumn,
        eventStatusColumn,
        kmConfidenceLevel,
        coxPenalizer,
        coxTieMethod
      }
    };
    onAnalysisSelection(result);
  };

  // Determine if at least one analysis method is selected
  const isAnyPrimaryAnalysisSelected = (
    selectedAnalyses.statisticalTest.length > 0 ||
    selectedAnalyses.dimensionalityReduction.length > 0 ||
    selectedAnalyses.survivalAnalysis.length > 0 ||
    selectedAnalyses.classificationAnalysis.length > 0
  );

  // Model Explanation is only available when Classification is selected
  const isClassificationSelected = selectedAnalyses.classificationAnalysis.length > 0;

  return (
    <div className="analysis-selection">
      {/* Centered feature stage row above confirm button and tables */}
      <div className="feature-stage-row" style={{ width: '100%', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 12, padding: '10px 0 8px 0', flexWrap: 'wrap' }}>
          <div style={{ fontWeight: 700 }}>Feature selection stage</div>
          <HelpTooltip text={"Select the number of features to use for analysis. Top-N features will be selected based on their importance scores of the last combined result or the last executed analysis. If there are less than N features available, all available features will be used."} />
          <div className="stage-switch" style={{ display: 'inline-flex', border: '1px solid #d7e2ff', borderRadius: 999, overflow: 'hidden' }}>
            <button
              type="button"
              onClick={() => { onToggleAfterFS && onToggleAfterFS(false); }}
              style={{ padding: '6px 12px', background: !afterFeatureSelection ? '#eef3fd' : '#fff', color: !afterFeatureSelection ? '#2f4fb5' : '#2b365a', border: 'none', fontWeight: 700, cursor: 'pointer', position: 'static', marginTop: 0 }}
            >
              All Features
            </button>
            {[10, 20, 30].map(n => (
              <button
                key={n}
                type="button"
                title={canUseAfterFS ? `Use ranked top-${n} features` : "Top-N selection is disabled until a prior run produces feature importances."}
                onClick={() => { if (canUseAfterFS && onToggleAfterFS) { onToggleAfterFS(true); onSelectedTopFeaturesChange && onSelectedTopFeaturesChange(n); } }}
                disabled={!canUseAfterFS}
                style={{ padding: '6px 12px', background: afterFeatureSelection && selectedTopFeaturesCount === n ? '#eef3fd' : '#fff', color: afterFeatureSelection && selectedTopFeaturesCount === n ? '#2f4fb5' : '#2b365a', border: 'none', fontWeight: 700, cursor: canUseAfterFS ? 'pointer' : 'not-allowed', opacity: canUseAfterFS ? 1 : 0.6, position: 'static', marginTop: 0 }}
                >
                Selected Top-{n}
              </button>
            ))}
          </div>
          <span style={{ marginLeft: 6, padding: '4px 10px', borderRadius: 999, background: '#f1f5ff', border: '1px solid #d7e2ff', color: '#2f4fb5', fontSize: 12, fontWeight: 700 }}>
            {afterFeatureSelection ? `Will run on: Selected Top-${selectedTopFeaturesCount} Features` : 'Will run on: All Features'}
          </span>
      </div>
      <div className="analysis-content-wrapper">
        {/* Removed duplicate floating info; main Step 5 title carries the info in App.js */}
        <div className='analysis-tables' style={{ display: 'grid', gridTemplateColumns: 'minmax(300px, 1fr) 60px minmax(300px, 1fr)', rowGap: '12px', columnGap: '20px', justifyContent: 'center', margin: '0 auto', width: 'fit-content' }}>
          {/* Top Left: Statistical Test */}
          <div className="analysis-category" style={{ gridColumn: 1, gridRow: 1, alignSelf: 'start' }}>
            <h4 style={{ display: 'flex', alignItems: 'center', gap: '8px' }}><Science /> Statistical Test
              <HelpTooltip text={helpTexts.steps.step5.categories.statisticalTest}>info</HelpTooltip>
            </h4>
            <table>
              <tbody>
                {analysisOptions.statisticalTest.map((method) => {
                  const compatible = isMethodCompatible(method);
                  return (
                  <tr
                    key={method}
                    className={`${selectedAnalyses.statisticalTest.includes(method) ? 'selected' : ''} ${!compatible ? 'disabled-method' : ''}`}
                    onClick={() => handleSelection(method, 'statisticalTest')}
                    title={!compatible ? getDisabledTooltip(method) : ''}
                  >
                    <td style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', opacity: compatible ? 1 : 0.45 }}>
                      <span>{method}{!compatible && <span style={{ fontSize: 11, color: '#999', marginLeft: 6 }}>(2 classes only)</span>}</span>
                      <span onClick={(e) => e.stopPropagation()}>
                        <HelpTooltip placement="right" text={helpTexts.steps.step5.methodInfo[method] || ''}>i</HelpTooltip>
                      </span>
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Top Right: Dimensionality Reduction and Visualizations */}
          <div className="analysis-category" style={{ gridColumn: 3, gridRow: 1, alignSelf: 'start' }}>
            <h4 style={{ display: 'flex', alignItems: 'center', gap: '8px' }}><Hub /> Dimensionality Reduction and Visualization
              <HelpTooltip text={helpTexts.steps.step5.categories.dimensionalityReduction}>info</HelpTooltip>
            </h4>
            <table>
              <tbody>
                {analysisOptions.dimensionalityReduction.map((method) => {
                  const compatible = isMethodCompatible(method);
                  return (
                  <tr
                    key={method}
                    className={`${selectedAnalyses.dimensionalityReduction.includes(method) ? 'selected' : ''} ${!compatible ? 'disabled-method' : ''}`}
                    onClick={() => handleSelection(method, 'dimensionalityReduction')}
                    title={!compatible ? getDisabledTooltip(method) : ''}
                  >
                    <td style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', opacity: compatible ? 1 : 0.45 }}>
                      <span>{method}</span>
                      <span onClick={(e) => e.stopPropagation()}>
                        <HelpTooltip placement="right" text={helpTexts.steps.step5.methodInfo[method] || ''}>i</HelpTooltip>
                      </span>
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Bottom Right - Top: Survival Analysis */}
          <div className="analysis-category" style={{ gridColumn: 3, gridRow: 2, alignSelf: 'start' }}>
            <h4 style={{ display: 'flex', alignItems: 'center', gap: '8px' }}><FavoriteBorder /> Survival Analysis
              <HelpTooltip text={helpTexts.steps.step5.categories.survival}>info</HelpTooltip>
            </h4>
            <table>
              <tbody>
                {analysisOptions.survivalAnalysis.map((method) => {
                  const compatible = isMethodCompatible(method);
                  return (
                  <tr
                    key={method}
                    className={`${selectedAnalyses.survivalAnalysis.includes(method) ? 'selected' : ''} ${!compatible ? 'disabled-method' : ''}`}
                    onClick={() => handleSelection(method, 'survivalAnalysis')}
                    title={!compatible ? getDisabledTooltip(method) : ''}
                  >
                    <td style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', opacity: compatible ? 1 : 0.45 }}>
                      <span>{method}</span>
                      <span onClick={(e) => e.stopPropagation()}>
                        <HelpTooltip placement="right" text={helpTexts.steps.step5.methodInfo[method] || ''}>i</HelpTooltip>
                      </span>
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Bottom Left: Classification Analysis */}
          <div className="analysis-category" style={{ gridColumn: 1, gridRow: '2 / 4', alignSelf: 'start' }}>
            <h4 style={{ display: 'flex', alignItems: 'center', gap: '8px' }}><AccountTree /> Classification Analysis
              <HelpTooltip text={helpTexts.steps.step5.categories.classification}>info</HelpTooltip>
            </h4>
            <table>
              <tbody>
                {analysisOptions.classificationAnalysis.map((method) => {
                  const compatible = isMethodCompatible(method);
                  return (
                  <tr
                    key={method}
                    className={`${selectedAnalyses.classificationAnalysis.includes(method) ? 'selected' : ''} ${!compatible ? 'disabled-method' : ''}`}
                    onClick={() => handleSelection(method, 'classificationAnalysis')}
                    title={!compatible ? getDisabledTooltip(method) : ''}
                  >
                    <td style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', opacity: compatible ? 1 : 0.45 }}>
                      <span>{method}</span>
                      <span onClick={(e) => e.stopPropagation()}>
                        <HelpTooltip placement="right" text={helpTexts.steps.step5.methodInfo[method] || ''}>i</HelpTooltip>
                      </span>
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Bottom Middle: Arrow Connector */}
          <div className={`connector${isClassificationSelected ? ' visible' : ''}`} style={{ gridColumn: 2, gridRow: 3, display: 'flex', alignItems: 'center', justifyContent: 'center', alignSelf: 'center' }}>
            <ArrowForwardIcon style={{ fontSize: 32 }} />
          </div>

          {/* Bottom Right - Bottom: Model Explanation */}
          <div className={`analysis-category model-explanation-category${isClassificationSelected ? ' visible' : ''}`}
               style={{ gridColumn: 3, gridRow: 3, alignSelf: 'center', opacity: isClassificationSelected ? 1 : 0.45, pointerEvents: isClassificationSelected ? 'auto' : 'none' }}>
            <h4 style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Insights /> Model Explanation
              <span className="optional-text">(Optional)</span>
              <HelpTooltip text={helpTexts.steps.step5.categories.explanation}>info</HelpTooltip>
            </h4>
            <table>
              <tbody>
                {analysisOptions.modelExplanation.map((method) => {
                  const compatible = isMethodCompatible(method);
                  return (
                  <tr
                    key={method}
                    className={`${selectedAnalyses.modelExplanation.includes(method) ? 'selected' : ''} ${!compatible ? 'disabled-method' : ''}`}
                    onClick={() => handleSelection(method, 'modelExplanation')}
                    title={!compatible ? getDisabledTooltip(method) : ''}
                  >
                    <td style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', opacity: compatible ? 1 : 0.45 }}>
                      <span>{method}</span>
                      <span onClick={(e) => e.stopPropagation()}>
                        <HelpTooltip placement="right" text={helpTexts.steps.step5.methodInfo[method] || ''}>i</HelpTooltip>
                      </span>
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Confirm Button perfectly centered within the grid */}
          <div className='analysis-button' style={{ gridColumn: '1 / -1', gridRow: '4', display: 'flex', justifyContent: 'center', visibility: confirmSelection ? 'hidden' : 'visible', marginTop: '8px' }}>
            <button
                onClick={handleConfirmSelection}
                disabled={!isAnyPrimaryAnalysisSelected}
              >
                Confirm Selection
              </button>
          </div>
        </div>
      </div>
        
      {/* Parameter Settings section - shown after Confirm Selection */}
      {confirmSelection && showParamsDropdown && (
        <div className="parameter-settings" ref={parameterSettingsRef}>
          <h4 style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>Parameter Settings
            <HelpTooltip placement="right" text={helpTexts.steps.step5.params}>info</HelpTooltip>
          </h4>
          <div className="selected-method-info">
            Selected Methods: 
            {[
              ...selectedAnalyses.statisticalTest, 
              ...selectedAnalyses.dimensionalityReduction, 
              ...selectedAnalyses.survivalAnalysis,
              ...selectedAnalyses.classificationAnalysis,
              ...selectedAnalyses.modelExplanation
            ].join(', ')}
          </div>
          {/* Global auto-tune switch - show only when classification or model explanation is selected */}
          {(selectedAnalyses.classificationAnalysis.length > 0 || selectedAnalyses.modelExplanation.length > 0) && (
            <div className="param-row" style={{ marginTop: '8px' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                <input 
                  type="checkbox" 
                  checked={paramFinetune}
                  onChange={(e) => { setParamFinetune(e.target.checked); handleParamChange(); }}
                />
                <span>Automatically tune parameters (may significantly increase the required time)</span>
              </label>
            </div>
          )}

          {isSurvivalSelected && (
            <div className="param-container">
              <div className="param-section">
                <div className="param-row survival-column-row">
                  <div className="param-label">
                    survival_time_column
                    <span className="param-tooltip">Column containing time-to-event values (e.g., days or months).</span>
                  </div>
                  <div className={`param-input ${!survivalTimeColumn && isSurvivalSelected ? 'required-param-missing-border' : ''}`}>
                    <SearchableColumnList
                      allColumns={survivalColumnOptions}
                      onSelect={(col) => { setSurvivalTimeColumn(prev => prev === col ? '' : col); handleParamChange(); }}
                      selectedColumns={survivalTimeColumn || []}
                      disabledColumns={eventStatusColumn ? [eventStatusColumn] : []}
                      placeholder="Search survival time column..."
                      listHeight="150px"
                      useAllColumnsAsDefault
                    />
                  </div>
                </div>

                <div className="param-row survival-column-row">
                  <div className="param-label">
                    event_status_column
                    <span className="param-tooltip">Column indicating event occurrence (typically 1=event, 0=censored).</span>
                  </div>
                  <div className={`param-input ${!eventStatusColumn && isSurvivalSelected ? 'required-param-missing-border' : ''}`}>
                    <SearchableColumnList
                      allColumns={survivalColumnOptions}
                      onSelect={(col) => { setEventStatusColumn(prev => prev === col ? '' : col); handleParamChange(); }}
                      selectedColumns={eventStatusColumn || []}
                      disabledColumns={survivalTimeColumn ? [survivalTimeColumn] : []}
                      placeholder="Search event status column..."
                      listHeight="150px"
                      useAllColumnsAsDefault
                    />
                  </div>
                </div>

                {selectedAnalyses.survivalAnalysis.includes('Kaplan-Meier') && (
                  <div className="param-row">
                    <div className="param-label">
                      km_confidence_level
                      <span className="param-tooltip">Confidence level for Kaplan-Meier confidence intervals.</span>
                    </div>
                    <div className="param-input">
                      <select value={kmConfidenceLevel} onChange={(e) => { setKmConfidenceLevel(Number(e.target.value)); handleParamChange(); }}>
                        {[0.8, 0.9, 0.95, 0.99].map((level) => (<option key={level} value={level}>{level}</option>))}
                      </select>
                    </div>
                  </div>
                )}

                {selectedAnalyses.survivalAnalysis.includes('Cox Regression') && (
                  <>
                    <div className="param-row">
                      <div className="param-label">
                        cox_penalizer
                        <span className="param-tooltip">Regularization strength for Cox regression (0 means no penalization).</span>
                      </div>
                      <div className="param-input">
                        <select value={coxPenalizer} onChange={(e) => { setCoxPenalizer(Number(e.target.value)); handleParamChange(); }}>
                          {[0.0, 0.01, 0.05, 0.1, 0.5, 1.0].map((value) => (<option key={value} value={value}>{value}</option>))}
                        </select>
                      </div>
                    </div>
                    <div className="param-row">
                      <div className="param-label">
                        cox_tie_method
                        <span className="param-tooltip">Method to handle tied event times in Cox regression.</span>
                      </div>
                      <div className="param-input">
                        <select value={coxTieMethod} onChange={(e) => { setCoxTieMethod(e.target.value); handleParamChange(); }}>
                          <option value="efron">efron</option>
                          <option value="breslow">breslow</option>
                        </select>
                      </div>
                    </div>
                  </>
                )}
              </div>

              {survivalInlineValidationMessage && (
                <div className="survival-validation-error" role="alert">{survivalInlineValidationMessage}</div>
              )}
            </div>
          )}
          
          {(selectedAnalyses.statisticalTest.length > 0 ||
            selectedAnalyses.modelExplanation.length > 0 ||
            selectedAnalyses.classificationAnalysis.length > 0 ||
            selectedAnalyses.dimensionalityReduction.length > 0) && (
          <div className="param-container">
            {/* Common parameters for any analysis that outputs a feature list */}
            {(selectedAnalyses.statisticalTest.length > 0 || selectedAnalyses.modelExplanation.length > 0 || selectedAnalyses.classificationAnalysis.some(m => m === 'Random Forest' || m === 'XGBClassifier')) && (
              <div className="param-section">
                <div className="param-row">
                  <div className="param-label">
                    feature_type
                    <span className="param-tooltip">Specifies the type of features used in the analysis (e.g., microRNA, gene, protein, etc.)</span>
                  </div>
                  <div className="param-input">
                    <input 
                      type="text" 
                      value={featureType} 
                      onChange={(e) => { setFeatureType(e.target.value); handleParamChange(); }} 
                    />
                  </div>
                </div>
                <div className="param-row">
                  <div className="param-label">
                    num_top_features
                    <span className="param-tooltip">Number of top ranked features to display in outputs.</span>
                  </div>
                  <div className="param-input">
                    <select value={numTopFeatures} onChange={(e) => { setNumTopFeatures(Number(e.target.value)); handleParamChange(); }}>
                      {allowedNumTopFeatureOptions.map(num => (<option key={num} value={num}>{num}</option>))}
                    </select>
                  </div>
                </div>
                {selectedAnalyses.statisticalTest.includes('Volcano') && (
                  <>
                    <div className="param-row">
                      <div className="param-label">
                        volcano_p_value_threshold
                        <span className="param-tooltip">P-value cutoff used to mark significant points in the volcano plot.</span>
                      </div>
                      <div className="param-input">
                        <select value={volcanoPValueThreshold} onChange={(e) => { setVolcanoPValueThreshold(Number(e.target.value)); handleParamChange(); }}>
                          {[0.1, 0.05, 0.01, 0.005, 0.001].map((p) => (<option key={p} value={p}>{p}</option>))}
                        </select>
                      </div>
                    </div>
                    <div className="param-row">
                      <div className="param-label">
                        volcano_log2fc_threshold
                        <span className="param-tooltip">Absolute log2 fold-change cutoff used to mark significant points in the volcano plot.</span>
                      </div>
                      <div className="param-input">
                        <select value={volcanoLog2FcThreshold} onChange={(e) => { setVolcanoLog2FcThreshold(Number(e.target.value)); handleParamChange(); }}>
                          {[0.5, 1.0, 1.5, 2.0, 3.0].map((fc) => (<option key={fc} value={fc}>{fc}</option>))}
                        </select>
                      </div>
                    </div>
                  </>
                )}
                {/* Aggregation method selector removed per requirement; combination happens in final results stage */}
              </div>
            )}

            {/* Parameters for Explanation models */}
            {selectedAnalyses.modelExplanation.length > 0 && (
              <div className="param-section">
                <div className="param-row">
                  <div className="param-label">
                    reference_class
                    <span className="param-tooltip">The reference class for comparison. Leave empty to use default.</span>
                  </div>
                  <div className="param-input">
                    <input type="text" value={referenceClass} onChange={(e) => { setReferenceClass(e.target.value); handleParamChange(); }} />
                  </div>
                </div>

                {selectedAnalyses.modelExplanation.includes('LIME') && (
                  <>
                    <div className="param-row">
                      <div className="param-label">lime_global_explanation_sample_num
                        <span className="param-tooltip">Number of samples used to build the global LIME summary.</span>
                      </div>
                      <div className="param-input">
                        <select value={limeGlobalExplanationSampleNum} onChange={(e) => { setLimeGlobalExplanationSampleNum(Number(e.target.value)); handleParamChange(); }}>
                          {[10, 20, 30, 40, 50, 60, 70, 80, 90, 100].map(num => (<option key={num} value={num}>{num}</option>))}
                        </select>
                      </div>
                    </div>
                    <div className="param-row">
                      <div className="param-label">lime_model_finetune
                        <span className="param-tooltip">Enable automatic tuning of LIME parameters (e.g., samples/neighborhood) for more stable explanations.</span>
                      </div>
                      <div className="param-input">
                        <select value={limeModelFinetune.toString()} onChange={(e) => { setLimeModelFinetune(e.target.value === "true"); handleParamChange(); }}>
                          <option value="true">True</option><option value="false">False</option>
                        </select>
                      </div>
                    </div>
                  </>
                )}

                {selectedAnalyses.modelExplanation.includes('SHAP') && (
                  <div className="param-row">
                    <div className="param-label">shap_model_finetune
                      <span className="param-tooltip">Enable SHAP settings fine-tuning (e.g., background sampling) to better align with the trained classifier.</span>
                    </div>
                    <div className="param-input">
                      <select value={shapModelFinetune.toString()} onChange={(e) => { setShapModelFinetune(e.target.value === "true"); handleParamChange(); }}>
                        <option value="true">True</option><option value="false">False</option>
                      </select>
                    </div>
                  </div>
                )}
                
                {selectedAnalyses.modelExplanation.includes('Permutation-Feature-Importance') && (
                  <div className="param-row">
                    <div className="param-label">feature_importance_finetune
                      <span className="param-tooltip">Enable tuning for permutation feature importance (e.g., repeats, scoring) for more robust estimates.</span>
                    </div>
                    <div className="param-input">
                      <select value={featureImportanceFinetune.toString()} onChange={(e) => { setFeatureImportanceFinetune(e.target.value === "true"); handleParamChange(); }}>
                        <option value="true">True</option><option value="false">False</option>
                      </select>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Parameters for any model-based analysis (Classification, Dimensionality, Explanation) */}
            {(selectedAnalyses.classificationAnalysis.length > 0  || selectedAnalyses.modelExplanation.length > 0) && (
              <div className="param-section">
                <div className="param-row">
                  <div className="param-label">
                    test_size
                    <span className="param-tooltip">Proportion of data reserved for testing (e.g., 0.2 = 20%).</span>
                  </div>
                  <div className="param-input">
                    <select value={testSize} onChange={(e) => { setTestSize(Number(e.target.value)); handleParamChange(); }}>
                      {[0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9].map(size => (<option key={size} value={size}>{size}</option>))}
                    </select>
                  </div>
                </div>
                <div className="param-row">
                  <div className="param-label">
                    n_folds
                    <span className="param-tooltip">Number of folds for cross-validation (e.g., 5 = five-fold CV).</span>
                  </div>
                  <div className="param-input">
                    <select value={nFolds} onChange={(e) => { setNFolds(Number(e.target.value)); handleParamChange(); }}>
                      {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(fold => (<option key={fold} value={fold}>{fold}</option>))}
                    </select>
                  </div>
                </div>
              </div>
            )}
            
            {/* Scoring parameter for model evaluation (Classification & Explanation) */}
            {(selectedAnalyses.classificationAnalysis.length > 0 || selectedAnalyses.modelExplanation.length > 0) && (
              <div className="param-section">
                <div className="param-row">
                  <div className="param-label">
                    scoring
                    <span className="param-tooltip">Primary metric for model selection/reporting. Prefer F1 or Recall for imbalanced data.</span>
                  </div>
                  <div className="param-input">
                    <select value={scoring} onChange={(e) => { setScoring(e.target.value); handleParamChange(); }}>
                      <option value="f1">f1</option><option value="recall">recall</option><option value="precision">precision</option><option value="accuracy">accuracy</option>
                    </select>
                  </div>
                </div>
              </div>
            )}

            {/* Dimensionality Reduction Parameters */}
            {selectedAnalyses.dimensionalityReduction.length > 0 && (
              <div className="param-section">
                <div className="param-row">
                  <div className="param-label">
                    plotter
                    <span className="param-tooltip">Visualization library to use for clustering plots.</span>
                  </div>
                  <div className="param-input">
                    <select value={plotter} onChange={(e) => { setPlotter(e.target.value); handleParamChange(); }}>
                      <option value="seaborn">seaborn</option><option value="matplotlib">matplotlib</option>
                    </select>
                  </div>
                </div>
                <div className="param-row">
                  <div className="param-label">
                    dim
                    <span className="param-tooltip">Dimension of the visualization: 2D or 3D.</span>
                  </div>
                  <div className="param-input">
                    <select value={dim} onChange={(e) => { setDim(e.target.value); handleParamChange(); }}>
                      <option value="2D">2D</option><option value="3D">3D</option>
                    </select>
                  </div>
                </div>
              </div>
            )}
            
            {/* Classification Analysis Parameters */}
            {selectedAnalyses.classificationAnalysis.length > 0 && (
              <div className="param-section">
                {/* Each parameter row is explained with a tooltip */}
                {/* param_finetune row removed; the global "Automatically tune parameters" switch above controls this */}
                
                <div className="param-row">
                  <div className="param-label">
                    finetune_fraction
                    <span className="param-tooltip">Fraction of training data used for stratified subsampling during hyperparameter tuning.</span>
                  </div>
                  <div className="param-input">
                    <select value={finetuneFraction} onChange={(e) => { setFinetuneFraction(Number(e.target.value)); handleParamChange(); }}>
                      {[0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0].map(frac => (<option key={frac} value={frac}>{frac}</option>))}
                    </select>
                  </div>
                </div>
                
                <div className="param-row">
                  <div className="param-label">
                    save_best_model
                    <span className="param-tooltip">When enabled, saves the best-performing model to disk.</span>
                  </div>
                  <div className="param-input">
                    <select value={saveBestModel.toString()} onChange={(e) => { setSaveBestModel(e.target.value === "true"); handleParamChange(); }}>
                      <option value="true">True</option><option value="false">False</option>
                    </select>
                  </div>
                </div>
                
                <div className="param-row">
                  <div className="param-label">
                    standard_scaling
                    <span className="param-tooltip">When enabled, standardizes features. Recommended for most models.</span>
                  </div>
                  <div className="param-input">
                    <select value={standardScaling.toString()} onChange={(e) => { setStandardScaling(e.target.value === "true"); handleParamChange(); }}>
                      <option value="true">True</option><option value="false">False</option>
                    </select>
                  </div>
                </div>

                <div className="param-row">
                  <div className="param-label">
                    use_preprocessing
                    <span className="param-tooltip">Enable built-in preprocessing (imputation/encoding/scaling). Disable to use raw data passthrough.</span>
                  </div>
                  <div className="param-input">
                    <select value={usePreprocessing.toString()} onChange={(e) => { setUsePreprocessing(e.target.value === "true"); handleParamChange(); }}>
                      <option value="true">True</option><option value="false">False</option>
                    </select>
                  </div>
                </div>
                
                <div className="param-row">
                  <div className="param-label">
                    save_data_transformer
                    <span className="param-tooltip">When enabled, saves the data scaling/transformation object.</span>
                  </div>
                  <div className="param-input">
                    <select value={saveDataTransformer.toString()} onChange={(e) => { setSaveDataTransformer(e.target.value === "true"); handleParamChange(); }}>
                      <option value="true">True</option><option value="false">False</option>
                    </select>
                  </div>
                </div>
                
                <div className="param-row">
                  <div className="param-label">
                    save_label_encoder
                    <span className="param-tooltip">When enabled, saves the label encoding object.</span>
                  </div>
                  <div className="param-input">
                    <select value={saveLabelEncoder.toString()} onChange={(e) => { setSaveLabelEncoder(e.target.value === "true"); handleParamChange(); }}>
                      <option value="true">True</option><option value="false">False</option>
                    </select>
                  </div>
                </div>
                
                <div className="param-row">
                  <div className="param-label">
                    verbose
                    <span className="param-tooltip">When enabled, provides detailed output during model training.</span>
                  </div>
                  <div className="param-input">
                    <select value={verbose.toString()} onChange={(e) => { setVerbose(e.target.value === "true"); handleParamChange(); }}>
                      <option value="true">True</option><option value="false">False</option>
                    </select>
                  </div>
                </div>
              </div>
            )}
          </div>
          )}
          
          {/* Parameter buttons */}
          <div className="param-buttons">
            <div className="default-param-option">
              <button onClick={handleUseDefaultParams} disabled={!isSurvivalConfigValid || isSurvivalSelected} title={!isSurvivalConfigValid || isSurvivalSelected ? 'Update Parameters to Continue' : ''}>
                Use default parameter settings
              </button>
            </div>
            
            {paramsChanged && (
              <div className="param-update-button">
                <button onClick={handleUpdateParams} disabled={!isSurvivalConfigValid} title={!isSurvivalConfigValid ? 'Select Survival Time and Event Status columns to continue.' : ''}>
                  Update Parameter Settings
                </button>
              </div>
            )}
          </div>
        </div>
      )}
      
      {/* Info message for selection */}
      {buttonPressed && !confirmSelection && (
          <div className="info-message">
             <p>Selected Method: 
            {[
              ...selectedAnalyses.statisticalTest, 
              ...selectedAnalyses.dimensionalityReduction, 
              ...selectedAnalyses.classificationAnalysis,
              ...selectedAnalyses.modelExplanation
            ].join(', ')}
            </p>
          </div>
        )}
    </div>
  );
}

export default AnalysisSelection;
