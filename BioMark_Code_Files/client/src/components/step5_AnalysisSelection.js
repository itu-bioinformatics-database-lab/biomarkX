import React, { useState, useRef, useEffect } from 'react';
import HelpTooltip from './common/HelpTooltip';
import { helpTexts } from '../content/helpTexts';
import Science from '@mui/icons-material/Science';
import Hub from '@mui/icons-material/Hub';
import AccountTree from '@mui/icons-material/AccountTree';
import Insights from '@mui/icons-material/Insights';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';

function AnalysisSelection({ onAnalysisSelection, afterFeatureSelection, onToggleAfterFS, canUseAfterFS, computedNumTopFeatures, onNumTopFeaturesChange }) {
  const [selectedAnalyses, setSelectedAnalyses] = useState({
    statisticalTest: [],
    dimensionalityReduction: [],
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
  
  // Common parameters
  const [testSize, setTestSize] = useState(0.2);
  const [nFolds, setNFolds] = useState(5);
  
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
    statisticalTest: ['T-test', 'Anova', 'Wilcoxon-rank-sum', 'Kruskal-Wallis'],
    dimensionalityReduction: ['PCA', 'tSNE', 'UMAP'],
    classificationAnalysis: ['Logistic Regression', 'Random Forest', 'XGBClassifier', 'Decision Tree', 'Gradient Boosting', 'CatBoosting Classifier', 'AdaBoost Classifier', 'MLPClassifier', 'SVC'],
    modelExplanation: ['SHAP', 'LIME', 'Permutation-Feature-Importance']
  };

  // Handle selection of analysis method
  const handleSelection = (method, category) => {
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
        classificationAnalysis: [],
        modelExplanation: [],
      };

      if (isDeselecting) {
        // If deselecting the active primary analysis, clear everything.
        return emptyState;
      } else {
        // If selecting a new primary analysis:
        // 1. Clear everything.
        // 2. Set the new selection in its category.
        return {
          ...emptyState,
          [category]: [method]
        };
      }
    });

    // Reset confirmation status whenever the selection changes
    setConfirmSelection(false);
    setShowParamsDropdown(false);
    setButtonPressed(false);
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
    completeSelection();
  };
  
  // Send selection and parameters to parent component
  const completeSelection = () => {
    const { statisticalTest, dimensionalityReduction, classificationAnalysis, modelExplanation } = selectedAnalyses;
    
    const result = {
      statisticalTest,
      dimensionalityReduction,
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
        usePreprocessing
      }
    };
    onAnalysisSelection(result);
  };

  // Determine if at least one analysis method is selected
  const isAnyAnalysisSelected = Object.values(selectedAnalyses).some(arr => arr.length > 0);

  return (
    <div className="analysis-selection">
      {/* Centered feature stage row above confirm button and tables */}
      <div className="feature-stage-row" style={{ width: '100%', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 12, padding: '10px 0 8px 0', flexWrap: 'wrap' }}>
          <div style={{ fontWeight: 700 }}>Feature selection stage</div>
          <div className="stage-switch" style={{ display: 'inline-flex', border: '1px solid #d7e2ff', borderRadius: 999, overflow: 'hidden' }}>
            <button
              type="button"
              onClick={() => onToggleAfterFS && onToggleAfterFS(false)}
              style={{ padding: '6px 12px', background: afterFeatureSelection ? '#fff' : '#eef3fd', color: afterFeatureSelection ? '#2b365a' : '#2f4fb5', border: 'none', fontWeight: 700, cursor: 'pointer', position: 'static', marginTop: 0 }}
            >
              All Features
            </button>
            <button
              type="button"
              title={canUseAfterFS ? "Use ranked top-N features" : "Top-N selection is disabled until a prior run produces feature importances."}
              onClick={() => (canUseAfterFS && onToggleAfterFS) ? onToggleAfterFS(true) : null}
              disabled={!canUseAfterFS}
              style={{ padding: '6px 12px', background: afterFeatureSelection ? '#eef3fd' : '#fff', color: afterFeatureSelection ? '#2f4fb5' : '#2b365a', border: 'none', fontWeight: 700, cursor: canUseAfterFS ? 'pointer' : 'not-allowed', opacity: canUseAfterFS ? 1 : 0.6, position: 'static', marginTop: 0 }}
            >
              Selected Top-{computedNumTopFeatures ?? numTopFeatures}
            </button>
          </div>
          <span style={{ marginLeft: 6, padding: '4px 10px', borderRadius: 999, background: '#f1f5ff', border: '1px solid #d7e2ff', color: '#2f4fb5', fontSize: 12, fontWeight: 700 }}>
            {afterFeatureSelection ? `Will run on: Selected Top-${computedNumTopFeatures ?? numTopFeatures} Features` : 'Will run on: All Features'}
          </span>
      </div>
      <div className="analysis-content-wrapper">
        {/* Removed duplicate floating info; main Step 5 title carries the info in App.js */}
        <div className='analysis-tables' style={{ maxWidth: 820 }}>
          {/* First Row */}
          <div className="analysis-row">
            {/* Statistical Test */}
            <div className="analysis-category">
              <h4 style={{ display: 'flex', alignItems: 'center', gap: '8px' }}><Science /> Statistical Test
                <HelpTooltip text={helpTexts.steps.step5.categories.statisticalTest}>info</HelpTooltip>
              </h4>
              <table>
                <tbody>
                  {analysisOptions.statisticalTest.map((method) => (
                    <tr
                      key={method}
                      className={selectedAnalyses.statisticalTest.includes(method) ? 'selected' : ''}
                      onClick={() => handleSelection(method, 'statisticalTest')}
                    >
                      <td style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
                        <span>{method}</span>
                        <span onClick={(e) => e.stopPropagation()}>
                          <HelpTooltip placement="right" text={helpTexts.steps.step5.methodInfo[method] || ''}>i</HelpTooltip>
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Dimensionality Reduction and Visualizations */}
            <div className="analysis-category">
              <h4 style={{ display: 'flex', alignItems: 'center', gap: '8px' }}><Hub /> Dimensionality Reduction and Visualization
                <HelpTooltip text={helpTexts.steps.step5.categories.dimensionalityReduction}>info</HelpTooltip>
              </h4>
              <table>
                <tbody>
                  {analysisOptions.dimensionalityReduction.map((method) => (
                    <tr
                      key={method}
                      className={selectedAnalyses.dimensionalityReduction.includes(method) ? 'selected' : ''}
                      onClick={() => handleSelection(method, 'dimensionalityReduction')}
                    >
                      <td style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
                        <span>{method}</span>
                        <span onClick={(e) => e.stopPropagation()}>
                          <HelpTooltip placement="right" text={helpTexts.steps.step5.methodInfo[method] || ''}>i</HelpTooltip>
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Second Row */}
          <div className="analysis-row">
            {/* Classification & Explanation Container */}
            <div className="classification-container">
              {/* Classification Analysis table */}
              <div className="analysis-category">
                <h4 style={{ display: 'flex', alignItems: 'center', gap: '8px' }}><AccountTree /> Classification Analysis
                  <HelpTooltip text={helpTexts.steps.step5.categories.classification}>info</HelpTooltip>
                </h4>
                <table>
                  <tbody>
                    {analysisOptions.classificationAnalysis.map((method) => (
                      <tr
                        key={method}
                        className={selectedAnalyses.classificationAnalysis.includes(method) ? 'selected' : ''}
                        onClick={() => handleSelection(method, 'classificationAnalysis')}
                      >
                        <td style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
                          <span>{method}</span>
                          <span onClick={(e) => e.stopPropagation()}>
                            <HelpTooltip placement="right" text={helpTexts.steps.step5.methodInfo[method] || ''}>i</HelpTooltip>
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Connector Arrow */}
              <div className={`connector ${selectedAnalyses.classificationAnalysis.length > 0 ? 'visible' : ''}`}>
                <ArrowForwardIcon fontSize="large" />
              </div>

              {/* Model Explanation - Conditionally Styled */}
              <div className={`analysis-category model-explanation-category ${selectedAnalyses.classificationAnalysis.length > 0 ? 'visible' : ''}`}>
                <h4 style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Insights /> Model Explanation
                  <span className="optional-text">(Optional)</span>
                  <HelpTooltip text={helpTexts.steps.step5.categories.explanation}>info</HelpTooltip>
                </h4>
                <table>
                  <tbody>
                    {analysisOptions.modelExplanation.map((method) => (
                      <tr
                        key={method}
                        className={selectedAnalyses.modelExplanation.includes(method) ? 'selected' : ''}
                        onClick={() => handleSelection(method, 'modelExplanation')}
                      >
                        <td style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
                          <span>{method}</span>
                          <span onClick={(e) => e.stopPropagation()}>
                            <HelpTooltip placement="right" text={helpTexts.steps.step5.methodInfo[method] || ''}>i</HelpTooltip>
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>

        {/* Confirm button retained in original place */}
        {!confirmSelection && (
        <div className='analysis-button'>
          <button
              onClick={handleConfirmSelection}
              disabled={!isAnyAnalysisSelected}
            >
              Confirm Selection
            </button>
        </div>
        )}
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
                    <span className="param-tooltip">Number of top features to select and display in the results.</span>
                  </div>
                  <div className="param-input">
                    <select value={numTopFeatures} onChange={(e) => { setNumTopFeatures(Number(e.target.value)); handleParamChange(); }}>
                      {[10, 20, 30, 40, 50, 60, 70, 80, 90, 100].map(num => (<option key={num} value={num}>{num}</option>))}
                    </select>
                  </div>
                </div>
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
            {(selectedAnalyses.classificationAnalysis.length > 0 || selectedAnalyses.dimensionalityReduction.length > 0 || selectedAnalyses.modelExplanation.length > 0) && (
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
          
          {/* Parameter buttons */}
          <div className="param-buttons">
            <div className="default-param-option">
              <button onClick={handleUseDefaultParams}>
                Use default parameter settings
              </button>
            </div>
            
            {paramsChanged && (
              <div className="param-update-button">
                <button onClick={handleUpdateParams}>
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
