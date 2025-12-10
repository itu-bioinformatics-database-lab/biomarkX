import './css/App.css';
import React, { useState, useRef , useEffect, useMemo, useCallback } from 'react';
import BarChartWithSelection from './components/step4_BarChartWithSelection';
import AnalysisSelection from './components/step5_AnalysisSelection';
import ImagePopup from './components/step8-1_ImagePopup'; // Import the component
import InputFormatPopup from './components/step1_InputFormatPopup'; // Import the new popup component
import AnalysisReport from './components/step9_AnalysisReport';
import SearchableColumnList from './components/SearchableColumnList'; // IMPORT THE NEW COMPONENT
import { api, buildUrl, apiFetch } from './api';
import UserGuideModal from './components/UserGuideModal';
import HelpTooltip from './components/common/HelpTooltip';
import AggregationHelpContent from './components/common/AggregationHelpContent';
import { helpTexts } from './content/helpTexts';
import LongRunNotificationModal from './components/common/LongRunNotificationModal';

function App() {
  // These are global variables. Values defined inside functions are not accessible everywhere. These solve that problem.
  // State Variables
  const [file, setFile] = useState(null);
  const fileInputRef = useRef(null); // File input reference
  const [error, setError] = useState('');
  const [previousAnalyses, setPreviousAnalyses] = useState([]); // Stores previous analyses
  const [loading, setLoading] = useState(false); // General loading (e.g. fetching classes, long requests)
  const [uploading, setUploading] = useState(false); // Only true while file is being uploaded
  const [analyzing, setAnalyzing] = useState(false);
  const [uploadedInfo, setUploadedInfo] = useState(null);
  const [showStepOne, setShowStepOne] = useState(true);
  const [showStepTwo, setShowStepTwo] = useState(false);
  const [showStepThree, setShowStepThree] = useState(false);
  const [showStepFour, setShowStepFour] = useState(false);
  const [showStepFive, setShowStepFive] = useState(false);
  const [showStepSix, setShowStepSix] = useState(false);
  const [showStepAnalysis, setShowStepAnalysis] = useState(false);
  const [classTable, setClassTable] = useState({ class: [] }); // Stores class table
  // eslint-disable-next-line no-unused-vars
  const [_isDiffAnalysisClasses, setIsDiffAnalysisClasses] = useState([]); // Stores classes for differential analysis
  const [afterFeatureSelection, setAfterFeatureSelection] = useState(false);
  const [canUseAfterFS, setCanUseAfterFS] = useState(false); // availability of top-N features
  const [selectedClasses, setselectedClasses] = useState([]);
  const [anotherAnalysis, setAnotherAnalysis] = useState([0]); // Stores analysis blocks
  const [analysisInformation, setAnalysisInformation] = useState([]); // Stores analysis information
  const [columns, setColumns] = useState([]); // Stores column names
  const [selectedIllnessColumn, setSelectedIllnessColumn] = useState(''); // Selected illness column
  const [selectedSampleColumn, setSelectedSampleColumn] = useState(''); // Selected sample column
  const [nonFeatureColumns, setNonFeatureColumns] = useState([]);
  const [selectedFeatureCount, setSelectedFeatureCount] = useState(10); // Default: 10 miRNAs selected
  const [showFormatPopup, setShowFormatPopup] = useState(false); // Controls file format popup
  const [availableClassPairs, setAvailableClassPairs] = useState([]);
  const [allColumns, setAllColumns] = useState([]); // Stores all columns
  const [loadingAllColumns, setLoadingAllColumns] = useState(false); // Loading state for all columns
  const [summarizeAnalyses, setSummarizeAnalyses] = useState([]); // Stores multiple summarize analyses
  const [info, setInfo] = useState('');
  const [processing, setProcessing] = useState(false); // Summarize process state
  const summarizeLockRef = useRef(false); // Prevent duplicate summarize requests
  const [combineError, setCombineError] = useState('');
  const [categoricalEncodingInfo, setCategoricalEncodingInfo] = useState(null); // Categorical encoding information
  const [showCategoricalModal, setShowCategoricalModal] = useState(false); // Show categorical encoding modal
  const [selectedAnalyzes, setSelectedAnalyzes] = useState({
    statisticalTest: [],
    dimensionalityReduction: [],
    classificationAnalysis: [],
    modelExplanation: []
  });
  const [linkExists, setLinkExists] = useState({});
  // Parameter States
  const [useDefaultParams, setUseDefaultParams] = useState(true);
  // Differential Analysis Parameters
  const [featureType, setFeatureType] = useState("microRNA");
  const [referenceClass, setReferenceClass] = useState("");
  const [limeGlobalExplanationSampleNum, setLimeGlobalExplanationSampleNum] = useState(50);
  const [shapModelFinetune, setShapModelFinetune] = useState(false);
  const [limeModelFinetune, setLimeModelFinetune] = useState(false);
  const [scoring, setScoring] = useState("f1");
  const [featureImportanceFinetune, setFeatureImportanceFinetune] = useState(false);
  const [numTopFeatures, setNumTopFeatures] = useState(20);
  // Aggregation for Combine step
  const [aggregationMethod, setAggregationMethod] = useState('rrf');
  const [aggregationWeights, setAggregationWeights] = useState('');
  const [rrfK, setRrfK] = useState(60);
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
  // eslint-disable-next-line no-unused-vars
  const [usePreprocessing, setUsePreprocessing] = useState(false);
  // Common Parameters
  const [testSize, setTestSize] = useState(0.2);
  const [nFolds, setNFolds] = useState(5);
  
  const stepThreeRef = useRef(null);
  const stepFourRef = useRef(null);
  const stepFiveRef = useRef(null);
  const stepSixRef = useRef(null);
  const stepAnalysisRef = useRef(null);
  const pageRef = useRef(null);   // You can define refs for other steps as well.
  const [demoMode, setDemoMode] = useState(false);   // Add demo mode to the app state
  const [imageVersion, setImageVersion] = useState(0);
  const [showUserGuide, setShowUserGuide] = useState(false); // Controls user guide modal
  const [plotGuideOpenByIndex, setPlotGuideOpenByIndex] = useState({}); // Results: per-analysis plot guide toggle

  // Long-run notification modal and email state
  const [showLongRunModal, setShowLongRunModal] = useState(false);
  const [clientJobId, setClientJobId] = useState(null);
  const [defaultNotifyEmail, setDefaultNotifyEmail] = useState('');

  // State for upload duration (file upload time)
  const [uploadDuration, setUploadDuration] = useState(null);
  const [loadingClasses, setLoadingClasses] = useState(false); // loading while fetching class list

   // Memoize the first 10 columns - prevents recalculation on every render
   const firstTenColumns = useMemo(() => {
    // If allColumns is filled and columns is empty, use the first 10 of allColumns
    if (allColumns.length > 0 && columns.length === 0) {
        return allColumns.slice(0, 10);
    }
    // Otherwise, use the first 10 of the current columns state
    return columns.slice(0, 10);
   }, [columns, allColumns]); // Add allColumns as a dependency

  // Load last used email from localStorage
  useEffect(() => {
    try {
      const saved = localStorage.getItem('notifyEmail');
      if (saved) setDefaultNotifyEmail(saved);
    } catch (e) {}
  }, []);

  const generateClientJobId = () => {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    // Fallback simple UUID v4-like
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      const r = Math.random() * 16 | 0, v = c === 'x' ? r : ((r & 0x3) | 0x8);
      return v.toString(16);
    });
  };

  const parseFileSizeMB = (sizeStr) => {
    if (!sizeStr) return 0;
    const m = String(sizeStr).match(/([0-9]+\.?[0-9]*)\s*MB/i);
    return m ? parseFloat(m[1]) : 0;
  };

  function computeLongRunRisk({
    fileSizeMB = 0,
    classificationModels = [],
    paramFinetune = false,
    finetuneFraction = 1.0
  }) {
    let score = 0;
  
    // File size
    if (fileSizeMB > 50) score += 4;
    else if (fileSizeMB > 30) score += 2;
    else if (fileSizeMB > 10) score += 1;
  
    // Heavy classification models
    const heavyModels = [
      'XGBClassifier',
      'CatBoosting Classifier',
      'MLPClassifier',
      'SVC',
      'Random Forest',
      'Gradient Boosting',
      'AdaBoost'
    ];
    const usesHeavyModel = (classificationModels || []).some(m => heavyModels.includes(m));
    if (usesHeavyModel) score += 3;
  
    // Finetune parameters
    if (paramFinetune) score += 3;
    if (finetuneFraction >= 0.9) score += 2;
    else if (finetuneFraction > 0.5) score += 1;
  
    return score;
  }

  const isLikelyLongRun = () => {
    const fileSizeMB = parseFileSizeMB(uploadedInfo?.size);
    const score = computeLongRunRisk({
      fileSizeMB,
      classificationModels: selectedAnalyzes.classificationAnalysis || [],
      paramFinetune,
      finetuneFraction
    });
    return score >= 7;
  };

  // Build CSV download links for a given image path
  const buildDownloadLinks = (imagePath) => {
    try {
      const links = [];
      const parts = (imagePath || '').split('/');
      const idxRes = parts.indexOf('results');
      if (idxRes === -1) return links;
      const fileName = parts[idxRes + 1];
      const classPair = parts[idxRes + 2];

      // Optional phase between classPair and method (e.g., 'initial', 'AfterFeatureSelection')
      const afterPair = parts.slice(idxRes + 3);
      const methodKeys = new Set(['t_test', 'anova', 'shap', 'lime', 'feature_importance', 'models', 'summaryStatisticalMethods']);
      const foundIdx = afterPair.findIndex(seg => methodKeys.has(seg));
      const phase = foundIdx > 0 ? afterPair.slice(0, foundIdx).join('/') : (foundIdx === 0 ? '' : afterPair.slice(0, 1).join('/'));
      const sub1 = foundIdx >= 0 ? afterPair[foundIdx] : afterPair[0];

      const basePrefix = `/results/${fileName}/${classPair}` + (phase ? `/${phase}` : '');

      // Statistical: t_test / anova
      if (sub1 === 't_test') {
        links.push({ href: buildUrl(`${basePrefix}/t_test/t_test_results.csv`), label: 'Download Model Details as CSV' });
        // Aggregated (combined) ranking for the class pair
        links.push({ href: buildUrl(`/results/${fileName}/feature_ranking/${classPair}/ranked_features_df.csv`), label: 'Download Biomarker List (Combined)' });
        // Method-specific ranked list for t_test only
        links.push({ href: buildUrl(`/results/${fileName}/feature_ranking/${classPair}/method=statistical_tests_analysis=t_test/ranked_features_df.csv`), label: 'Download Biomarker List as CSV' });
        return links;
      }
      if (sub1 === 'anova') {
        links.push({ href: buildUrl(`${basePrefix}/anova/anova_results.csv`), label: 'Download Model Details as CSV' });
        // Aggregated (combined) ranking for the class pair
        links.push({ href: buildUrl(`/results/${fileName}/feature_ranking/${classPair}/ranked_features_df.csv`), label: 'Download Biomarker List (Combined)' });
        // Method-specific ranked list for anova only
        links.push({ href: buildUrl(`/results/${fileName}/feature_ranking/${classPair}/method=statistical_tests_analysis=anova/ranked_features_df.csv`), label: 'Download Biomarker List as CSV' });
        return links;
      }

      // Model Explanation: SHAP / LIME
      if (sub1 === 'shap') {
        const raw = (imagePath.split('/').pop() || '').toLowerCase();
        // Show only on a canonical SHAP image to avoid duplicates
        if (raw.includes('mean_shap_plot_overall')) {
          links.push({ href: buildUrl(`${basePrefix}/shap/shap_feature_importance.csv`), label: 'Download Model Details as CSV' });
        }
        return links;
      }
      if (sub1 === 'lime') {
        const raw = (imagePath.split('/').pop() || '').toLowerCase();
        // Show only on LIME summary image to avoid duplicates
        if (raw.includes('lime_summary_plot')) {
          links.push({ href: buildUrl(`${basePrefix}/lime/lime_feature_importance.csv`), label: 'Download Model Details as CSV' });
        }
        return links;
      }

      // Feature importance (Permutation and built-ins)
      if (sub1 === 'feature_importance') {
        const basePath = `${basePrefix}/feature_importance`;
        const rawName = (imagePath.split('/').pop() || '').toLowerCase();
        if (rawName.includes('permutation_features_plot')) {
          links.push({ href: buildUrl(`${basePath}/permutation_feature_importance_summary.csv`), label: 'Download Summary CSV' });
          links.push({ href: buildUrl(`${basePath}/permutation_feature_importance_matrix.csv`), label: 'Download Matrix CSV' });
        } else {
          const modelFile = (imagePath.split('/').pop() || '').replace('_feature_importance.png', '');
          const csvPath = `${basePath}/${modelFile}_feature_importance.csv`;
          links.push({ href: buildUrl(csvPath), label: 'Download Model Details as CSV' });
        }
        return links;
      }

      // Classification model results tables
      if (sub1 === 'models') {
        const modelName = parts[idxRes + 4] && !methodKeys.has(parts[idxRes + 4]) ? parts[idxRes + 4] : parts[idxRes + 5];
        if (fileName && classPair && modelName) {
          links.push({ href: buildUrl(`${basePrefix}/models/${modelName}/${modelName}_results.csv`), label: 'Download Model Details as CSV' });
          links.push({ href: buildUrl(`${basePrefix}/models/${modelName}/${modelName}_cv_folds.csv`), label: 'Download CV CSV' });
        }
        return links;
      }

      return links;
    } catch (e) {
      return [];
    }
  };

  // Check existence of candidate download links in wizard and cache results
  useEffect(() => {
    async function checkAllLinks() {
      try {
        const candidates = new Set();
        (previousAnalyses || []).forEach((a) => {
          (a?.results || []).forEach((p) => {
            const links = buildDownloadLinks(p);
            links.forEach((l) => {
              if (!Object.prototype.hasOwnProperty.call(linkExists, l.href)) {
                candidates.add(l.href);
              }
            });
          });
        });
        if (candidates.size === 0) return;
        const results = {};
        await Promise.all(
          Array.from(candidates).map(async (url) => {
            try {
              const res = await apiFetch(url, { method: 'HEAD' });
              results[url] = res.ok === true;
            } catch (e) {
              results[url] = false;
            }
          })
        );
        setLinkExists((prev) => ({ ...prev, ...results }));
      } catch (e) {
        // ignore
      }
    }
    if (Array.isArray(previousAnalyses) && previousAnalyses.length > 0) {
      checkAllLinks();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previousAnalyses]);

  // Small helper component to render Best Params CSV link after checking existence
  const BestParamsCsvLink = ({ firstResultPath, bestParams }) => {
    const [url, setUrl] = React.useState(null);
    const [exists, setExists] = React.useState(false);
    const blobUrl = React.useMemo(() => {
      try {
        if (!bestParams) return null;
        const rows = [['Model', 'Parameter', 'Value']];
        Object.entries(bestParams).forEach(([modelName, paramsObj]) => {
          if (paramsObj && typeof paramsObj === 'object') {
            Object.entries(paramsObj).forEach(([k, v]) => {
              const printable = Array.isArray(v) ? JSON.stringify(v) : String(v);
              rows.push([modelName, k, printable]);
            });
          }
        });
        const csv = rows.map(r => r.map(x => '"' + String(x).replace(/"/g, '""') + '"').join(',')).join('\n');
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        return URL.createObjectURL(blob);
      } catch (_) {
        return null;
      }
    }, [bestParams]);
    React.useEffect(() => () => { try { if (blobUrl) URL.revokeObjectURL(blobUrl); } catch (_) {} }, [blobUrl]);
    React.useEffect(() => {
      let cancelled = false;
      (async () => {
        try {
          if (!firstResultPath) { setExists(false); setUrl(null); return; }
          const parts = String(firstResultPath).split('/');
          const idx = parts.indexOf('results');
          if (idx < 0 || parts.length < idx + 3) { setExists(false); setUrl(null); return; }
          const candidate = buildUrl(`/results/${parts[idx + 1]}/${parts[idx + 2]}/best_params.csv`);
          setUrl(candidate);
          try {
            const res = await apiFetch(candidate, { method: 'HEAD' });
            if (!cancelled) setExists(res.ok === true);
          } catch (_) {
            if (!cancelled) setExists(false);
          }
        } catch (_) {
          if (!cancelled) { setExists(false); setUrl(null); }
        }
      })();
      return () => { cancelled = true; };
    }, [firstResultPath]);
    if (url && exists) {
      return (
        <div style={{ marginTop: 10 }}>
          <a href={url} download style={{ padding: '6px 10px', border: '1px solid #d7e2ff', borderRadius: 6, background: '#eef3fd', color: '#2f4fb5', fontWeight: 700 }}>
            Download Best Params CSV
          </a>
        </div>
      );
    }
    if (blobUrl) {
      return (
        <div style={{ marginTop: 10 }}>
          <a href={blobUrl} download="best_params.csv" style={{ padding: '6px 10px', border: '1px solid #d7e2ff', borderRadius: 6, background: '#eef3fd', color: '#2f4fb5', fontWeight: 700 }}>
            Download Best Params CSV
          </a>
        </div>
      );
    }
    return null;
  };

  const handleNotifyConfirm = async (email) => {
    try {
      if (clientJobId) {
        await api.post('/api/analysis/notify', { jobId: clientJobId, email });
      }
      try { localStorage.setItem('notifyEmail', email); } catch (e) {}
    } catch (e) {
      console.error('Failed to register notification:', e);
    } finally {
      setShowLongRunModal(false);
    }
  };
  
  // Helper Function: General function to fetch all columns (will use this function)
  const fetchAllColumnsGeneric = async (filePath) => { // filePath should be passed as a parameter
    if (!filePath) {
      console.error("File path is not available for fetching all columns.");
      return [];
    }
    try {
      const response = await api.post('/get_all_columns', {
        filePath: filePath // Use the filePath passed as a parameter
      });
      if (response.data.success) {
        return response.data.columns;
      } else {
        console.error('Error fetching all columns:', response.data.message);
        setError('Failed to fetch all columns in background.'); // Update error message
        return [];
      }
    } catch (error) {
      console.error('Error fetching all columns:', error);
      setError('An error occurred while fetching all columns in background.'); // Update error message
      return [];
    }
  };

  // Function to fetch all columns in the background
  const fetchAllColumnsInBackground = async (filePath) => {
    if (!filePath || loadingAllColumns || allColumns.length > 0) return;

    setLoadingAllColumns(true);
    setError(''); // Clear previous errors
    const fetchedColumns = await fetchAllColumnsGeneric(filePath);
    setAllColumns(fetchedColumns);
    setLoadingAllColumns(false);
    console.log("Fetched all columns in background:", fetchedColumns.length);
  };

  // Helper Function: scrollIntoView function
  const scrollToStep = useCallback((stepRef) => {
    if (stepRef.current) {
      // Add an offset (banner height) so it appears below the banner
      const headerHeight = document.querySelector('.app-header')?.offsetHeight || 0;
      const yOffset = -headerHeight - 20; // Banner height + extra space
      
      const element = stepRef.current;
      const elementPosition = element.getBoundingClientRect().top + window.pageYOffset;
      
      window.scrollTo({
        top: elementPosition + yOffset,
        behavior: 'smooth'
      });
    }
  }, []);

  // Helper Function: Helper function to truncate long file names
  const truncateFileName = (fileName, maxLength = 25) => {
    if (!fileName || fileName.length <= maxLength) return fileName;
    
    // Separate file name and extension
    const lastDotIndex = fileName.lastIndexOf('.');
    if (lastDotIndex === -1) {
      // If there is no extension
      return fileName.substring(0, maxLength - 3) + '...';
    }
    
    const name = fileName.substring(0, lastDotIndex);
    const extension = fileName.substring(lastDotIndex);
    
    // If name + ... + extension is longer than maxLength
    if (name.length + 3 + extension.length > maxLength) {
        // Leave space for extension and "..." when truncating the name
        const availableLengthForName = maxLength - 3 - extension.length;
        const truncatedName = name.substring(0, Math.max(0, availableLengthForName));
        return truncatedName + '...' + extension;
    }
    
    return fileName;
  };

  // Step 1: Function to open the format popup
  const handleOpenFormatPopup = () => {
    // Starting/Guiding a new analysis should reset stage to All Features
    setAfterFeatureSelection(false);
    setCanUseAfterFS(false);
    setShowFormatPopup(true);
  };

  // Step 1: Function to close the format popup
  const handleCloseFormatPopup = () => {
    setShowFormatPopup(false);
  };

  // Step 1: Handles clicking the Browse button and selecting a file
  const handleBrowseClick = () => {
    setFile(null); // Show file name when a file is selected
    setInfo(''); // Clear info message
    // Reset stage to All Features when a fresh file is chosen
    setAfterFeatureSelection(false);
    setCanUseAfterFS(false);
    
    // Reset FileInput value
    if (fileInputRef.current) {
      fileInputRef.current.value = null;
    }
    
    document.getElementById('fileInput').click(); // Trigger the input element
  };

  // Step 1: Handles actions when the demo file is selected
  const handleDemoFileClick = async () => {
    // Record the start time to calculate the loading duration later
    const startTime = performance.now();
    setDemoMode(true);
    setLoading(true);
    // Reset feature selection stage for a fresh analysis session
    setAfterFeatureSelection(false);
    setCanUseAfterFS(false);
    setInfo('Loading demo dataset...');
    setFile(new File([""], "GSE120584_serum_norm_demo.csv", { type: "text/csv" }));
    setError(''); // Clear errors
    setAllColumns([]); // Clear previous all columns
    
    try {
      const response = await api.get("/get-demo-data");
      console.log("Demo data response:", response.data);
      
      if (response.data && response.data.filePath) {
        const demoFilePath = response.data.filePath;
        // Convert bytes to human-readable MB with one decimal
        const prettySize = response.data.fileSize ? `${(response.data.fileSize / (1024 * 1024)).toFixed(1)} MB` : 'N/A';

        setUploadedInfo({
          name: "GSE120584_serum_norm_demo.csv",
          size: prettySize,
          filePath: demoFilePath,
        });
        // Also set the first columns to state (if backend provides them)
        setColumns(response.data.columns || []);
        setShowStepTwo(true);
        setShowStepThree(true);
        
        // Fetch all columns in the background (with path)
        fetchAllColumnsInBackground(demoFilePath);

        // Calculate and display the loading time in seconds with two decimals
        const loadTimeSec = ((performance.now() - startTime) / 1000).toFixed(2);
        console.log(`Demo dataset loaded in ${loadTimeSec} seconds.`);
        setInfo(`Demo dataset loaded in ${loadTimeSec} seconds.`);
        setUploadDuration(`${loadTimeSec} s`);
        // Hide the info message after a short delay so it does not clutter the UI
        setTimeout(() => setInfo(''), 5000);

        // Scrolling is handled by useEffect

      } else {
        setError('Demo data could not be retrieved or file path missing.');
      }
    } catch (error) {
      console.error("Error getting demo data:", error);
      setError('Failed to retrieve demo data: ' + (error.response?.data?.message || error.message || 'Unknown error'));
    } finally {
      setLoading(false);
      setInfo('');
    }
  };

  // Step 1: Updates state after a file is selected
  const handleFileChange = (e) => {
    setDemoMode(false);     // Turn off demo mode when file changes
    const selectedFile = e.target.files[0];
    if (selectedFile) {
        setFile(selectedFile);
    setError('');
        // Show Step 2, waiting for upload
    setShowStepTwo(true);
        // Clear previous upload info and columns
        setUploadedInfo(null);
        setColumns([]);
        setAllColumns([]);
        setShowStepThree(false); // Hide Step 3 since not uploaded yet
    }
  };

  // Step 2: Handles actions when the Upload button is clicked
  const handleUpload = async () => {
    // If in demo mode, call the relevant function and exit
    if (demoMode) {
      handleDemoFileClick();
      return;
    }

    if (!file) {
      setError('Please select a file!');
      setLoading(false); // Not even started loading
      return;
    }
    
    // Extension Check
    const validTypes = [
      'text/csv',
      'text/plain',
      'application/gzip',
      'application/x-gzip',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/zip'
    ];

    // Check MIME type, if not, check file extension
    let isValidType = validTypes.includes(file.type);
    if (!isValidType && file.name) {
        const fileExtension = file.name.split('.').pop()?.toLowerCase();
        const allowedExtensions = ['csv','tsv','txt','xlsx','gz','zip'];
        if (allowedExtensions.includes(fileExtension)) {
            isValidType = true;
        }
         // Special check for gzip (MIME type may be wrong sometimes)
         if (fileExtension === 'gz' && !isValidType) isValidType = true;
    }


    if (!isValidType) {
        setError('Please upload a valid file (CSV, TSV, TXT, XLSX, GZ, or ZIP).');
        setLoading(false); // Reset loading state
        return;
    }

    // Upload is starting
    const uploadStartTime = Date.now(); // Start time for duration measurement
    setUploadDuration(null); // Reset previous measurement
    setUploading(true);
    setLoading(true);
    setError(''); // Clear previous errors
    setAllColumns([]); // Clear previous all columns

    const formData = new FormData();
    formData.append('file', file);

    try {
      // First, upload the file to /upload endpoint and get the first columns
      const response = await api.post('/upload', formData);
      console.log("Upload response:", response.data);

      if (response.data.success && response.data.filePath) {
        const uploadedFilePath = response.data.filePath;
        // Save the first columns to state
        setColumns(response.data.columns || []);
        setUploadedInfo({
          name: file.name,
          size: (file.size / 1024 / 1024).toFixed(2) + ' MB',
          filePath: uploadedFilePath,
        });
        setShowStepThree(true); // Show step three

        // Fetch ALL columns in the background
        fetchAllColumnsInBackground(uploadedFilePath);

        // Scrolling is handled by useEffect

      } else {
         // Failed upload case
         setError(response.data.message || 'File upload failed. Please check the file format and try again.');
         // If failed, do not show next steps
         setShowStepThree(false);
         setUploadedInfo(null);
         setColumns([]);
      }
    } catch (error) {
      setError('An error occurred during upload. Please try again.');
      console.error('Error uploading file:', error.message || error);
      // Hide next steps in case of error
      setShowStepThree(false);
      setUploadedInfo(null);
      setColumns([]);
    } finally {
      // Upload finished (success or failure)
      const durationSeconds = ((Date.now() - uploadStartTime) / 1000).toFixed(2);
      setUploadDuration(`${durationSeconds} s`);
      setLoading(false);
      setUploading(false);
      setInfo('');
    }
  };

  // Step 3: Select the disease column
  const handleIllnessColumnSelection = async (illnessColumn) => {
    console.log("handleIllnessColumnSelection called with:", illnessColumn);
    setError('');
    setSelectedIllnessColumn(illnessColumn);
    if (illnessColumn === selectedSampleColumn) {
        setSelectedSampleColumn(''); // Reset Sample ID if same as illness column
        setInfo("Patient Group and Sample ID columns cannot be the same. Sample ID selection reset.");
        setTimeout(() => setInfo(''), 3000);
    }
    setClassTable({ class: [] }); // Clear class table for new query

    if (uploadedInfo?.filePath) {
        try {
          setLoadingClasses(true); // Loading state while fetching classes
      const response = await api.post('/get_classes', {
            filePath: uploadedInfo.filePath,
            columnName: illnessColumn,
          });
          console.log("Get classes response: ",response.data);
          if (response.data.success && response.data.classList_) {
            // Safely parse JSON
            let classes = [];
            let diagramUrl = '';
            try {
                // If classList_ is an array like ['[...]','path/to/img.png']
                if (Array.isArray(response.data.classList_) && response.data.classList_.length >= 2) {
                    classes = JSON.parse(response.data.classList_[0].replace(/'/g, '"'));
                    diagramUrl = response.data.classList_[1];
                } else {
                    // Maybe only class list is returned
                    classes = JSON.parse(response.data.classList_.replace(/'/g, '"'));
                }
            } catch (parseError) {
                console.error("Failed to parse class list:", parseError);
                setError("Failed to parse class information from server.");
                classes = [];
            }
  
            setClassTable({
              class: classes,
              classDiagramUrl: diagramUrl,
            });
            setselectedClasses([]); // Reset selected classes since new column is selected
            
            // If Sample ID is also selected, scroll to Step 4
            if (selectedSampleColumn && illnessColumn) {
                setShowStepFour(true);
                setTimeout(() => {
                    if (stepFourRef.current) scrollToStep(stepFourRef);
                }, 100);
            }
        
      } else {
        setError('Failed to retrieve classes for the selected column.');
            setClassTable({ class: [] });
      }
    } catch (error) {
      setError('An error occurred while fetching classes. Please try again.');
      console.error('Error fetching classes:', error.message || error);
          setClassTable({ class: [] });
        } finally {
            setLoadingClasses(false);
        }
    } else {
        setError("Cannot fetch classes: Uploaded file information is missing.");
    }
  };

  const handleSampleColumnSelection = async (sampleColumn) => {
    console.log("handleSampleColumnSelection called with:", sampleColumn);
    setError('');
    if (sampleColumn === selectedIllnessColumn) {
        setError("Sample ID and Patient Group columns cannot be the same.");
        return; 
    }
    setSelectedSampleColumn(sampleColumn);
    
    // If Patient Group column is also selected, scroll to Step 4
    if (selectedIllnessColumn && sampleColumn) {
        setShowStepFour(true);
        setTimeout(() => {
            if (stepFourRef.current) scrollToStep(stepFourRef);
        }, 100);
    }
  };

  // Show Step 4: When both columns (Illness & Sample) are selected
  useEffect(() => {
    console.log("[Effect Check Step 4 Visibility] Illness:", selectedIllnessColumn, "Sample:", selectedSampleColumn);
    if (selectedIllnessColumn && selectedSampleColumn) {
      console.log("[Effect Check Step 4 Visibility] Setting showStepFour to TRUE");
      setShowStepFour(true);
      setTimeout(() => { 
        if (stepFourRef.current) scrollToStep(stepFourRef);
      }, 100);
    } else {
      // Only log if showStepFour is true (to reduce unnecessary logs)
      if (showStepFour) {
        console.log("[Effect Check Step 4 Visibility] Setting showStepFour to FALSE");
      }
      // If one of the columns is removed, hide Step 4 and later steps
      setShowStepFour(false);
      setShowStepFive(false);
      setShowStepSix(false);
      setShowStepAnalysis(false);
      setselectedClasses([]); // Also reset selected classes
      // Also reset class table if illness column is removed
      if (!selectedIllnessColumn) {
          setClassTable({ class: [] });
      }
    }
  }, [selectedIllnessColumn, selectedSampleColumn, showStepFour, setShowStepFour, setShowStepFive, setShowStepSix, setShowStepAnalysis, setselectedClasses, setClassTable, stepFourRef, scrollToStep]);

  // Show Step 5: When Step 4 is visible and 2 classes are selected
  useEffect(() => {
    console.log("[Effect Check Step 5 Visibility] showStepFour:", showStepFour, "selectedClasses:", selectedClasses.length);
    if (showStepFour && selectedClasses.length === 2) {
        console.log("[Effect Check Step 5 Visibility] Setting showStepFive to TRUE");
        setShowStepFive(true);
    } else {
        // Only log if showStepFive is true
        if (showStepFive) {
            console.log("[Effect Check Step 5 Visibility] Setting showStepFive to FALSE");
        }
        setShowStepFive(false);
        // When Step 5 is hidden, also hide later steps
        setShowStepSix(false);
        setShowStepAnalysis(false);
    }
  }, [showStepFour, showStepFive, selectedClasses, setShowStepFive, setShowStepSix, setShowStepAnalysis]);

  const handleClassSelection = async (newlySelectedClasses) => {
    // Ensure the array always has 2 elements (BarChartWithSelection should enforce this)
    if (Array.isArray(newlySelectedClasses) && newlySelectedClasses.length === 2) {
        setselectedClasses(newlySelectedClasses);
        console.log("Selected classes: ", newlySelectedClasses);
        setShowStepFive(true); // Show Step 5 when classes are selected

        // Scroll to Step 5
        setTimeout(() => {
          if (stepFiveRef.current) scrollToStep(stepFiveRef);
        }, 100);
    } else {
        console.warn("handleClassSelection received invalid selection:", newlySelectedClasses);
        // In case of error, reset state or show error message
        setselectedClasses([]);
        setShowStepFive(false);
    }
  };


  // 5.Adım: Seçilen analizleri state'e kaydeder. 
  const handleAnalysisSelection = async (selectedAnalyzesUpdate) => {
    console.log("handleAnalysisSelection called with:", selectedAnalyzesUpdate);

    // Check the structure of the incoming data
    if (!selectedAnalyzesUpdate || typeof selectedAnalyzesUpdate !== 'object') {
        console.error("Invalid data received in handleAnalysisSelection");
        return;
    }

    const { 
      statisticalTest = [], 
      dimensionalityReduction = [], 
      classificationAnalysis = [], 
      modelExplanation = [], 
      useDefaultParams: useDefault, 
      parameters 
    } = selectedAnalyzesUpdate;

    // Update states
    if (statisticalTest.length > 0 || modelExplanation.length > 0) {
      setIsDiffAnalysisClasses(selectedClasses); // This is also similar to selectedClasses
    } else {
        setIsDiffAnalysisClasses([]);
    }

    setSelectedAnalyzes({ statisticalTest, dimensionalityReduction, classificationAnalysis, modelExplanation });
    setUseDefaultParams(useDefault);

    // Update parameters if custom params are selected
    if (!useDefault && parameters) {
        setFeatureType(parameters.featureType ?? "microRNA");
        setReferenceClass(parameters.referenceClass ?? "");
        setLimeGlobalExplanationSampleNum(parameters.limeGlobalExplanationSampleNum ?? 50);
        setShapModelFinetune(parameters.shapModelFinetune ?? false);
        setLimeModelFinetune(parameters.limeModelFinetune ?? false);
        setScoring(parameters.scoring ?? "f1");
        setFeatureImportanceFinetune(parameters.featureImportanceFinetune ?? false);
        setNumTopFeatures(parameters.numTopFeatures ?? 20);
        setPlotter(parameters.plotter ?? "seaborn");
        setDim(parameters.dim ?? "3D");
        setParamFinetune(parameters.paramFinetune ?? false);
        setFinetuneFraction(parameters.finetuneFraction ?? 1.0);
        setSaveBestModel(parameters.saveBestModel ?? true);
        setStandardScaling(parameters.standardScaling ?? true);
        setSaveDataTransformer(parameters.saveDataTransformer ?? true);
        setSaveLabelEncoder(parameters.saveLabelEncoder ?? true);
        setVerbose(parameters.verbose ?? true);
        setTestSize(parameters.testSize ?? 0.2);
        setNFolds(parameters.nFolds ?? 5);
        setUsePreprocessing(parameters.usePreprocessing ?? false);
        // Aggregation params (optional)
        if (parameters.aggregationMethod !== undefined) setAggregationMethod?.(parameters.aggregationMethod);
        if (parameters.aggregationWeights !== undefined) setAggregationWeights?.(parameters.aggregationWeights);
        if (parameters.rrfK !== undefined) setRrfK?.(parameters.rrfK);
    } else {
        // Optionally reset to default parameters
    }

    setShowStepSix(true); // Show Step 6 after analysis selection
    // Scroll is handled in useEffect
    // scrollToStep(stepSixRef);

    setInfo('Analysis method selected. You can now optionally exclude non-feature columns.');
    setTimeout(() => setInfo(''), 5000); // Message duration

    console.log("handleAnalysisSelection finished. State updated:", { statisticalTest, dimensionalityReduction, classificationAnalysis, modelExplanation, useDefaultParams: useDefault });
  };


  // 6.Adım: Non-feature sütun ekleme (Listeden seçildiğinde)
  const handleAddNonFeatureColumn = (columnToAdd) => {
    // The selected column cannot be illness or sample column
    if (columnToAdd === selectedIllnessColumn || columnToAdd === selectedSampleColumn) {
        setInfo(`Column "${columnToAdd}" is already selected as Patient Group or Sample ID and cannot be excluded.`);
        setTimeout(() => setInfo(''), 3000);
      return;
    }
    // Add if not already selected
    if (!nonFeatureColumns.includes(columnToAdd)) {
      setNonFeatureColumns((prev) => [...prev, columnToAdd].sort()); // Add in alphabetical order
      // Logic for showing Step 7 is in useEffect
    }
  };

  // 6.Adım: Görüntülenen etiketten bir non-feature sütunu kaldırma
  const handleRemoveNonFeatureColumn = (columnToRemove) => {
    setNonFeatureColumns((prev) => prev.filter((col) => col !== columnToRemove));
    // Logic for hiding Step 7 is in useEffect (if needed)
  };

  // Show categorical encoding information to user
  const showCategoricalEncodingInfo = (encodingInfo) => {
    setCategoricalEncodingInfo(encodingInfo);
    setShowCategoricalModal(true);
  };

  // Close categorical encoding modal
  const closeCategoricalModal = () => {
    setShowCategoricalModal(false);
    setCategoricalEncodingInfo(null);
  };

  // 7.Adım: Analizi başlatma tetikleyicisi (Run Analysis butonu için)
  const handleStartAnalysis = async () => {
    if (analyzing) return;
    const longRun = isLikelyLongRun();
    const newJobId = generateClientJobId();
    setClientJobId(newJobId);
    if (longRun) {
      setShowLongRunModal(true);
      // Run analysis immediately; user may still opt-in to email in modal
      await handleRunAnalysisWithJob(newJobId);
    } else {
      await handleRunAnalysisWithJob(newJobId);
    }
  };

  const handleRunAnalysisWithJob = async (jobId) => {
    const basePayload = await buildRunPayload();
    return runAnalysisWithPayload({ ...basePayload, clientJobId: jobId });
  };

  const buildRunPayload = async () => {
    return {
      filePath: uploadedInfo.filePath,
      IlnessColumnName: selectedIllnessColumn,
      SampleColumnName: selectedSampleColumn,
      selectedClasses: selectedClasses,
      statisticalTest: selectedAnalyzes.statisticalTest,
      dimensionalityReduction: selectedAnalyzes.dimensionalityReduction,
      classificationAnalysis: selectedAnalyzes.classificationAnalysis,
      modelExplanation: selectedAnalyzes.modelExplanation,
      nonFeatureColumns: nonFeatureColumns,
      isDiffAnalysis: [...selectedAnalyzes.statisticalTest, ...selectedAnalyzes.modelExplanation],
      afterFeatureSelection: afterFeatureSelection,
      useDefaultParams: useDefaultParams,
      featureType: featureType,
      referenceClass: referenceClass,
      limeGlobalExplanationSampleNum: limeGlobalExplanationSampleNum,
      shapModelFinetune: shapModelFinetune,
      limeModelFinetune: limeModelFinetune,
      scoring: scoring,
      featureImportanceFinetune: featureImportanceFinetune,
      numTopFeatures: numTopFeatures,
      plotter: plotter,
      dim: dim,
      paramFinetune: paramFinetune,
      finetuneFraction: finetuneFraction,
      saveBestModel: saveBestModel,
      standardScaling: standardScaling,
      saveDataTransformer: saveDataTransformer,
      saveLabelEncoder: saveLabelEncoder,
      verbose: verbose,
      testSize: testSize,
      nFolds: nFolds
    };
  };

  const runAnalysisWithPayload = async (payload) => {
    // Validate selections
    if (!uploadedInfo?.filePath || !selectedIllnessColumn || !selectedSampleColumn || selectedClasses.length !== 2) {
      setError("Please complete all selections in steps 3 and 4 before running the analysis.");
      setAnalyzing(false);
      return;
    }
    if (selectedAnalyzes.statisticalTest.length === 0 && selectedAnalyzes.dimensionalityReduction.length === 0 && selectedAnalyzes.classificationAnalysis.length === 0) {
      setError("Please select at least one analysis method in step 5.");
      setAnalyzing(false);
      return;
    }
    console.log("Running analysis with payload:", payload);
    setError('');
    setAnalyzing(true);
    try {
      const response = await api.post('/analyze', payload);
      // ... reuse existing handling from handleRunAnalysis ...
      if (response.data.categoricalEncodingInfo) {
        showCategoricalEncodingInfo(response.data.categoricalEncodingInfo);
      }
      if (response.data.success) {
        const newAnalysis = {
          results: response.data.imagePaths || [],
          time: response.data.elapsedTime || "N/A",
          date: new Date().toLocaleString('en-GB'),
          parameters: payload,
          analysisInfo: { ...selectedAnalyzes },
          bestParams: response.data.bestParams || null
        };
        const paths2 = response.data.imagePaths || [];
        const hasAfterFSFolder2 = paths2.some(p => /AfterFeatureSelection/i.test(p));
        const producedFeatureScores2 = paths2.some(p => /(feature_importance|anova|t_test|shap|lime|feature_ranking)/i.test(p));
        if (producedFeatureScores2) setCanUseAfterFS(true);
        if (hasAfterFSFolder2) { setAfterFeatureSelection(true); setCanUseAfterFS(true); }
        setPreviousAnalyses((prev) => [...prev, newAnalysis]);
        setAnalysisInformation((prev) => [...prev, payload]);
        setShowStepOne(false); setShowStepTwo(false); setShowStepThree(false); setShowStepFour(false); setShowStepFive(false); setShowStepSix(false); setShowStepAnalysis(false);
        setTimeout(() => { if (pageRef.current) scrollToStep(pageRef); }, 100);
      } else {
        setError(response.data.message || 'An error occurred during analysis. Please check the server logs.');
      }
    } catch (error) {
      try {
        const raw = String(
          (error && error.response && (error.response.data && (error.response.data.error || error.response.data.message)))
          || error?.message
          || ''
        );
        if (/No best model found/i.test(raw)) {
          setError('No sufficiently performing model was found. The best model\'s F1 score is below the quality threshold, so model explanation was not generated. Consider balancing classes, adding more data, tuning hyperparameters, or adjusting the threshold.');
        } else {
          setError('An error occurred during analysis communication. Please try again.');
        }
      } catch (e) {
        setError('An error occurred during analysis communication. Please try again.');
      }
      console.error('Error analyzing file:', error?.response?.data || error?.message || error);
    } finally {
      setAnalyzing(false);
    }
  };

  // Final Adımı 1: Yeni analiz yapma butonu
  const handlePerformAnotherAnalysis = () => {
    // Clear any previous combine/summarize errors when starting a new analysis
    setCombineError('');
    // Hide current steps (3, 4, 5, 6, 7) and update state for a new analysis block
    // This function does not actually add a new analysis block, just shows previous steps again.
    // If a truly new analysis block is needed, previousAnalyses logic should be changed.
    // For now, just go back to Step 3.
    setAnotherAnalysis((prev) => [...prev, prev.length]); // Only used as index
    console.log("Performing another analysis, resetting to Step 3...");

    // Show/hide steps for new analysis
    setShowStepThree(true);
    setShowStepFour(true);
    setShowStepFive(false);
    setShowStepSix(false);
    setShowStepAnalysis(false);
    
    // Optionally reset previous selections (user may want to continue)
    // Keep classTable intact to avoid re-fetching and reloading the diagnosis distribution chart
    setselectedClasses([]);
    setSelectedAnalyzes({ statisticalTest: [], dimensionalityReduction: [], classificationAnalysis: [], modelExplanation: [] });
    setUseDefaultParams(true);
    // Optionally reset parameters as well.

    // Do not re-fetch classes; reuse existing classTable/classDiagramUrl if dataset & columns are unchanged

    setTimeout(() => {
      const targetRef = stepFourRef.current || stepThreeRef.current;
      if (targetRef) {
        scrollToStep(targetRef);
      }
    }, 200); // Wait a bit for API call and state updates
  };

  // Final Adımı 2: Baştan başlama butonu
  const handleStartOver = () => {
    // Reset the file input safely
    if (fileInputRef.current) {
      fileInputRef.current.value = null;
    }

    // Reset all states to initial values
    setFile(null);
    setLoading(false);
    setAnalyzing(false);
    setProcessing(false);
    setPreviousAnalyses([]);
    setAnalysisInformation([]);
    setAnotherAnalysis([0]);
    setUploadedInfo(null);
    setShowStepOne(true);
    setShowStepTwo(false);
    setShowStepThree(false);
    setShowStepFour(false);
    setShowStepFive(false);
    setShowStepSix(false);
    setShowStepAnalysis(false);
    setClassTable({ class: [] });
    setselectedClasses([]);
    setColumns([]);
    setAllColumns([]);
    setLoadingAllColumns(false);
    setSelectedIllnessColumn('');
    setSelectedSampleColumn('');
    setNonFeatureColumns([]);
    setIsDiffAnalysisClasses([]);
    setSummarizeAnalyses([]);
    setAvailableClassPairs([]);
    setError('');
    setInfo('');
    setDemoMode(false);

    setSelectedAnalyzes({
      statisticalTest: [],
      dimensionalityReduction: [],
      classificationAnalysis: [],
      modelExplanation: []
    });
    
    // Reset parameter states
    setUseDefaultParams(true);    
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
    // Reset upload duration
    setUploadDuration(null);

    // Scroll to top
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // Final Adımı Summarize: İstatistiksel yöntemleri özetle
  const handleSummarizeStatisticalMethods = async (selectedClassPair = null) => {
    // Synchronous guard against rapid double-clicks
    if (summarizeLockRef.current) return;
    summarizeLockRef.current = true;
    if (!uploadedInfo?.filePath) {
        setCombineError("Cannot summarize: File path is missing.");
      summarizeLockRef.current = false;
        return;
    }

    // Client no longer guards by counting runs; rely on server validation
    setCombineError('');

    // If class pair selection is required and not selected, send empty to API (let API decide)
    // If class pair selection modal is open, this function should not be called again (should be disabled)

    setProcessing(true);
    setCombineError('');

    console.log("Summarize request - selectedClassPair:", selectedClassPair, "featureCount:", selectedFeatureCount);

    try {
      // Validate aggregation weights JSON if needed
      if (aggregationMethod === 'weighted_borda' && aggregationWeights && String(aggregationWeights).trim() !== '') {
        try {
          JSON.parse(aggregationWeights);
        } catch (e) {
          setProcessing(false);
            setCombineError('Weights must be valid JSON for weighted_borda, e.g. {"shap":1.5,"anova":1.0}');
          summarizeLockRef.current = false;
          return;
        }
      }

      const response = await api.post('/summarize_statistical_methods', {
        featureCount: selectedFeatureCount,
        filePath: uploadedInfo.filePath,
        selectedClassPair: selectedClassPair,
        // Optional aggregation overrides for combine step
        aggregationMethod: aggregationMethod || undefined,
        aggregationWeights: aggregationWeights || undefined,
        rrfK: typeof rrfK === 'number' ? rrfK : undefined
      });
      
      console.log("Summarize response:", response.data);

      if (response.data.success) {
        // If server requests class pair selection, open modal
        if (response.data.needsSelection && response.data.classPairs && response.data.classPairs.length > 0) {
          console.log("Class pair selection needed, options:", response.data.classPairs);
          setAvailableClassPairs(response.data.classPairs);
          // Since modal is open, processing is not finished, user will select
          setProcessing(false);
          summarizeLockRef.current = false; // release lock so modal buttons work
          return;
        }

        // If no selection is required or result is returned
        if (response.data.imagePath) {
          const imagePath = response.data.imagePath;
          const timestamp = new Date().getTime();

          // Accept either key from backend to be robust
          let determinedClassPair = selectedClassPair || response.data.selectedClassPair || response.data.analyzedClassPair;
          const aggregationLabel = response.data.aggregationLabel || '';
          if (!determinedClassPair) {
            // If selectedClassPair is null and backend did not send analyzedClassPair, try to find the only class pair
            const differentialAnalysisClassPairs = [
              ...new Set(
                previousAnalyses
                  .filter(a => a.parameters && ((a.parameters.statisticalTest && a.parameters.statisticalTest.length > 0) || (a.parameters.modelExplanation && a.parameters.modelExplanation.length > 0)))
                  .map(a => {
                    if (a.parameters.selectedClasses && a.parameters.selectedClasses.length >= 2) {
                      return a.parameters.selectedClasses.join('_');
                    }
                    return null;
                  })
                  .filter(pair => pair !== null)
              )
            ];

            if (differentialAnalysisClassPairs.length === 1) {
              determinedClassPair = differentialAnalysisClassPairs[0];
            }
          }
          // If still no determinedClassPair, keep as "Summary" or show error
          determinedClassPair = determinedClassPair || "Summary";

          const newSummary = {
            classPair: determinedClassPair,
            imagePath: imagePath,
            timestamp: timestamp,
            version: imageVersion + 1,
            featureCount: selectedFeatureCount,
            aggregationLabel: aggregationLabel,
            csvPath: response.data.csvPath || null
          };

          // Keep only the most recent summary for a given class pair.
          // Whenever a new summary is generated for the same class pair (irrespective of the selected feature count),
          // remove the previous one so that only the latest user choice is displayed.
          setSummarizeAnalyses(prev => {
              // Allow multiple summaries per class pair by aggregation label
              const withoutSamePairAndLabel = prev.filter(s => !(s.classPair === newSummary.classPair && (s.aggregationLabel || '') === (newSummary.aggregationLabel || '')));
              return [...withoutSamePairAndLabel, newSummary];
          });

          setImageVersion(prev => prev + 1);
          setAvailableClassPairs([]);
        } else {
          setCombineError(response.data.message || "Summarization successful, but no image path returned.");
        }
      } else {
        console.error("Summarization error response:", response.data);
        setCombineError(response.data.message || 'Failed to summarize statistical methods.');
        setAvailableClassPairs([]);
      }
    } catch (error) {
      console.error("Error in handleSummarizeStatisticalMethods:", error);
      setCombineError(error.response?.data?.message || 'An error occurred while trying to summarize statistical methods.');
      setAvailableClassPairs([]);
    } finally {
      setProcessing(false);
      summarizeLockRef.current = false;
    }
  };

  // Final Adımı Summarize: When a class pair is selected (from modal)
  const handleClassPairSelection = (classPair) => {
    if (summarizeLockRef.current) return; // prevent re-entry during processing
    setAvailableClassPairs([]); // Immediately close modal
    handleSummarizeStatisticalMethods(classPair); // Call again with selected pair
  };

  // Final Adımı Summarize: Close class pair selection modal (X button)
  const handleCloseClassPairModal = () => {
    setAvailableClassPairs([]);
    // If closing modal cancels the process, you may set processing to false here.
    // setProcessing(false);
  };

  const handleOpenUserGuide = () => setShowUserGuide(true);
  const handleCloseUserGuide = () => setShowUserGuide(false);

  // Scroll to the selected step
  useEffect(() => {
    if (showStepAnalysis) {
      scrollToStep(stepAnalysisRef);
    } else if (analyzing) {
      scrollToStep(pageRef);
    }
  }, [showStepThree, showStepFour, showStepFive, selectedIllnessColumn, selectedSampleColumn, selectedClasses, showStepSix, showStepAnalysis, analyzing, scrollToStep]);
  
  // On page load or refresh, close class pair selection modal
  useEffect(() => {
    setAvailableClassPairs([]);
  }, []);

  // Show Step 7 (Run Analysis button): When Step 6 is visible and not analyzing
  useEffect(() => {
    console.log("[Effect Check Step 7 Visibility] showStepSix:", showStepSix, "analyzing:", analyzing);
    const shouldShow = showStepSix && !analyzing;
    if (shouldShow !== showStepAnalysis) {
        console.log(`[Effect Check Step 7 Visibility] Setting showStepAnalysis to ${shouldShow}`);
    }
    setShowStepAnalysis(shouldShow);
    if (shouldShow) {
      setTimeout(() => {
        if (stepAnalysisRef.current) scrollToStep(stepAnalysisRef);
      }, 100);
    }
  }, [showStepSix, analyzing, showStepAnalysis, scrollToStep]);

  // When analysis starts, scroll to top (or log/progress area)
  useEffect(() => {
    if (analyzing) {
      setTimeout(() => {
        if (pageRef.current) scrollToStep(pageRef); 
      }, 100);
    }
  }, [analyzing, scrollToStep]);

  return (
    <div>
      <header className="app-header">
        <div className="app-version" aria-label="Application version">v2.3.0</div>
        <img src={process.env.PUBLIC_URL + "/logo192.png"} alt="Logo" />
        <span>Biomark - Biomarker Analysis Tool</span>
        <button className="user-guide-link" onClick={handleOpenUserGuide}>
          <span>User</span>
          <span>Guide</span>
        </button>
      </header>
      {/* Render User Guide Modal */}
      {showUserGuide && <UserGuideModal onClose={handleCloseUserGuide} />}
      {/* Step 1: Browse file*/}
      {showStepOne && (
      <div className="file-browse-section">
        {/* Step 1 */}
        <div className="step-and-instruction">
          <div className="step-number">1</div>
          <h2 className="title">Choose your file</h2>
        </div>
        <div className="file-input-container">
          <div className="file-selection-row">
            <button className="file-browse-button" onClick={handleBrowseClick}>
              Browse
            </button>
            
            <button 
              className="demo-file-button" 
              onClick={handleDemoFileClick}
              title="Try a sample analysis without uploading your own file"
              disabled={loading}
            >
              {loading && demoMode ? (
                <>
                  <div className="spinner"></div>
                  Loading Demo Dataset...
                </>
              ) : (
                "OR Use a Demo Dataset for Alzheimer's Disease"
              )}
            </button>
            
            <span id="file-name">{file ? truncateFileName(file.name) : 'No file chosen'}</span>
          </div>
          
          <div className="format-instructions-row">
            <button type="button" className="format-instructions-link" onClick={(e) => {
              // No default navigation for button, but keep preventDefault for safety
              e.preventDefault();
              handleOpenFormatPopup();
            }}>
              (Input file format instructions)
            </button>
          </div>
          
          <input
            id="fileInput"
            ref={fileInputRef} // Attach the ref here
            type="file"
            className="file-input-hidden"
            accept=".csv,.tsv,.txt,.xlsx,.gz,.zip"
            onChange={handleFileChange}
          />
        </div>
      </div>
      )}
      
      {/* Step 1: Format popup */}
      {showFormatPopup && <InputFormatPopup onClose={handleCloseFormatPopup} />}
      
      {/* Step 2: Upload file */}
      {showStepTwo && (
      <div className="file-upload-section">
        {/* Step 2 */}
        <div className="step-and-instruction">
          <div className="step-number">2</div>
          <h2 className="title">Upload your file</h2>
        </div>
        
        {/* In demo mode, only show uploaded file info */}
        {uploadedInfo && !loading ? (
          <>
            <div className="uploaded-info">
              Uploaded file: <b>{truncateFileName(uploadedInfo.name)}</b> ({uploadedInfo.size})
            </div>
            {uploadDuration && (
              <div className="upload-duration">Upload time: {uploadDuration}</div>
            )}
          </>
        ) : demoMode ? (
          <>
            {info && (
              <div className="loading-message">
                {loading && <div className="spinner"></div>}
                {info}
              </div>
            )}
            <div className="uploaded-info">
              Using demo dataset: <strong>GSE120584_serum_norm_demo.csv</strong>
            </div>
          </>
        ) : (
          <>
            {info && <div className="loading-message">
              <div className="spinner"></div>
              {info}
            </div>}
            
            <button className="upload-button" onClick={handleUpload}>
              Upload
            </button>
            {uploading && (
            <div className="file-is-loading">
              <div className="spinner"></div>
              File is uploading...
            </div>
            )}
            {uploadedInfo && (
            <>
              <div className="uploaded-info">
                Uploaded file: <b>{truncateFileName(uploadedInfo.name)}</b> ({uploadedInfo.size})
              </div>
              {uploadDuration && (
                <div className="upload-duration">Upload time: {uploadDuration}</div>
              )}
            </>
            )}
            {error && <div className="error-message">{error}</div>}
          </>
        )}
      </div>
      )}

      {/* step 3, step 4, step 5, step 6, step 7 */}
      {anotherAnalysis.map((id, index) => (
        <div key={id}>
          {/* Only show analysis options after the last analysis section */}
          {index === anotherAnalysis.length - 1 && (
            <>
              {/* Step 3: Select Columns using Buttons and Modal */}
              {showStepThree && (
                <div ref={stepThreeRef} className="select-class-section step-three-container">
                <div className="step-and-instruction">
                  <div className="step-number">3</div>
                  <h2 className="title">Select Columns for Patient Groups and Sample IDs {' '}
                    <HelpTooltip text={`${helpTexts.steps.step3.about} ${helpTexts.steps.step3.howTo}`}>info</HelpTooltip>
                  </h2>
                </div>
                
                  <div className="column-selection-area">

                  {/* Patient Group Selection */}
                  <div className="column-select-block">
                    <label>Patient Group Column:</label>
                      <SearchableColumnList
                        initialColumns={firstTenColumns}
                        allColumns={allColumns}
                        onSelect={handleIllnessColumnSelection}
                        selectedColumns={selectedIllnessColumn}
                        placeholder="Search Patient Group column..."
                        listHeight="150px"
                        isLoading={loadingAllColumns}
                        disabled={loadingAllColumns}
                      />
                  </div>

                  {/* Sample ID Selection */}
                  <div className="column-select-block">
                    <label>Sample ID Column:</label>
                        <SearchableColumnList
                          initialColumns={firstTenColumns}
                          allColumns={allColumns}
                          onSelect={handleSampleColumnSelection}
                          selectedColumns={selectedSampleColumn}
                          placeholder="Search Sample ID column..."
                          listHeight="150px"
                          isLoading={loadingAllColumns}
                          disabled={loadingAllColumns}
                        />
                  </div>

                </div>
                  {error && <div className="error-message step-error">{error}</div>}
                  {info && <div className="info-message step-info">{info}</div>}
              </div>
              )}
              {/* Step 4: Get classes names */}
              {showStepFour && !previousAnalyses[index] && (
                <div ref={stepFourRef} className='select-class-section'>
                  <div className="step-and-instruction">
                    <div className="step-number">4</div>
                    <h2 className='title'>Select Two Classes for Comparison</h2>
                  </div>
                </div>
              )}
              {/* Step 4: Class Table */}
              {classTable.class && Array.isArray(classTable.class) && showStepFour && !previousAnalyses[index] && classTable.class.length > 0 && (
                <BarChartWithSelection
                  chartUrl={buildUrl(`/${classTable.classDiagramUrl}`)}
                  classList={classTable.class}
                  onClassSelection={handleClassSelection}
                />
              )}
              
              {/* Step 4: Panel displaying selected classes - shown after the chart */}
              {showStepFour && !previousAnalyses[index] && selectedClasses && selectedClasses.length > 0 && (
                <div className="selected-classes-display">
                  <h3>Selected Classes:</h3>
                  <div className="selected-classes-list">
                    {selectedClasses.map((className, index) => (
                      <div key={index} className="selected-class-item">
                        <span className="selected-class-name">{className}</span>
                        <span className="selected-badge">selected</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {/* Step 5: Select analysis method*/}
              {showStepFive && !previousAnalyses[index] && (
                <div ref={stepFiveRef} className='select-analysis-section'>
                {selectedClasses.length > 0 && (
                  <div className="step-and-instruction">
                    <div className="step-number">5</div>
                    <h1 className='title' style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                      Choose an analysis method
                      <HelpTooltip placement="right" text={helpTexts.steps.step5.about}>info</HelpTooltip>
                    </h1>
                  </div>
                )}
                {selectedClasses.length > 0 && (
                  <AnalysisSelection
                    onAnalysisSelection={handleAnalysisSelection}
                    afterFeatureSelection={afterFeatureSelection}
                    onToggleAfterFS={setAfterFeatureSelection}
                    canUseAfterFS={canUseAfterFS}
                    computedNumTopFeatures={numTopFeatures}
                    onNumTopFeaturesChange={setNumTopFeatures}
                  />
                )}
              </div>
              )}
              {/* Step 6: Choose Non-Feature Columns */}
              {showStepSix && (
                <div ref={stepSixRef} className="step-container step-six-container">
                  <div className="step-and-instruction-step6">
                    <div className="step-number">6</div>
                    <h1 className="title">Exclude Non-Feature Columns (Optional) {' '}
                      <HelpTooltip text={`${helpTexts.steps.step6.about} ${helpTexts.steps.step6.tips}`}>info</HelpTooltip>
                    </h1>
                  </div>
                  
                  <div className="non-feature-selection-area">
                    {info && <div className="info-message-step6">{info}</div>}
                    {/* Display selected columns with remove buttons */}
                    {nonFeatureColumns.length > 0 && (
                      <div className="selected-non-features-container">
                        <span className="selected-label">Excluded Columns:</span>
                        {nonFeatureColumns.map((col, idx) => (
                          <span key={idx} className="non-feature-tag">
                            {truncateFileName(col, 25)}
                            <button
                              className="non-feature-tag-remove"
                              onClick={() => handleRemoveNonFeatureColumn(col)}
                              aria-label={`Remove ${col}`}
                              title={`Remove ${col}`}
                            >
                              &times;
                            </button>
                          </span>
                        ))}
                      </div>
                    )}

                    {/* Column Selection List */}
                    <label style={{ display: 'block', marginBottom: '5px', fontWeight: '500' }}>Select columns to exclude:</label>
                    <SearchableColumnList
                        initialColumns={firstTenColumns}
                        allColumns={allColumns}
                        onSelect={handleAddNonFeatureColumn}
                        selectedColumns={nonFeatureColumns}
                        placeholder="Search columns to exclude..."
                        listHeight="200px"
                        isLoading={loadingAllColumns}
                        disabled={loadingAllColumns || loadingClasses}
                    />
                  </div>
                  {error && <div className="error-message step-error">{error}</div>}
                </div>
              )}
              {/* Step 7: Run Analysis */}
              {showStepAnalysis && (
                <div ref={stepAnalysisRef} className="run-analysis-section" style={{ display: 'flex', justifyContent: 'center' }}>
                  <div style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', whiteSpace: 'nowrap' }}>
                    <button className="run-analysis-button" onClick={handleStartAnalysis}>
                      Run Analysis
                    </button>
                    <span style={{ display: 'inline-flex' }}>
                      <HelpTooltip placement="right" text={helpTexts.steps.run.note}>info</HelpTooltip>
                    </span>
                  </div>
                </div>
              )}
              {analyzing && (
                <div className="analysis-running">
                  <div className="spinner"></div>
                  Analysis is running...
                </div>
              )}
            </>
          )}
          {/* Display previous analysis results */}
          {previousAnalyses[index] && (
            <>
              <div className="show-analysis-results">
                {analysisInformation[index] && (
                  <>
                  {(() => {
                    const sameFileAndClasses = index > 0 && 
                      analysisInformation[index].filePath === analysisInformation[0].filePath && 
                      analysisInformation[index].selectedClasses[0] === analysisInformation[0].selectedClasses[0] && 
                      analysisInformation[index].selectedClasses[1] === analysisInformation[0].selectedClasses[1];
                    
                    return (
                      <>
                      {/* A separate box will now be displayed for each analysis */}
                      <div className="analysis-information" style={{ margin: '0 auto', maxWidth: '800px', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                        <h2 className="analysis-title" style={{ textAlign: 'center' }}>Analysis {index + 1} Details</h2>
                        
                        <div className="execution-time-container" style={{ textAlign: 'center', fontSize: '13px', color: '#555', margin: '5px 0 15px 0' }}>
                          Execution Time: {previousAnalyses[index].time || "N/A"}
                        </div>

                        <div className="analysis-details" style={{ width: '100%' }}>
                          {/* File and class information, only shown in the first analysis or when different files/classes are used */}
                          {!sameFileAndClasses && (
                            <>
                              <div className="analysis-detail">
                                <span className="detail-label">Analyzed File:</span>
                                <span className="detail-value">
                                  {(() => {
                                    const fullName = analysisInformation[index].filePath?.split('/').pop() || 'N/A';
                                    // If the filename contains a UUID prefix (36 chars + underscore), strip it.
                                    const firstUnderscore = fullName.indexOf('_');
                                    return firstUnderscore > 0 ? fullName.substring(firstUnderscore + 1) : fullName;
                                  })()}
                                </span>
                              </div>
                              <div className="analysis-detail">
                                <span className="detail-label">Analyzed Classes:</span>
                                <span className="detail-value">
                                  {analysisInformation[index].selectedClasses?.join(' vs ') || "N/A"}
                                </span>
                              </div>
                            </>
                          )}
                          <div className="analysis-detail">
                            <span className="detail-label">Analysis Method:</span>
                            <span className="detail-value">
                              {/* New logic for displaying analysis methods */}
                              {[
                                analysisInformation[index].statisticalTest?.length > 0 && `Statistical Test: ${analysisInformation[index].statisticalTest.join(', ')}`,
                                analysisInformation[index].dimensionalityReduction?.length > 0 && `Dimensionality Reduction: ${analysisInformation[index].dimensionalityReduction.join(', ')}`,
                                analysisInformation[index].classificationAnalysis?.length > 0 && `Classification: ${analysisInformation[index].classificationAnalysis.join(', ')}`,
                                analysisInformation[index].modelExplanation?.length > 0 && `Explanation: ${analysisInformation[index].modelExplanation.join(', ')}`
                              ].filter(Boolean).join(' | ')}
                            </span>
                          </div>
                          <div className="analysis-detail">
                            <span className="detail-label">Analysis Date:</span>
                            <span className="detail-value">
                              {previousAnalyses[index].date || "Not Available"}
                            </span>
                          </div>
                        </div>
                      </div>
                      </>
                    );
                  })()}
                  </>
                )}

                {/* Parameter Table - shown for each analysis */}
                <div className="parameters-table-container" style={{ width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', margin: '0 auto', maxWidth: '1200px' }}>
                  <h3 className="parameters-table-title">Analysis Parameters</h3>
                  
                  <div className="parameters-table-wrapper" style={{ width: '100%', overflowX: 'auto' }}>
                    <table className="parameters-horizontal-table">
                      <thead>
                        <tr>
                          {/* Common for Statistical & Explanation */}
                          {(analysisInformation[index].statisticalTest?.length > 0 || analysisInformation[index].modelExplanation?.length > 0) && (
                            <><th>Feature Type</th><th>Ref Class</th><th>Scoring</th><th>Top Features</th></>
                          )}

                          {/* Explanation Specific */}
                          {analysisInformation[index].modelExplanation?.includes('SHAP') && <th>SHAP Finetune</th>}
                          {analysisInformation[index].modelExplanation?.includes('LIME') && <><th>LIME Samples</th><th>LIME Finetune</th></>}
                          {analysisInformation[index].modelExplanation?.includes('Permutation-Feature-Importance') && <th>Feat.Imp Finetune</th>}

                          {/* Clustering */}
                          {analysisInformation[index].dimensionalityReduction?.length > 0 && (
                              <><th>Plotter</th><th>Dimension</th></>
                          )}
                          {/* Classification */}
                          {analysisInformation[index].classificationAnalysis?.length > 0 && (
                              <><th>Param Finetune</th><th>Finetune Frac</th><th>Save Model</th><th>Std Scaling</th><th>Save Transformer</th><th>Save Encoder</th><th>Verbose</th></>
                          )}
                          {/* Common */}
                          <th>Test Size</th><th>N Folds</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr>
                          {/* Common for Statistical & Explanation */}
                          {(analysisInformation[index].statisticalTest?.length > 0 || analysisInformation[index].modelExplanation?.length > 0) && (
                            <>
                              <td>{analysisInformation[index].featureType}</td>
                              <td>{analysisInformation[index].referenceClass || "Auto"}</td>
                              <td>{analysisInformation[index].scoring}</td>
                              <td>{analysisInformation[index].numTopFeatures}</td>
                            </>
                          )}

                          {/* Explanation Specific */}
                          {analysisInformation[index].modelExplanation?.includes('SHAP') && 
                            <td className={analysisInformation[index].shapModelFinetune ? "boolean-true" : "boolean-false"}>{String(analysisInformation[index].shapModelFinetune)}</td>
                          }
                          {analysisInformation[index].modelExplanation?.includes('LIME') && 
                            <>
                              <td>{analysisInformation[index].limeGlobalExplanationSampleNum}</td>
                              <td className={analysisInformation[index].limeModelFinetune ? "boolean-true" : "boolean-false"}>{String(analysisInformation[index].limeModelFinetune)}</td>
                            </>
                          }
                          {analysisInformation[index].modelExplanation?.includes('Permutation-Feature-Importance') &&
                            <td className={analysisInformation[index].featureImportanceFinetune ? "boolean-true" : "boolean-false"}>{String(analysisInformation[index].featureImportanceFinetune)}</td>
                          }

                          {/* Clustering */}
                          {analysisInformation[index].dimensionalityReduction?.length > 0 && (
                               <><td>{analysisInformation[index].plotter}</td><td>{analysisInformation[index].dim}</td></>
                          )}
                          {/* Classification */}
                          {analysisInformation[index].classificationAnalysis?.length > 0 && (
                              <>
                                  <td className={analysisInformation[index].paramFinetune ? "boolean-true" : "boolean-false"}>{String(analysisInformation[index].paramFinetune)}</td>
                                  <td>{analysisInformation[index].finetuneFraction}</td>
                                  <td className={analysisInformation[index].saveBestModel ? "boolean-true" : "boolean-false"}>{String(analysisInformation[index].saveBestModel)}</td>
                                  <td className={analysisInformation[index].standardScaling ? "boolean-true" : "boolean-false"}>{String(analysisInformation[index].standardScaling)}</td>
                                  <td className={analysisInformation[index].saveDataTransformer ? "boolean-true" : "boolean-false"}>{String(analysisInformation[index].saveDataTransformer)}</td>
                                  <td className={analysisInformation[index].saveLabelEncoder ? "boolean-true" : "boolean-false"}>{String(analysisInformation[index].saveLabelEncoder)}</td>
                                  <td className={analysisInformation[index].verbose ? "boolean-true" : "boolean-false"}>{String(analysisInformation[index].verbose)}</td>
                              </>
                          )}
                          
                          {/* Common */}
                          <td>{analysisInformation[index].testSize}</td><td>{analysisInformation[index].nFolds}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
              </div>

              {/* Analysis Results - moved below the parameter table */}
              {/* Plots info launcher */}
              <div style={{ width: '100%', display: 'flex', justifyContent: 'center', margin: '8px 0 8px 0' }}>
                <button
                  onClick={() => setPlotGuideOpenByIndex(prev => ({ ...prev, [index]: !prev[index] }))}
                  className="plot-guide-button"
                  style={{
                    padding: '6px 14px', borderRadius: '999px', background: '#eef3fd', color: '#2f4fb5',
                    border: '1px solid #d7e2ff', fontWeight: 700, letterSpacing: '0.2px', cursor: 'pointer',
                    boxShadow: '0 2px 6px rgba(0,0,0,0.06)'
                  }}
                >
                  Plot guide
                </button>
              </div>
              {plotGuideOpenByIndex[index] && (
                <div style={{
                  width: '100%', maxWidth: '980px', margin: '0 auto 12px auto',
                  background: '#ffffff', border: '1px solid #e6e9f2', borderRadius: '10px',
                  boxShadow: '0 6px 18px rgba(0,0,0,0.06)', padding: '14px 16px'
                }}>
                  {/* Classification */}
                  <div style={{ marginBottom: '10px' }}>
                    <div style={{ fontWeight: 700, fontSize: '14px', color: '#2b365a', marginBottom: '6px' }}>Classification</div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px' }}>
                      <HelpTooltip placement="right" text={helpTexts.results.general.classificationTable}>Performance Table</HelpTooltip>
                    </div>
                  </div>
                  {/* Statistical Tests */}
                  <div style={{ marginBottom: '10px' }}>
                    <div style={{ fontWeight: 700, fontSize: '14px', color: '#2b365a', marginBottom: '6px' }}>Statistical Tests</div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px' }}>
                      <HelpTooltip placement="right" text={helpTexts.results.statistical.topbars}>Top-N Features (Bar)</HelpTooltip>
                    </div>
                  </div>
                  {/* Dimensionality Reduction */}
                  <div style={{ marginBottom: '10px' }}>
                    <div style={{ fontWeight: 700, fontSize: '14px', color: '#2b365a', marginBottom: '6px' }}>Dimensionality Reduction</div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px' }}>
                      <HelpTooltip placement="right" text={helpTexts.results.dimReduction.pca}>PCA</HelpTooltip>
                      <HelpTooltip placement="right" text={helpTexts.results.dimReduction.tsne}>t-SNE</HelpTooltip>
                      <HelpTooltip placement="right" text={helpTexts.results.dimReduction.umap}>UMAP</HelpTooltip>
                    </div>
                  </div>
                  {/* Model Explanation */}
                  <div>
                    <div style={{ fontWeight: 700, fontSize: '14px', color: '#2b365a', marginBottom: '6px' }}>Model Explanation</div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px' }}>
                      <HelpTooltip placement="right" text={helpTexts.results.explanation?.shapSummary || 'Each dot is a sample; color shows feature value; left/right moves prediction down/up.'}>SHAP Summary</HelpTooltip>
                      <HelpTooltip placement="right" text={helpTexts.results.explanation?.shapHeatmap || 'Samples vs. features; color encodes SHAP value (impact).'}>SHAP Heatmap</HelpTooltip>
                      <HelpTooltip placement="right" text={helpTexts.results.explanation?.shapWaterfall || 'Base value to final prediction with per-feature pushes (red up, blue down).'}>SHAP Waterfall</HelpTooltip>
                      <HelpTooltip placement="right" text={helpTexts.results.explanation?.shapForce || 'How features push a single prediction higher or lower.'}>SHAP Force</HelpTooltip>
                      <HelpTooltip placement="right" text={helpTexts.results.explanation?.limeLocal || 'Linear explanation for one sample; positive/negative weights show direction/strength.'}>LIME Local</HelpTooltip>
                      <HelpTooltip placement="right" text={helpTexts.results.explanation?.permutationImportance || 'Drop in score when a feature is shuffled; larger drop = more important.'}>Permutation Importance</HelpTooltip>
                    </div>
                  </div>
                </div>
              )}
              <div className="result-block-container" style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', maxWidth: '1200px' }}>
                {previousAnalyses[index]?.bestParams && (
                  <div style={{ width: '100%', margin: '10px 0', textAlign: 'center' }}>
                    <h3>Optimized Hyperparameters (GridSearchCV)</h3>
                    {Object.entries(previousAnalyses[index].bestParams).map(([modelName, paramsObj]) => (
                      <div key={modelName} style={{ margin: '10px auto', maxWidth: '900px' }}>
                        <h4 style={{ margin: '8px 0' }}>{modelName}</h4>
                        <table style={{
                          width: '100%',
                          borderCollapse: 'collapse',
                          background: '#fff',
                          border: '1px solid #e0e0e0'
                        }}>
                          <thead>
                            <tr style={{ background: '#f5f7fb' }}>
                              <th style={{ border: '1px solid #e0e0e0', padding: '6px 8px', textAlign: 'left' }}>Parameter</th>
                              <th style={{ border: '1px solid #e0e0e0', padding: '6px 8px', textAlign: 'left' }}>Value</th>
                            </tr>
                          </thead>
                          <tbody>
                            {Object.entries(paramsObj).map(([pKey, pVal]) => (
                              <tr key={pKey}>
                                <td style={{ border: '1px solid #e0e0e0', padding: '6px 8px' }}>{pKey}</td>
                                <td style={{ border: '1px solid #e0e0e0', padding: '6px 8px' }}>{String(pVal)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ))}
                    {previousAnalyses[index]?.results && previousAnalyses[index].results.length > 0 && (
                      <BestParamsCsvLink firstResultPath={previousAnalyses[index].results[0]} bestParams={previousAnalyses[index]?.bestParams} />
                    )}
                  </div>
                )}
                  {previousAnalyses[index].results
                    .filter(imagePath => {
                      // If an explanation method is selected, filter out the classification performance metric images.
                      if (analysisInformation[index].modelExplanation?.length > 0) {
                        return !imagePath.includes('results.png');
                      }
                      return true; // Otherwise, show all images.
                    })
                    .map((imagePath, imgIndex) => {
                    // Extract file name and add more detailed logging
                    console.log("imagePath: ", imagePath);
                    const rawImageName = imagePath.split('/').pop(); // Get the full file name
                    
                    let imageName = rawImageName
                      .replace(/_/g, ' ') // Replace '_' characters with space
                      .replace('.png', ''); // Remove '.png' extension
                    
                    // Capitalize the first letter of the word "results"
                    imageName = imageName.replace(/\bresults\b/i, 'Results')
                      .replace(/Model Evaluation Results -\s*/i, '')
                      .replace(/Classification Results -\s*/i, '')
                      .replace(/Clustering Results -\s*/i, '')
                      .replace(/Analysis Results -\s*/i, '')
                      .replace(/Performance Results -\s*/i, '')
                      .replace(/Differential Analysis -\s*/i, '')
                      .trim();
                    
                    // More comprehensive control - for graphs after feature selection
                    // Check both in the path and in the file name
                    const isAfterFeatureSelection = 
                      imagePath.includes('AfterFeatureSelection') || 
                      imagePath.includes('afterFeatureSelection');
                    
                    console.log("isAfterFeatureSelection: ", isAfterFeatureSelection);
                    
                    // To find charts of the same analysis type (e.g., PCA)
                    const baseName = rawImageName.replace(/AfterFeatureSelection|afterFeatureSelection/g, '')
                      .replace(/initial_|initial/g, '')
                      .replace(/initial\/|AfterFeatureSelection\//g, '')
                      .trim();
                    
                    // Find all graphs of the same graphic type (e.g., all PCA graphs)
                    const sameTypeGraphs = previousAnalyses[index].results.filter(path => 
                      path.includes(baseName) || path.endsWith(baseName)
                    );
                                        
                    // Advanced logic: decide based on ordering if there are multiple graphs of the same type
                    if (sameTypeGraphs.length > 1) {
                      // Find the index of this graph among all graphs of the same type
                      const currentGraphIndex = sameTypeGraphs.indexOf(imagePath);
                      
                      // According to odd/even ordering:
                      // Typically, the first graph is with all features and the second with selected features
                      if (currentGraphIndex > 0) {
                        // Second or subsequent graph - with selected features
                        const topFeaturesCount = analysisInformation[index]?.numTopFeatures || 20;
                        imageName = `${imageName} (Selected Top-${topFeaturesCount} Features)`;
                      } else {
                        // First graph - with all features
                        imageName = `${imageName} (All Features)`;
                      }
                    } else if (isAfterFeatureSelection) {
                      // Continue with classic method - based on file path
                      const topFeaturesCount = analysisInformation[index]?.numTopFeatures || 20;
                      let cleanedName = imageName
                        .replace('afterFeatureSelection', '')
                        .replace('AfterFeatureSelection', '')
                        .trim();
                      imageName = `${cleanedName} (Selected Top-${topFeaturesCount} Features)`;
                      console.log("Path control applied to Selected Features title:", imageName);
                    } else {
                      // If the graph is single and not in a special case, assume all features
                      imageName = `${imageName} (All Features)`;
                      console.log("Default All Features title applied:", imageName);
                    }

                    // Determine contextual help text by filename
                    const lower = imagePath.toLowerCase();
                    let contextualHelp = null;
                    if (lower.includes('results.png')) {
                      contextualHelp = 'Performance table: Rows indicate Cross-Validation, Train and Test sets; columns show metrics (Accuracy, Precision, Recall, F1, ROC-AUC) and Support (number of samples). Under class imbalance, prioritize Recall/F1 over Accuracy.';
                    } else if (lower.includes('pca')) {
                      contextualHelp = helpTexts.results.dimReduction.pca;
                    } else if (lower.includes('tsne')) {
                      contextualHelp = helpTexts.results.dimReduction.tsne;
                    } else if (lower.includes('umap')) {
                      contextualHelp = helpTexts.results.dimReduction.umap;
                    } else if (lower.includes('heatmap')) {
                      contextualHelp = helpTexts.results.statistical.heatmap;
                    } else if (lower.includes('volcano')) {
                      contextualHelp = helpTexts.results.statistical.volcano;
                    } else if (lower.includes('box') || lower.includes('violin')) {
                      contextualHelp = helpTexts.results.statistical.box;
                    } else if ((lower.includes('top') && lower.includes('feature')) || lower.includes('bar')) {
                      contextualHelp = helpTexts.results.statistical.topbars;
                    }

                    const downloadLinks = buildDownloadLinks(imagePath);
                    return (
                      <div key={`${index}-${imgIndex}`} className="result-block" style={{ margin: '10px', display: 'flex', justifyContent: 'center', position: 'relative' }}>
                        {contextualHelp && (
                          <div style={{ position: 'absolute', top: 6, right: 6 }}>
                            <HelpTooltip text={contextualHelp}>info</HelpTooltip>
                          </div>
                        )}
                        <ImagePopup 
                          imagePath = {buildUrl(`/${imagePath}`)}
                          imageName = {imageName}
                        />
                        {downloadLinks.length > 0 && (
                          <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 10, flexWrap: 'wrap' }}>
                            {downloadLinks
                              .filter((l) => linkExists[l.href] === true)
                              .map((l, i) => (
                                <a key={i} href={l.href} download style={{ padding: '6px 10px', border: '1px solid #d7e2ff', borderRadius: 6, background: '#eef3fd', color: '#2f4fb5', fontWeight: 700 }}>
                                  {l.label}
                                </a>
                              ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

              </div>
              {/* Perform Another Analysis */}
              {index === anotherAnalysis.length - 1 && (          
                <div className="post-analysis-options">
                  {/* "Perform Another Analysis on Your Dataset" button */}
                  <button
                    className="button perform-analysis"
                    onClick={handlePerformAnotherAnalysis}
                  >
                    Perform Another Analysis on Your Dataset
                  </button>
                  {/* OR text centered */}
                  <div className="or-container">
                    <h1 className="or-text">OR</h1>
                  </div>
                  <button className="button start-over" onClick={handleStartOver}>
                    Start Over with a New Dataset
                  </button>
                  {/* Newly added OR delimiter */}
                  <div className="or-container">
                    <h1 className="or-text">OR</h1>
                  </div>
                  <div className="feature-count-selector">
                    <label htmlFor="featureCount">Number of most influential Biomarkers to display: </label>
                    <select 
                      id="featureCount" 
                      value={selectedFeatureCount} 
                      onChange={(e) => setSelectedFeatureCount(Number(e.target.value))}
                      className="feature-count-dropdown"
                    >
                      {[10, 20, 30, 40, 50, 60, 70, 80, 90, 100].map(count => (
                        <option key={count} value={count}>{count}</option>
                      ))}
                    </select>
                  </div>
                  {/* Area added for error messages */}
                  {error && previousAnalyses.length > 0 && !processing && (
                    <div className="error-message" style={{textAlign: 'center', marginBottom: '10px'}}>{error}</div>
                  )}
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
                    <div className="combine-aggregation-controls" style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center' }}>
                      <label style={{ fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                        Aggregation method
                        <HelpTooltip placement="right" text={<AggregationHelpContent />}>info</HelpTooltip>
                      </label>
                      <select value={aggregationMethod} onChange={(e) => setAggregationMethod(e.target.value)}>
                        <option value="rrf">Reciprocal Rank Fusion</option>
                        <option value="rank_product">Rank Product</option>
                        <option value="weighted_borda">Weighted Borda Count</option>
                        <option value="sum">Simple Sum</option>
                      </select>
                      {aggregationMethod === 'weighted_borda' && (
                        <>
                          <label style={{ fontWeight: 600 }}>weights (JSON)</label>
                          <input type="text" value={aggregationWeights} onChange={(e) => setAggregationWeights(e.target.value)} placeholder='{"shap":1.5,"anova":1.0,"t_test":1.0,"lime":1.2}' style={{ minWidth: 280 }} />
                        </>
                      )}
                      {aggregationMethod === 'rrf' && (
                        <>
                          <label style={{ fontWeight: 600 }}>rrf_k</label>
                          <select value={rrfK} onChange={(e) => setRrfK(Number(e.target.value))}>
                            {[20,40,60,80,100,120].map(v => (<option key={v} value={v}>{v}</option>))}
                          </select>
                        </>
                      )}
                    </div>
                    <button 
                      className="button summarize-statistical-methods" 
                      onClick={() => { setCombineError(''); handleSummarizeStatisticalMethods(); }}
                      disabled={processing}
                    >
                      {processing ? 'Processing...' : 'Combine the above biomarker list in to one list'}
                    </button>
                    {combineError && (
                      <div className="error-message" style={{ textAlign: 'center', marginTop: 8 }}>{combineError}</div>
                    )}
                  </div>
                  
                  {/* Class pair selection modal */}
                  {availableClassPairs.length > 0 && (
                    <div className="class-pair-selection-modal">
                      <div className="class-pair-selection-content">
                        <button className="close-modal-button" onClick={handleCloseClassPairModal}>×</button>
                        <h3>Select Class Pair for Summary</h3>
                        <p>Multiple class pairs detected. Please select which one to analyze:</p>
                        <div className="class-pair-list">
                          {availableClassPairs.map(classPair => (
                            <button 
                              key={classPair} 
                              className="button class-pair-button"
                              onClick={() => handleClassPairSelection(classPair)}
                              disabled={processing}
                            >
                              {classPair.split('_').join(' vs ')}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Summarize Analyses */}
                  {summarizeAnalyses.length > 0 && (
                  <div className="summarize-analyses-container">
                    {summarizeAnalyses.map((summary, idx) => (
                      <div key={`${summary.timestamp}-${idx}`} className="summary-analysis-block">
                        <h3 className="class-pair-title">
                            Summary for: {summary.classPair.split('_').join(' vs ')} (Top-{summary.featureCount} Features)
                        </h3>
                        <div className="summary-image-container">
                          <ImagePopup 
                            key={`summary-image-${summary.timestamp}-${summary.version}`}
                            imagePath={buildUrl(`/${summary.imagePath}?t=${summary.timestamp}&v=${summary.version}`)}
                          />
                          {summary.csvPath && (
                            <div style={{ marginTop: 8, textAlign: 'center' }}>
                              <a
                                href={buildUrl(`/${summary.csvPath}?t=${summary.timestamp}&v=${summary.version}`)}
                                download
                                style={{ textDecoration: 'underline' }}
                              >
                                Download CSV used for this heatmap
                              </a>
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                  {/* Analysis Report - always visible */}
                  <AnalysisReport
                    analysisResults={previousAnalyses.map((analysis, idx) => {
                      const analysisParams = analysis.parameters; // Parameters specific to each analysis (payload)

                      const images = analysis.results.map((imagePath, imgIdx) => {
                        const rawImageName = imagePath.split('/').pop();
                        let imageName = rawImageName
                          .replace(/_/g, ' ')
                          .replace('.png', '')
                          .replace(/\bresults\b/i, 'Results')
                          .replace(/Model Evaluation Results -\s*/i, '')
                          .replace(/Classification Results -\s*/i, '')
                          .replace(/Clustering Results -\s*/i, '')
                          .replace(/Analysis Results -\s*/i, '')
                          .replace(/Performance Results -\s*/i, '')
                          .replace(/Differential Analysis -\s*/i, '')
                          .trim();
                        
                        const isAfterFeatureSelection = 
                          imagePath.includes('AfterFeatureSelection') || 
                          imagePath.includes('afterFeatureSelection');
                        
                        if (isAfterFeatureSelection) {
                          // Use numTopFeatures from analysisParams (i.e., the payload of that analysis)
                          const topFeaturesCount = analysisParams?.numTopFeatures || 20;
                          imageName = `${imageName} (Selected Top-${topFeaturesCount} Features)`;
                        } else if (imagePath.includes('initial')) {
                          imageName = `${imageName} (All Features)`;
                        }
                        
                        return {
                          id: `analysis-${idx}-image-${imgIdx}`,
                          path: buildUrl(`/${imagePath}`),
                          caption: imageName
                        };
                      });

                      return {
                        title: `Analysis ${idx + 1}`, // Analysis title
                        images: images, // Images and captions belonging to the analysis
                        classPair: analysisParams.selectedClasses ? analysisParams.selectedClasses.join(' vs ') : 'N/A',
                        date: analysis.date, // Analysis's own date
                        time: analysis.time, // Analysis's own time
                        types: { // Analysis's own types
                          statisticalTest: analysisParams.statisticalTest || [],
                          dimensionalityReduction: analysisParams.dimensionalityReduction || [],
                          classificationAnalysis: analysisParams.classificationAnalysis || [],
                          modelExplanation: analysisParams.modelExplanation || []
                        },
                        parameters: analysisParams // All other parameters that might be needed in the report
                      };
                    })}
                    analysisDate={previousAnalyses[index]?.date || new Date().toLocaleDateString()}
                    executionTime={previousAnalyses[index]?.time}
                    selectedClasses={selectedClasses}
                    selectedIllnessColumn={selectedIllnessColumn}
                    selectedAnalyzes={selectedAnalyzes}
                    featureCount={selectedFeatureCount}
                    selectedClassPair={summarizeAnalyses.length > 0 ? summarizeAnalyses[summarizeAnalyses.length - 1].classPair : null}
                    summaryImagePath={summarizeAnalyses.length > 0 ? summarizeAnalyses[summarizeAnalyses.length - 1].imagePath : null}
                    summarizeAnalyses={summarizeAnalyses.map(analysis => ({
                      classPair: analysis.classPair ? analysis.classPair.split('_').join(' vs ') : 'All Classes',
                      imagePath: buildUrl(`/${analysis.imagePath}?t=${analysis.timestamp}&v=${analysis.version}`)
                    }))}
                    datasetFileName={uploadedInfo?.name || 'Unknown File'}
                  />
                </div>
              )}
            </>
          )}
        </div>
      ))}

      {/* Categorical Encoding Information Modal */}
      {showCategoricalModal && categoricalEncodingInfo && (
        <div className="modal-overlay" onClick={closeCategoricalModal}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Categorical Data Encoding Information</h3>
              <button className="close-button" onClick={closeCategoricalModal}>×</button>
            </div>
            <div className="modal-body">
              <p>The following categorical columns were automatically encoded for analysis:</p>
              {Object.entries(categoricalEncodingInfo).map(([columnName, info]) => (
                <div key={columnName} className="encoding-info">
                  <h4>Column: {columnName}</h4>
                  <p><strong>Encoding Type:</strong> {info.encoding_type}</p>
                  {Array.isArray(info.generated_columns) && info.generated_columns.length > 0 ? (
                    <>
                      <p><strong>Generated One-Hot Columns:</strong></p>
                      <ul>
                        {info.generated_columns.map((col) => (
                          <li key={col}>{col}</li>
                        ))}
                      </ul>
                    </>
                  ) : (
                    info.original_values && info.encoded_values ? (
                      <>
                        <p><strong>Original Values → Encoded Values:</strong></p>
                        <ul>
                          {info.original_values.map((originalValue, index) => (
                            <li key={index}>
                              "{originalValue}" → {info.encoded_values[index]}
                            </li>
                          ))}
                        </ul>
                      </>
                    ) : null
                  )}
                </div>
              ))}
              <div className="encoding-note">
                <p><strong>Note:</strong> This automatic encoding enables statistical and machine learning analyses on categorical data. When One-Hot Encoding is used, each category becomes a separate binary (0/1) feature without imposing any artificial order.</p>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-primary" onClick={closeCategoricalModal}>
                OK, Continue
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Long-run notification modal */}
      {showLongRunModal && (
        <LongRunNotificationModal
          defaultEmail={defaultNotifyEmail}
          onConfirm={handleNotifyConfirm}
          onCancel={() => setShowLongRunModal(false)}
        />
      )}

    </div>
  );
}

export default App;