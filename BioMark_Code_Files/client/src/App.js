import './css/App.css';
import React, { useState, useRef , useEffect, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import BarChartWithSelection from './components/step4_BarChartWithSelection';
import AnalysisSelection from './components/step5_AnalysisSelection';
import ImagePopup from './components/step8-1_ImagePopup'; // Import the component
import InputFormatPopup from './components/step1_InputFormatPopup'; // Import the new popup component
import AnalysisReport from './components/step9_AnalysisReport';
import SearchableColumnList from './components/SearchableColumnList'; // IMPORT THE NEW COMPONENT
import { api, buildUrl, apiFetch } from './api';
import UserGuideModal from './components/UserGuideModal';
import UserMenu from './components/UserMenu';
import HelpTooltip from './components/common/HelpTooltip';
import AggregationHelpContent from './components/common/AggregationHelpContent';
import { helpTexts } from './content/helpTexts';
import LongRunNotificationModal from './components/common/LongRunNotificationModal';
import { buildKeggColumns, KEGG_PREVIEW_LIMIT } from './utils/keggTable';
import { LOGIN_PATH } from './constants/routes';

const ENRICHMENT_OPTIONS = {
  KEGG: {
    analysisType: 'KEGG',
    geneSet: 'KEGG_2021_Human',
    analysisLabel: 'kegg_pathway_analysis',
    analysisDisplayName: 'KEGG Pathway Analysis',
    buttonLabel: 'Perform KEGG Pathway Analysis',
  },
  GO_BP: {
    analysisType: 'GO_BP',
    geneSet: 'GO_Biological_Process_2021',
    analysisLabel: 'go_biological_process',
    analysisDisplayName: 'GO Biological Process Enrichment',
    buttonLabel: 'Perform GO Biological Process Enrichment',
  },
  GO_CC: {
    analysisType: 'GO_CC',
    geneSet: 'GO_Cellular_Component_2021',
    analysisLabel: 'go_cellular_component',
    analysisDisplayName: 'GO Cellular Component Enrichment',
    buttonLabel: 'Perform GO Cellular Component Enrichment',
  },
  GO_MF: {
    analysisType: 'GO_MF',
    geneSet: 'GO_Molecular_Function_2021',
    analysisLabel: 'go_molecular_function',
    analysisDisplayName: 'GO Molecular Function Enrichment',
    buttonLabel: 'Perform GO Molecular Function Enrichment',
  },
};

const ENRICHMENT_ORDER = ['KEGG', 'GO_BP', 'GO_CC', 'GO_MF'];
const VALIDATION_GENE_OPTIONS = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
const DEFAULT_VALIDATION_GENE_LIMIT = VALIDATION_GENE_OPTIONS[0];

const stripBom = (text = '') => text.replace(/^[\uFEFF\u200B]+/, '');

const extractGenesFromCsv = (csvText, limit = DEFAULT_VALIDATION_GENE_LIMIT) => {
  const sanitized = stripBom(csvText || '');
  const lines = sanitized
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length <= 1) {
    return [];
  }

  const delimiter = lines[0].includes(';') ? ';' : ',';
  const cleanCell = (value = '') => value.replace(/^"|"$/g, '').replace(/^'|'$/g, '').trim();

  // The CSV is already sorted by the user's selected aggregation method,
  // so we just extract genes in the order they appear
  const genes = [];
  const seen = new Set();

  for (let i = 1; i < lines.length; i += 1) {
    const parts = lines[i].split(delimiter).map(cleanCell);
    const gene = (parts[0] || '').trim();
    
    if (!gene) {
      continue;
    }
    
    const dedupeKey = gene.toUpperCase();
    if (seen.has(dedupeKey)) {
      continue;
    }
    
    seen.add(dedupeKey);
    genes.push(gene);
    
    if (limit && limit > 0 && genes.length >= limit) {
      break;
    }
  }

  return genes;
};

const parseClassPairFromUrl = (urlString) => {
  if (!urlString) {
    return null;
  }
  try {
    const { pathname } = new URL(urlString);
    const segments = pathname.split('/').filter(Boolean);
    const rankingIndex = segments.indexOf('feature_ranking');
    if (rankingIndex >= 0 && segments[rankingIndex + 1]) {
      return segments[rankingIndex + 1];
    }
    const summaryIndex = segments.indexOf('summaryStatisticalMethods');
    if (summaryIndex >= 0 && segments[summaryIndex + 1] && !['png', 'pdf'].includes(segments[summaryIndex + 1])) {
      return segments[summaryIndex + 1];
    }
  } catch (err) {
    console.warn('Failed to parse class pair from URL:', urlString, err);
  }
  return null;
};

const deriveResultsDirFromUrl = (urlString) => {
  if (!urlString) {
    return null;
  }
  try {
    const { pathname } = new URL(urlString);
    const segments = pathname.split('/').filter(Boolean);
    const resultsIndex = segments.indexOf('results');
    if (resultsIndex >= 0 && segments[resultsIndex + 1]) {
      return `results/${segments[resultsIndex + 1]}`;
    }
  } catch (err) {
    console.warn('Failed to derive results directory from URL:', urlString, err);
  }
  return null;
};

const normalizeAndSortClasses = (classArray = []) => {
  return classArray
    .map((item) => (item == null ? '' : String(item).trim()))
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true }));
};

function App() {
  const navigate = useNavigate();
  
  // Authentication state
  const [token, setToken] = useState(localStorage.getItem('token') || null);
  const [username, setUsername] = useState('');

  // Fetch username on load
  useEffect(() => {
    const fetchUsername = async () => {
      try {
        const token = localStorage.getItem('token');
        if (token) {
          const response = await api.get('/auth/me', {
            headers: { Authorization: `Bearer ${token}` }
          });
          if (response.data.success) {
            setUsername(response.data.user.username || '');
          }
        }
      } catch (err) {
        console.error('Error fetching username:', err);
      }
    };
    fetchUsername();
  }, []);

  // Initialize guest token on first visit
  useEffect(() => {
    const storedToken = localStorage.getItem('token');
    if (!storedToken) {
      // Generate a guest UUID token
      let guestToken;
      if (typeof crypto !== 'undefined' && crypto.randomUUID) {
        guestToken = crypto.randomUUID();
      } else {
        // Fallback
        guestToken = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
      }
      localStorage.setItem('token', guestToken);
      setToken(guestToken);
      console.log('Generated guest token:', guestToken);
    } else {
      setToken(storedToken);
    }
  }, []);

  // Validate JWT tokens on app load (skip guest UUIDs)
  useEffect(() => {
    const validateToken = async () => {
      const storedToken = localStorage.getItem('token');
      if (storedToken && storedToken.includes('.')) { // Only validate JWT tokens, not guest UUIDs
        try {
          await api.get('/auth/me');
          // Token is valid, keep it
        } catch (error) {
          // Token is invalid or expired
          if (error.response?.status === 401) {
            console.log('Token expired or invalid, logging out...');
            localStorage.removeItem('token');
            setToken(null);
          }
        }
      }
    };
    validateToken();
  }, []);

  // Helper function to check if user is a guest (UUID token) vs logged in (JWT token)
  const isGuestUser = () => {
    if (!token) return false;
    // JWT tokens have 3 parts separated by dots (header.payload.signature)
    // UUID tokens are just a single string with hyphens
    return !token.includes('.');
  };

  // Persist token in api interceptors
  useEffect(() => {
    if (token) {
      localStorage.setItem('token', token);
    } else {
      localStorage.removeItem('token');
    }
  }, [token]);

  // These are global variables. Values defined inside functions are not accessible everywhere. These solve that problem.
  // State Variables
  const [file, setFile] = useState(null);
  const [selectedFilePreviews, setSelectedFilePreviews] = useState([]);
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
  const [allColumns, setAllColumns] = useState([]); // Stores columns for current file (step 3)
  const [analysisAllColumns, setAnalysisAllColumns] = useState([]); // Stores columns for merged/analysis file (step 6)
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
  const [enrichmentProcessing, setEnrichmentProcessing] = useState({});
  const [enrichmentAnalyses, setEnrichmentAnalyses] = useState([]);
  const [currentAnalysisId, setCurrentAnalysisId] = useState(null); // Track current analysis ID for pathway analysis
  const [completedEnrichmentTypes, setCompletedEnrichmentTypes] = useState({});
  const [canRunPathwayAnalysis, setCanRunPathwayAnalysis] = useState(false);
  const [validationLoading, setValidationLoading] = useState(false);
  const [validationError, setValidationError] = useState('');
  const [validationResult, setValidationResult] = useState(null);
  const [validationGeneCap, setValidationGeneCap] = useState(DEFAULT_VALIDATION_GENE_LIMIT);
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
  const [aggregationMethod, setAggregationMethod] = useState('sum');
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

  // New state: holds upload results when multiple files are uploaded
  const [uploadedInfos, setUploadedInfos] = useState(null);
  const [activeUploadIndex, setActiveUploadIndex] = useState(0);
  const [uploadContexts, setUploadContexts] = useState({});
  const [mergeInProgress, setMergeInProgress] = useState(false);
  const [mergeCompleted, setMergeCompleted] = useState(false);
  const [mergeMetadata, setMergeMetadata] = useState(null);
  const columnFetchInFlightRef = useRef(new Set());
  const visibleColumnFetchesRef = useRef(0);
  const classCacheRef = useRef(new Map());

  const beginVisibleColumnFetch = useCallback(() => {
    visibleColumnFetchesRef.current += 1;
    setLoadingAllColumns(true);
  }, [setLoadingAllColumns]);

  const endVisibleColumnFetch = useCallback(() => {
    visibleColumnFetchesRef.current = Math.max(0, visibleColumnFetchesRef.current - 1);
    if (visibleColumnFetchesRef.current === 0) {
      setLoadingAllColumns(false);
    }
  }, [setLoadingAllColumns]);

  const resetPostMergeProgress = useCallback(() => {
    setShowStepFour(false);
    setShowStepFive(false);
    setShowStepSix(false);
    setShowStepAnalysis(false);
    setselectedClasses([]);
    classCacheRef.current = new Map();
  }, [classCacheRef]);

  const updateUploadContext = useCallback((filePath, updates) => {
    if (!filePath) return;
    setUploadContexts((prev) => {
      const prevEntry = prev[filePath] || {};
      const baseEntry = {
        columns: [],
        allColumns: [],
        illnessColumn: '',
        sampleColumn: '',
        nonFeatureColumns: [],
        classTable: { class: [] },
        uploadDuration: null,
        includeInMerge: true,
        ...prevEntry
      };
      const nextEntry = typeof updates === 'function'
        ? updates(baseEntry)
        : { ...baseEntry, ...updates };
      return { ...prev, [filePath]: nextEntry };
    });
  }, []);

  const successfulUploads = useMemo(() => {
    if (!Array.isArray(uploadedInfos)) return [];
    return uploadedInfos.filter((info) => info && info.filePath && !info.error);
  }, [uploadedInfos]);

  const includedUploads = useMemo(() => {
    if (successfulUploads.length === 0) return [];
    return successfulUploads.filter((info) => {
      const ctx = uploadContexts[info.filePath];
      return !ctx || ctx.includeInMerge !== false;
    });
  }, [successfulUploads, uploadContexts]);

  const requiresMerge = includedUploads.length >= 2;

  const allFilesHaveSelections = useMemo(() => {
    if (!requiresMerge) return false;
    return includedUploads.every((info) => {
      const ctx = uploadContexts[info.filePath];
      return ctx && ctx.illnessColumn && ctx.sampleColumn;
    });
  }, [requiresMerge, includedUploads, uploadContexts]);

  const chosenColumns = useMemo(() => {
    if (!requiresMerge) return [];
    return includedUploads.map((info) => {
      const ctx = uploadContexts[info.filePath] || {};
      return {
        filePath: info.filePath,
        illnessColumn: ctx.illnessColumn || '',
        sampleColumn: ctx.sampleColumn || ''
      };
    });
  }, [requiresMerge, includedUploads, uploadContexts]);

  const singleIncluded = includedUploads.length === 1;
  const singleIncludedReady = useMemo(() => {
    if (!singleIncluded) return false;
    const sole = includedUploads[0];
    if (!sole) return false;
    const ctx = uploadContexts[sole.filePath];
    return Boolean(ctx && ctx.illnessColumn && ctx.sampleColumn);
  }, [singleIncluded, includedUploads, uploadContexts]);

  const canMerge = ((requiresMerge && allFilesHaveSelections) || singleIncludedReady) && !mergeInProgress;

  const mergeButtonLabel = useMemo(() => {
    if (mergeInProgress) return requiresMerge ? 'Merging...' : 'Preparing...';
    if (mergeCompleted) return requiresMerge ? 'Re-merge Files' : 'Continue';
    return singleIncluded ? 'Continue' : 'Merge Files';
  }, [mergeInProgress, mergeCompleted, requiresMerge, singleIncluded]);

  const hasSuccessfulUpload = useMemo(() => {
    if (Array.isArray(uploadedInfos)) {
      return uploadedInfos.some((info) => info && info.filePath && !info.error);
    }
    return Boolean(uploadedInfo && uploadedInfo.filePath);
  }, [uploadedInfos, uploadedInfo]);

  const classColumnOptions = useMemo(() => {
    const optionSet = new Set();
    if (requiresMerge) {
      includedUploads.forEach((info) => {
        const ctx = uploadContexts[info.filePath];
        if (ctx && ctx.illnessColumn) {
          optionSet.add(ctx.illnessColumn);
        }
      });
    }
    if (uploadedInfo?.filePath) {
      const currentCtx = uploadContexts[uploadedInfo.filePath];
      if (currentCtx?.illnessColumn) {
        optionSet.add(currentCtx.illnessColumn);
      }
    }
    if (selectedIllnessColumn) {
      optionSet.add(selectedIllnessColumn);
    }
    return Array.from(optionSet).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true }));
  }, [requiresMerge, includedUploads, uploadContexts, selectedIllnessColumn, uploadedInfo?.filePath]);

  const analysisFilePath = useMemo(() => {
    if (mergeMetadata?.filePath) {
      return mergeMetadata.filePath;
    }
    return uploadedInfo?.filePath || null;
  }, [mergeMetadata?.filePath, uploadedInfo?.filePath]);

  const activeUploadContext = useMemo(() => {
    if (!uploadedInfo?.filePath) return null;
    return uploadContexts[uploadedInfo.filePath] || null;
  }, [uploadedInfo?.filePath, uploadContexts]);

  const analysisUploadContext = useMemo(() => {
    if (!analysisFilePath) return null;
    return uploadContexts[analysisFilePath] || null;
  }, [analysisFilePath, uploadContexts]);

  const datasetNamesForReport = useMemo(() => {
    if (mergeMetadata?.name) {
      return [mergeMetadata.name];
    }
    const includedNames = includedUploads
      .map((info) => info?.name)
      .filter((name) => typeof name === 'string' && name.trim().length > 0);
    if (includedNames.length > 0) {
      return includedNames;
    }
    if (uploadedInfo?.name) {
      return [uploadedInfo.name];
    }
    return [];
  }, [mergeMetadata?.name, includedUploads, uploadedInfo?.name]);

  const remainingEnrichmentOptions = useMemo(
    () => ENRICHMENT_ORDER.filter((key) => !completedEnrichmentTypes[key]),
    [completedEnrichmentTypes]
  );
   // Memoize the first 10 columns for the current file (Step 3)
   const firstTenColumns = useMemo(() => {
    if (allColumns.length > 0 && columns.length === 0) {
        return allColumns.slice(0, 10);
    }
    return columns.slice(0, 10);
   }, [columns, allColumns]);

   // First 10 columns for the analysis/merged file (Step 6)
   const analysisFirstTenColumns = useMemo(() => {
    if (analysisAllColumns.length > 0) {
      return analysisAllColumns.slice(0, 10);
    }
    if (analysisUploadContext?.columns?.length) {
      return analysisUploadContext.columns.slice(0, 10);
    }
    return [];
   }, [analysisAllColumns, analysisUploadContext?.columns]);

  // Load last used email from localStorage
  useEffect(() => {
    try {
      const saved = localStorage.getItem('notifyEmail');
      if (saved) setDefaultNotifyEmail(saved);
    } catch (e) {}
  }, []);

  useEffect(() => {
    if (requiresMerge) {
      setMergeCompleted(false);
      setMergeMetadata(null);
    }
  }, [requiresMerge]);

  useEffect(() => {
    setValidationError('');
    setValidationResult(null);
  }, [summarizeAnalyses]);

  useEffect(() => {
    if (!uploadedInfo?.filePath) {
      setColumns([]);
      setAllColumns([]);
      setSelectedSampleColumn('');
      setNonFeatureColumns([]);
      setUploadDuration(null);
      if (analysisFilePath === null) {
        setSelectedIllnessColumn('');
        setClassTable({ class: [] });
      }
      return;
    }

    if (!activeUploadContext) {
      setColumns([]);
      setAllColumns([]);
      setSelectedSampleColumn('');
      setNonFeatureColumns([]);
      setUploadDuration(null);
      if (analysisFilePath === uploadedInfo.filePath || analysisFilePath === null) {
        setSelectedIllnessColumn('');
        setClassTable({ class: [] });
      }
      return;
    }

    setColumns(activeUploadContext.columns || []);
    setAllColumns(activeUploadContext.allColumns || []);
    setNonFeatureColumns(activeUploadContext.nonFeatureColumns || []);
    setUploadDuration(activeUploadContext.uploadDuration || null);

    if (analysisFilePath === uploadedInfo.filePath || !requiresMerge) {
      setSelectedIllnessColumn(activeUploadContext.illnessColumn || '');
      setSelectedSampleColumn(activeUploadContext.sampleColumn || '');
      setClassTable(activeUploadContext.classTable || { class: [] });
    }
  }, [uploadedInfo?.filePath, activeUploadContext, analysisFilePath, requiresMerge]);

  // Keep analysis (merged) column list in sync for Step 6
  useEffect(() => {
    if (!analysisUploadContext) {
      setAnalysisAllColumns([]);
      return;
    }
    const candidateColumns = analysisUploadContext.allColumns?.length
      ? analysisUploadContext.allColumns
      : analysisUploadContext.columns || [];
    setAnalysisAllColumns(candidateColumns);
  }, [analysisUploadContext]);

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
    const sizeLabel = mergeMetadata?.size || uploadedInfo?.size;
    const fileSizeMB = parseFileSizeMB(sizeLabel);
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
  const fetchAllColumnsGeneric = useCallback(async (filePath, options = {}) => { // filePath should be passed as a parameter
    const { suppressError = false } = options;
    if (!filePath) {
      console.error("File path is not available for fetching all columns.");
      return [];
    }
    console.log("Fetching all columns for file:", filePath);
    try {
      const response = await api.post('/get_all_columns', {
        filePath: filePath // Use the filePath passed as a parameter
      });
      if (response.data.success) {
        return response.data.columns;
      } else {
        console.error('Error fetching all columns:', response.data.message);
        if (!suppressError) {
          setError('Failed to fetch all columns in background.'); // Update error message
        }
        return [];
      }
    } catch (error) {
      console.error('Error fetching all columns:', error);
      if (!suppressError) {
        setError('An error occurred while fetching all columns in background.'); // Update error message
      }
      return [];
    }
  }, [setError]);

  // Function to fetch all columns in the background
  const fetchAllColumnsInBackground = useCallback(async (filePath, options = {}) => {
    const { silent = false } = options;
    if (!filePath) return;

    const existing = uploadContexts[filePath]?.allColumns;
    if (Array.isArray(existing) && existing.length > 0) {
      if (!silent && uploadedInfo?.filePath === filePath) {
        setAllColumns(existing);
      }
      if (analysisFilePath === filePath) {
        setAnalysisAllColumns(existing);
      }
      return;
    }

    if (columnFetchInFlightRef.current.has(filePath)) {
      return;
    }

    columnFetchInFlightRef.current.add(filePath);
    if (!silent) {
      beginVisibleColumnFetch();
      setError('');
    }

    try {
      const fetchedColumns = await fetchAllColumnsGeneric(filePath, { suppressError: silent });
      updateUploadContext(filePath, (prev) => ({ ...prev, allColumns: fetchedColumns }));
      if (uploadedInfo?.filePath === filePath) {
        setAllColumns(fetchedColumns);
      }
      if (analysisFilePath === filePath) {
        setAnalysisAllColumns(fetchedColumns);
      }
      console.log("Fetched all columns in background:", fetchedColumns.length);
    } finally {
      if (!silent) {
        endVisibleColumnFetch();
      }
      columnFetchInFlightRef.current.delete(filePath);
    }
  }, [uploadContexts, uploadedInfo?.filePath, fetchAllColumnsGeneric, updateUploadContext, beginVisibleColumnFetch, endVisibleColumnFetch, setError, analysisFilePath]);

  useEffect(() => {
    if (!Array.isArray(uploadedInfos) || uploadedInfos.length === 0) return;
    
    // Prevent infinite retry loop - only fetch once per file
    const fetchedFiles = new Set();
    
    uploadedInfos.forEach((infoItem) => {
      if (!infoItem?.filePath) return;
      if (fetchedFiles.has(infoItem.filePath)) return;
      
      fetchedFiles.add(infoItem.filePath);
      const isActive = uploadedInfo?.filePath === infoItem.filePath;
      fetchAllColumnsInBackground(infoItem.filePath, { silent: !isActive });
    });
  }, [uploadedInfos, uploadedInfo?.filePath, fetchAllColumnsInBackground]);

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
    setSelectedFilePreviews([]);
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
    setSelectedFilePreviews(["GSE120584_serum_norm_demo.csv"]);
    setError(''); // Clear errors
    setAllColumns([]); // Clear previous all columns
    setUploadedInfos(null);
    setActiveUploadIndex(0);
    setUploadContexts({});
    setActiveUploadIndex(0);
    setUploadContexts({});
    
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
        updateUploadContext(demoFilePath, (prev) => ({
          ...prev,
          columns: response.data.columns || [],
          allColumns: response.data.columns || prev.allColumns,
          uploadDuration: `${((performance.now() - startTime) / 1000).toFixed(2)} s`
        }));
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
    setDemoMode(false);
    const filesArray = Array.from(e.target.files || []);
    setSelectedFilePreviews(filesArray.map((f) => f.name));
    const selectedFile = filesArray[0];
    if (selectedFile) {
      setFile(selectedFile);
      setError('');
      setShowStepTwo(true);
      setUploadedInfo(null);
      setColumns([]);
      setAllColumns([]);
      setShowStepThree(false); // Hide Step 3 since not uploaded yet
      setUploadedInfos(null); // Reset multi-upload state
      setUploadDuration(null); // Clear previous upload duration
      setActiveUploadIndex(0);
      setUploadContexts({});
      classCacheRef.current = new Map();
      setClassTable({ class: [] });
      setSelectedIllnessColumn('');
      setSelectedSampleColumn('');
      setNonFeatureColumns([]);
      setShowStepFour(false);
      setShowStepFive(false);
      setShowStepSix(false);
      setShowStepAnalysis(false);
      setselectedClasses([]);
    } else {
      setFile(null);
      setShowStepTwo(false);
    }
  };

  // Step 2: Handles actions when the Upload button is clicked
  const handleUpload = async () => {
    if (demoMode) {
      handleDemoFileClick();
      return;
    }

    setUploadDuration(null); // Reset previous duration before new upload attempt

    const selectedFiles = fileInputRef.current?.files;
    if (selectedFiles && selectedFiles.length > 1) {
      setUploading(true);
      setLoading(true);
      setError('');
      setAllColumns([]); // reset previous
      setUploadedInfos(null);
      setUploadedInfo(null);
      setColumns([]);
      setActiveUploadIndex(0);
      setUploadContexts({});
      classCacheRef.current = new Map();
      setClassTable({ class: [] });
      setSelectedIllnessColumn('');
      setSelectedSampleColumn('');
      setNonFeatureColumns([]);
      setShowStepFour(false);
      setShowStepFive(false);
      setShowStepSix(false);
      setShowStepAnalysis(false);
      setselectedClasses([]);

      const results = [];
      try {
        for (let i = 0; i < selectedFiles.length; i++) {
          const f = selectedFiles[i];
          const formData = new FormData();
          formData.append('file', f);
          const start = performance.now();

          try {
            const res = await api.post('/upload', formData);
            const durationLabel = `${((performance.now() - start) / 1000).toFixed(2)} s`;
            if (res.data && res.data.success && res.data.filePath) {
              results.push({
                name: f.name,
                size: (f.size / 1024 / 1024).toFixed(2) + ' MB',
                filePath: res.data.filePath,
                columns: res.data.columns || [],
                duration: durationLabel
              });
            } else {
              results.push({
                name: f.name,
                size: (f.size / 1024 / 1024).toFixed(2) + ' MB',
                error: res.data?.message || 'Upload failed',
                duration: durationLabel
              });
            }
          } catch (err) {
            const durationLabel = `${((performance.now() - start) / 1000).toFixed(2)} s`;
            console.error('Upload failed for file', f.name, err);
            results.push({
              name: f.name,
              size: (f.size / 1024 / 1024).toFixed(2) + ' MB',
              error: err.message || 'Upload error',
              duration: durationLabel
            });
          }
        }

        setUploadedInfos(results);

        const successfulEntries = results.filter(r => r.filePath);
        successfulEntries.forEach((entry) => {
          updateUploadContext(entry.filePath, (prev) => ({
            ...prev,
            columns: entry.columns || prev.columns,
            uploadDuration: entry.duration || prev.uploadDuration
          }));
        });

        const firstSuccessIndex = results.findIndex(r => r.filePath);
        if (firstSuccessIndex !== -1) {
          const firstSuccess = results[firstSuccessIndex];
          setActiveUploadIndex(firstSuccessIndex);
          setUploadedInfo({
            name: firstSuccess.name,
            size: firstSuccess.size,
            filePath: firstSuccess.filePath
          });
          setShowStepThree(true);
          fetchAllColumnsInBackground(firstSuccess.filePath);
          successfulEntries
            .filter((entry) => entry.filePath && entry.filePath !== firstSuccess.filePath)
            .forEach((entry) => {
              fetchAllColumnsInBackground(entry.filePath, { silent: true });
            });
        } else {
          setError('None of the files could be uploaded. See console for details.');
          setShowStepThree(false);
          setUploadedInfo(null);
          setColumns([]);
        }
      } finally {
        setUploading(false);
        setLoading(false);
        setInfo('');
      }

      // Do not continue to single-file upload logic
      return;
    }

    setUploadedInfos(null);
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
  setColumns([]);
  classCacheRef.current = new Map();

  let uploadedFilePath = null;
  const formData = new FormData();
  formData.append('file', file);

    try {
      // First, upload the file to /upload endpoint and get the first columns
      const response = await api.post('/upload', formData);
      console.log("Upload response:", response.data);

      if (response.data.success && response.data.filePath) {
        uploadedFilePath = response.data.filePath;
        // Save the first columns to state
        setColumns(response.data.columns || []);
        setUploadedInfo({
          name: file.name,
          size: (file.size / 1024 / 1024).toFixed(2) + ' MB',
          filePath: uploadedFilePath,
        });
        updateUploadContext(uploadedFilePath, (prev) => ({
          ...prev,
          columns: response.data.columns || prev.columns
        }));
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
      const durationLabel = `${durationSeconds} s`;
      setUploadDuration(durationLabel);
      if (uploadedFilePath) {
        updateUploadContext(uploadedFilePath, (prev) => ({
          ...prev,
          uploadDuration: durationLabel
        }));
      }
      setLoading(false);
      setUploading(false);
      setInfo('');
    }
  };

  // Step 3: Select the disease column
  const handleIllnessColumnSelection = async (illnessColumn, options = {}) => {
    console.log("handleIllnessColumnSelection called with:", illnessColumn);
    setError('');
    const {
      skipSampleReset = false,
      sampleValue,
      skipMergeGuard = false,
      overrideFilePath,
      forceFetch = false,
      allowStepFour = false
    } = options;

    const activeFilePath = overrideFilePath || uploadedInfo?.filePath;
    if (!skipMergeGuard && requiresMerge && (!mergeMetadata || (activeFilePath && mergeMetadata.filePath !== activeFilePath))) {
      setMergeCompleted(false);
      setMergeMetadata(null);
      resetPostMergeProgress();
    }

    const normalizedIllness = illnessColumn || '';
    setSelectedIllnessColumn(normalizedIllness);
    updateUploadContext(activeFilePath, (prev) => ({
      ...prev,
      illnessColumn: normalizedIllness
    }));

    const sampleForComparison = sampleValue !== undefined ? sampleValue : selectedSampleColumn;

    // Auto-advance if no merge is required and both columns are selected
    if (!skipMergeGuard && !requiresMerge && normalizedIllness && sampleForComparison && !mergeCompleted && !mergeInProgress) {
      await handleMergeFiles();
    }

    const includedCount = includedUploads.length;
    const canAdvanceToStepFour = (candidateSample) => {
      if (!normalizedIllness || !candidateSample) return false;
      if (allowStepFour) return true;
      if (requiresMerge) return mergeCompleted;
      return includedCount > 1 ? mergeCompleted : mergeCompleted && includedCount === 1;
    };
    if (!skipSampleReset && normalizedIllness && normalizedIllness === sampleForComparison) {
      setSelectedSampleColumn(''); // Reset Sample ID if same as illness column
      setInfo("Patient Group and Sample ID columns cannot be the same. Sample ID selection reset.");
      setTimeout(() => setInfo(''), 3000);
      updateUploadContext(activeFilePath, (prev) => ({
        ...prev,
        sampleColumn: ''
      }));
    }

    setselectedClasses([]); // Reset selected classes whenever the column changes

    if (normalizedIllness && activeFilePath) {
      setNonFeatureColumns((prev) => {
        if (!prev.includes(normalizedIllness)) return prev;
        const updated = prev.filter((col) => col !== normalizedIllness);
        updateUploadContext(activeFilePath, (entry) => ({
          ...entry,
          nonFeatureColumns: updated
        }));
        return updated;
      });
    }

    const cacheKey = activeFilePath && normalizedIllness
      ? `${activeFilePath}::${normalizedIllness}`
      : null;

    if (cacheKey && classCacheRef.current.has(cacheKey)) {
      const cached = classCacheRef.current.get(cacheKey);
      setClassTable(cached);
      updateUploadContext(activeFilePath, (prev) => ({
        ...prev,
        classTable: cached
      }));
      if (canAdvanceToStepFour(sampleForComparison)) {
        setShowStepFour(true);
        setTimeout(() => {
          if (stepFourRef.current) scrollToStep(stepFourRef);
        }, 100);
      }
      return;
    }

    const isMergedPath = Boolean(mergeMetadata?.filePath) && mergeMetadata.filePath === activeFilePath;

    const shouldDeferFetch =
      !forceFetch &&
      !skipMergeGuard &&
      requiresMerge &&
      (!mergeCompleted || !isMergedPath);

    if (shouldDeferFetch) {
      setClassTable({ class: [] });
      return;
    }

    if (!activeFilePath || !normalizedIllness) {
      setError("Cannot fetch classes: Uploaded file information is missing.");
      setClassTable({ class: [] });
      return;
    }

    setClassTable({ class: [] });

    try {
      setLoadingClasses(true); // Loading state while fetching classes
      const response = await api.post('/get_classes', {
        filePath: activeFilePath,
        columnName: normalizedIllness
      });
      console.log("Get classes response: ", response.data);
      if (response.data.success && response.data.classList_) {
        // Safely parse JSON
        let classes = [];
        let diagramUrl = '';
        let parseFailed = false;
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
          parseFailed = true;
        }

        const classPayload = {
          class: classes,
          classDiagramUrl: diagramUrl
        };
        if (cacheKey && !parseFailed) {
          classCacheRef.current.set(cacheKey, classPayload);
        }

        setClassTable(classPayload);
        updateUploadContext(activeFilePath, (prev) => ({
          ...prev,
          classTable: classPayload
        }));
        if (canAdvanceToStepFour(sampleForComparison)) {
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
  };

  const handleSampleColumnSelection = async (sampleColumn, options = {}) => {
    console.log("handleSampleColumnSelection called with:", sampleColumn);
    setError('');
    const {
      skipIllnessCheck = false,
      illnessValue,
      skipMergeGuard = false,
      overrideFilePath,
      allowStepFour = false
    } = options;
    const illnessForComparison = illnessValue !== undefined ? illnessValue : selectedIllnessColumn;
    const activeFilePath = overrideFilePath || uploadedInfo?.filePath;
    if (!skipMergeGuard && requiresMerge && (!mergeMetadata || (activeFilePath && mergeMetadata.filePath !== activeFilePath))) {
      setMergeCompleted(false);
      setMergeMetadata(null);
      resetPostMergeProgress();
    }
    if (!skipIllnessCheck && sampleColumn === illnessForComparison) {
      setError("Sample ID and Patient Group columns cannot be the same.");
      updateUploadContext(activeFilePath, (prev) => ({
        ...prev,
        sampleColumn: prev.sampleColumn
      }));
      return;
    }
    setSelectedSampleColumn(sampleColumn);
    updateUploadContext(activeFilePath, (prev) => ({
      ...prev,
      sampleColumn
    }));

    // Auto-advance if no merge is required and both columns are selected
    if (!skipMergeGuard && !requiresMerge && sampleColumn && illnessForComparison && !mergeCompleted && !mergeInProgress) {
      handleMergeFiles();
    }

    const includedCount = includedUploads.length;
    const canAdvanceToStepFour = () => {
      if (!illnessForComparison || !sampleColumn) return false;
      if (allowStepFour) return true;
      if (requiresMerge) return mergeCompleted;
      return includedCount > 1 ? mergeCompleted : mergeCompleted && includedCount === 1;
    };

    if (canAdvanceToStepFour()) {
      setShowStepFour(true);
      setTimeout(() => {
        if (stepFourRef.current) scrollToStep(stepFourRef);
      }, 100);
    }
  };

  const handleToggleFileInclusion = (filePath, include) => {
    if (!filePath) return;
    const currentValue = uploadContexts[filePath]?.includeInMerge;
    if (currentValue === include) return;
    updateUploadContext(filePath, (prev) => ({
      ...prev,
      includeInMerge: include
    }));
    if (!include && uploadedInfo?.filePath === filePath) {
      const fallbackIndex = Array.isArray(uploadedInfos)
        ? uploadedInfos.findIndex((info) => {
            if (!info || !info.filePath || info.filePath === filePath) return false;
            const ctx = uploadContexts[info.filePath];
            return !ctx || ctx.includeInMerge !== false;
          })
        : -1;
      if (fallbackIndex >= 0) {
        handleUploadedFileSelection(fallbackIndex);
      }
    }
    setMergeCompleted(false);
    setMergeMetadata(null);
    resetPostMergeProgress();
  };

  const handleUploadedFileSelection = (index) => {
    if (!Array.isArray(uploadedInfos)) return;
    const targetInfo = uploadedInfos[index];
    if (!targetInfo || !targetInfo.filePath || targetInfo.error) return;
    const isSameSelection = index === activeUploadIndex && uploadedInfo?.filePath === targetInfo.filePath;
    if (isSameSelection) return;
    if (requiresMerge && (!mergeMetadata || targetInfo.filePath !== mergeMetadata.filePath)) {
      setMergeCompleted(false);
      setMergeMetadata(null);
      resetPostMergeProgress();
    }
    setActiveUploadIndex(index);
    setUploadedInfo({
      name: targetInfo.name,
      size: targetInfo.size,
      filePath: targetInfo.filePath
    });
    updateUploadContext(targetInfo.filePath, (prev) => ({
      ...prev,
      columns: targetInfo.columns || prev.columns,
      uploadDuration: targetInfo.duration || prev.uploadDuration
    }));
    setShowStepFour(false);
    setShowStepFive(false);
    setShowStepSix(false);
    setShowStepAnalysis(false);
    setselectedClasses([]);
    setClassTable({ class: [] });
    setError('');
    setInfo('');
    fetchAllColumnsInBackground(targetInfo.filePath);
  };

  const handleMergeFiles = async () => {
    if (!canMerge) return;
    if (!requiresMerge) {
      const soloUpload = includedUploads[0];
      if (soloUpload?.filePath) {
        resetPostMergeProgress();
        setMergeInProgress(true);
        setError('');
        setInfo('Preparing dataset...');

        const soloContext = uploadContexts[soloUpload.filePath] || {};
        const illnessColumn = soloContext.illnessColumn || '';
        const sampleColumn = soloContext.sampleColumn || '';

        try {
          if (illnessColumn) {
            await handleIllnessColumnSelection(illnessColumn, {
              skipMergeGuard: true,
              sampleValue: sampleColumn,
              skipSampleReset: true,
              overrideFilePath: soloUpload.filePath,
              allowStepFour: true
            });
          } else {
            setSelectedIllnessColumn('');
            setClassTable({ class: [] });
          }

          if (sampleColumn) {
            await handleSampleColumnSelection(sampleColumn, {
              skipIllnessCheck: true,
              illnessValue: illnessColumn,
              skipMergeGuard: true,
              overrideFilePath: soloUpload.filePath,
              allowStepFour: true
            });
          } else {
            setSelectedSampleColumn('');
          }

          setUploadedInfo({
            name: soloUpload.name,
            size: soloUpload.size,
            filePath: soloUpload.filePath
          });
          setActiveUploadIndex(uploadedInfos?.findIndex((info) => info?.filePath === soloUpload.filePath) ?? 0);
          setMergeMetadata({
            filePath: soloUpload.filePath,
            name: soloUpload.name,
            size: soloUpload.size || 'N/A'
          });
          setMergeCompleted(true);
        } finally {
          setTimeout(() => setInfo(''), 300);
          setMergeInProgress(false);
        }
      } else {
        setMergeInProgress(false);
      }
      return;
    }
    const primaryColumns = chosenColumns[0] || {};
    const fallbackIllnessColumn = selectedIllnessColumn || primaryColumns.illnessColumn || '';
    const fallbackSampleColumn = selectedSampleColumn || primaryColumns.sampleColumn || '';
    setMergeInProgress(true);
    setError('');
    resetPostMergeProgress();
    try {
      const response = await api.post('/merge-files', { chosenColumns });
      const data = response.data || {};
      if (data.success && data.mergedFilePath) {
        const prettySize = typeof data.size === 'number'
          ? `${(data.size / (1024 * 1024)).toFixed(2)} MB`
          : 'N/A';
        const mergedName = data.mergedFileName || 'Merged Dataset';
        const mergedPath = data.mergedFilePath;
        classCacheRef.current = new Map();
        updateUploadContext(mergedPath, (prev) => ({
          ...prev,
          columns: data.columns || prev.columns,
          allColumns: data.columns || prev.allColumns,
          illnessColumn: fallbackIllnessColumn,
          sampleColumn: fallbackSampleColumn,
          nonFeatureColumns: nonFeatureColumns,
          uploadDuration: null
        }));
        if (fallbackIllnessColumn) {
          setSelectedIllnessColumn(fallbackIllnessColumn);
          await handleIllnessColumnSelection(fallbackIllnessColumn, {
            skipSampleReset: true,
            sampleValue: fallbackSampleColumn,
            skipMergeGuard: true,
            overrideFilePath: mergedPath
          });
        } else {
          setClassTable({ class: [] });
        }
        if (fallbackSampleColumn) {
          setSelectedSampleColumn(fallbackSampleColumn);
          await handleSampleColumnSelection(fallbackSampleColumn, {
            skipIllnessCheck: true,
            illnessValue: fallbackIllnessColumn,
            skipMergeGuard: true,
            overrideFilePath: mergedPath
          });
        }
        setMergeCompleted(true);
        setMergeMetadata({ filePath: mergedPath, name: mergedName, size: prettySize });
        // setInfo('Files merged successfully. You can continue to Step 4.');
      } else {
        const message = data.error || 'Merge failed. Please ensure all selections are valid.';
        setMergeCompleted(false);
        setMergeMetadata(null);
        setError(message);
      }
    } catch (err) {
      const message = err.response?.data?.error || err.message || 'Failed to merge files. Please try again.';
      setMergeCompleted(false);
      setMergeMetadata(null);
      setError(message);
    } finally {
      setMergeInProgress(false);
      setTimeout(() => setInfo(''), 4000);
    }
  };

  const handleClassColumnChange = (event) => {
    const nextColumn = event?.target?.value;
    if (!nextColumn || nextColumn === selectedIllnessColumn) {
      return;
    }
    if (!analysisFilePath) {
      return;
    }
    setselectedClasses([]);
    setShowStepFive(false);
    setShowStepSix(false);
    setShowStepAnalysis(false);
    handleIllnessColumnSelection(nextColumn, {
      skipMergeGuard: true,
      overrideFilePath: analysisFilePath
    });
  };

  // Show Step 4: When both columns (Illness & Sample) are selected
  useEffect(() => {
    const hasColumns = Boolean(selectedIllnessColumn && selectedSampleColumn);
    const requiresAction = requiresMerge || (singleIncluded && !mergeCompleted);
    const readyForStepFour = hasColumns && (!requiresAction || mergeCompleted);
    if (readyForStepFour) {
      if (!showStepFour) {
        console.log("[Effect Check Step 4 Visibility] Enabling Step 4 after merge requirement satisfied.");
      }
      setShowStepFour(true);
      setTimeout(() => {
        if (stepFourRef.current) scrollToStep(stepFourRef);
      }, 100);
    } else {
      if (showStepFour) {
        console.log("[Effect Check Step 4 Visibility] Hiding Step 4 (waiting for merge or selections).");
      }
      setShowStepFour(false);
      setShowStepFive(false);
      setShowStepSix(false);
      setShowStepAnalysis(false);
      setselectedClasses([]);
      if (!hasColumns) {
        setClassTable({ class: [] });
      }
    }
  }, [selectedIllnessColumn, selectedSampleColumn, showStepFour, setShowStepFour, setShowStepFive, setShowStepSix, setShowStepAnalysis, setselectedClasses, setClassTable, stepFourRef, scrollToStep, requiresMerge, mergeCompleted, singleIncluded]);

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
    const sortedSelection = normalizeAndSortClasses(newlySelectedClasses);
    if (sortedSelection.length === 2) {
        setselectedClasses(sortedSelection);
        console.log("Selected classes:", sortedSelection);
        setShowStepFive(true);

        setTimeout(() => {
          if (stepFiveRef.current) scrollToStep(stepFiveRef);
        }, 100);
    } else {
        console.warn("handleClassSelection received invalid selection:", newlySelectedClasses);
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
      setIsDiffAnalysisClasses(normalizeAndSortClasses(selectedClasses));
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
      const updated = [...nonFeatureColumns, columnToAdd].sort();
      setNonFeatureColumns(updated); // Add in alphabetical order
      updateUploadContext(uploadedInfo?.filePath, (prev) => ({
        ...prev,
        nonFeatureColumns: updated
      }));
      // Logic for showing Step 7 is in useEffect
    }
  };

  // 6.Adım: Görüntülenen etiketten bir non-feature sütunu kaldırma
  const handleRemoveNonFeatureColumn = (columnToRemove) => {
    setNonFeatureColumns((prev) => {
      const updated = prev.filter((col) => col !== columnToRemove);
      updateUploadContext(uploadedInfo?.filePath, (entry) => ({
        ...entry,
        nonFeatureColumns: updated
      }));
      return updated;
    });
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
      filePath: analysisFilePath,
      IlnessColumnName: selectedIllnessColumn,
      SampleColumnName: selectedSampleColumn,
      selectedClasses: normalizeAndSortClasses(selectedClasses),
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
    if (!analysisFilePath || !selectedIllnessColumn || !selectedSampleColumn || selectedClasses.length !== 2) {
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
        // Store the analysis ID for pathway analysis
        if (response.data.analysisId) {
          setCurrentAnalysisId(response.data.analysisId);
        }
        const newAnalysis = {
          results: response.data.imagePaths || [],
          time: response.data.elapsedTime || "N/A",
          date: new Date().toLocaleString('en-GB'),
          parameters: payload,
          analysisInfo: { ...selectedAnalyzes },
          bestParams: response.data.bestParams || null,
          analysisId: response.data.analysisId || null
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
  const handleValidationGeneCapChange = (event) => {
    const rawValue = Number(event?.target?.value);
    const nextValue = Number.isFinite(rawValue) ? rawValue : DEFAULT_VALIDATION_GENE_LIMIT;
    setValidationGeneCap(VALIDATION_GENE_OPTIONS.includes(nextValue) ? nextValue : DEFAULT_VALIDATION_GENE_LIMIT);
  };

  const handleEnrichmentAnalysis = async (analysisType = 'KEGG') => {
    const config = ENRICHMENT_OPTIONS[analysisType] || ENRICHMENT_OPTIONS.KEGG;

    if (enrichmentProcessing[analysisType]) {
      return;
    }

    if (!Array.isArray(previousAnalyses) || previousAnalyses.length === 0) {
      setError(`Please run at least one analysis before performing ${config.analysisDisplayName?.toLowerCase() || 'pathway analysis'}.`);
      return;
    }

    const candidates = [];
    const seenUrls = new Set();

    const fetchEnrichmentResultTable = async (relativePath) => {
      if (!relativePath) {
        return null;
      }
      try {
        const url = buildUrl(`/${relativePath}`);
        const response = await apiFetch(url);
        if (!response.ok) {
          return null;
        }
        const rawText = (await response.text()).replace(/^\uFEFF/, '').trim();
        if (!rawText) {
          return null;
        }
        const lines = rawText.split(/\r?\n/).filter((line) => line.trim().length > 0);
        if (lines.length === 0) {
          return null;
        }
        const delimiter = [';', '\t', ','].find((del) => lines[0].includes(del)) || ',';
        const cleanCell = (value) => value.replace(/^"|"$/g, '').replace(/^'|'$/g, '').trim();
        const headers = lines[0].split(delimiter).map(cleanCell);
        const rows = lines.slice(1).map((line) => line.split(delimiter).map(cleanCell));
        if (headers.length === 0 || rows.length === 0) {
          return { headers, rows: [] };
        }
        return { headers, rows, delimiter };
      } catch (err) {
        console.warn('Failed to load enrichment table:', err);
        return null;
      }
    };

    if (summarizeAnalyses.length > 0) {
      const latest = summarizeAnalyses[summarizeAnalyses.length - 1];
      if (latest?.csvPath) {
        const url = buildUrl(`/${latest.csvPath}`);
        if (!seenUrls.has(url)) {
          seenUrls.add(url);
          candidates.push({
            url,
            classPair: latest.classPair || null,
          });
        }
      }
    }

    for (let idx = previousAnalyses.length - 1; idx >= 0; idx -= 1) {
      const analysis = previousAnalyses[idx];
      (analysis?.results || []).forEach((imagePath) => {
        const downloadLinks = buildDownloadLinks(imagePath);
        downloadLinks
          .filter((link) => link?.href && /ranked_features_df\.csv/i.test(link.href))
          .forEach((link) => {
            if (!seenUrls.has(link.href)) {
              seenUrls.add(link.href);
              candidates.push({
                url: link.href,
                classPair: parseClassPairFromUrl(link.href),
              });
            }
          });
      });
    }

    if (candidates.length === 0) {
      setError(config.emptyStateMessage || `No biomarker list found for ${config.analysisDisplayName || 'pathway analysis'}. Please combine biomarker rankings first.`);
      return;
    }

    const geneLimit = Number.isFinite(selectedFeatureCount) && selectedFeatureCount > 0
      ? selectedFeatureCount
      : 50;

    setError('');
    setInfo('');
    setEnrichmentProcessing((prev) => ({
      ...prev,
      [analysisType]: true,
    }));

    let selectedGenes = [];
    let chosenCandidate = null;
    let lastCandidateError = null;

    for (const candidate of candidates) {
      try {
        const response = await apiFetch(candidate.url);
        if (!response.ok) {
          throw new Error(`Failed to download biomarker list (HTTP ${response.status})`);
        }
        const csvText = await response.text();
        const genes = extractGenesFromCsv(csvText, geneLimit);
        if (genes.length === 0) {
          continue;
        }
        selectedGenes = genes;
        chosenCandidate = candidate;
        break;
      } catch (err) {
        lastCandidateError = err;
      }
    }

    if (!selectedGenes.length) {
      console.error(`Failed to prepare biomarker genes for ${config.analysisDisplayName}:`, lastCandidateError);
      setEnrichmentProcessing((prev) => ({
        ...prev,
        [analysisType]: false,
      }));
      setError(`Unable to prepare biomarker list for ${config.analysisDisplayName}. Please ensure an analysis has produced ranked features.`);
      return;
    }

    const payload = {
      analysisResults: selectedGenes,
      analysisType,
      geneSet: config.geneSet,
      analysisLabel: config.analysisLabel,
      analysisDisplayName: config.analysisDisplayName,
      analysisId: currentAnalysisId, // Pass the current analysis ID
    };

    let resolvedClasses = Array.isArray(selectedClasses) ? selectedClasses.filter(Boolean) : [];
    if (resolvedClasses.length < 2 && chosenCandidate?.classPair) {
      resolvedClasses = chosenCandidate.classPair.split('_').map((cls) => cls.replace(/%20/g, ' '));
    }
    if (resolvedClasses.length >= 2) {
      payload.selectedClasses = resolvedClasses;
    }

    let resolvedResultsDir = chosenCandidate?.url ? deriveResultsDirFromUrl(chosenCandidate.url) : null;
    if (!resolvedResultsDir && analysisFilePath) {
      const normalizedPath = String(analysisFilePath).replace(/\\/g, '/');
      const baseName = normalizedPath.split('/').pop()?.split('.')[0];
      if (baseName) {
        resolvedResultsDir = `results/${baseName}`;
      }
    }
    if (resolvedResultsDir) {
      payload.resultsDir = resolvedResultsDir;
    }

    try {
      const response = await api.post('/api/pathway-analysis', payload);
      if (!response?.data) {
        throw new Error(`No response received from ${config.analysisDisplayName}.`);
      }

      if (!response.data.success) {
        throw new Error(response.data.message || `${config.analysisDisplayName} failed.`);
      }

      const detail = response.data.data || {};
      const downloadUrl = detail.pathwayResults ? buildUrl(`/${detail.pathwayResults}`) : null;
      const classPair = detail.classPair || chosenCandidate?.classPair || null;
      let table = null;
      if (detail.pathwayResults) {
        table = await fetchEnrichmentResultTable(detail.pathwayResults);
      }

      setEnrichmentAnalyses((prev) => ([
        ...prev,
        {
          id: detail.runId || Date.now(),
          analysisType: detail.analysisType || analysisType,
          analysisLabel: detail.analysisLabel || config.analysisLabel,
          analysisDisplayName: detail.analysisDisplayName || config.analysisDisplayName,
          geneSet: detail.geneSet || config.geneSet,
          summary: detail.summary || response.data.message,
          message: response.data.message,
          significantPathwayCount: detail.significantPathwayCount ?? 0,
          totalPathways: detail.totalPathways ?? 0,
          inputGeneCount: detail.inputGeneCount ?? selectedGenes.length,
          classPair,
          downloadUrl,
          rawPath: detail.pathwayResults || null,
          table,
          timestamp: Date.now(),
        },
      ]));
      setCompletedEnrichmentTypes((prev) => ({
        ...prev,
        [analysisType]: true,
      }));

      setError('');
      setInfo(response.data.message || `${config.analysisDisplayName} completed.`);
      setTimeout(() => setInfo(''), 5000);
    } catch (err) {
      console.error(`${config.analysisDisplayName} request failed:`, err);
      const message = err.response?.data?.message || err.message || `${config.analysisDisplayName} failed.`;
      setError(message);
    } finally {
      setEnrichmentProcessing((prev) => ({
        ...prev,
        [analysisType]: false,
      }));
    }
  };

  const resolveValidationSource = useCallback(() => {
    if (summarizeAnalyses.length > 0) {
      const latest = summarizeAnalyses[summarizeAnalyses.length - 1];
      if (latest?.csvPath) {
        return {
          url: buildUrl(`/${latest.csvPath}`),
          classPair: latest.classPair || null
        };
      }
    }
    for (let idx = previousAnalyses.length - 1; idx >= 0; idx -= 1) {
      const analysis = previousAnalyses[idx];
      for (const imagePath of analysis?.results || []) {
        const downloadLinks = buildDownloadLinks(imagePath);
        const rankedLink = downloadLinks.find((link) => /ranked_features_df\.csv/i.test(link?.href || ''));
        if (rankedLink) {
          return {
            url: rankedLink.href,
            classPair: parseClassPairFromUrl(rankedLink.href)
          };
        }
      }
    }
    return null;
  }, [summarizeAnalyses, previousAnalyses]);

  const handleBiomarkerValidation = async () => {
    if (validationLoading) {
      return;
    }
    const source = resolveValidationSource();
    if (!source) {
      setValidationError('Please combine the biomarker rankings before running validation.');
      return;
    }
    setValidationLoading(true);
    setValidationError('');
    const selectedGeneLimit = VALIDATION_GENE_OPTIONS.includes(validationGeneCap)
      ? validationGeneCap
      : DEFAULT_VALIDATION_GENE_LIMIT;

    try {
      const response = await apiFetch(source.url);
      if (!response.ok) {
        throw new Error('Failed to download the biomarker list for validation.');
      }
      const csvText = await response.text();
      const genes = extractGenesFromCsv(csvText, selectedGeneLimit);
      if (!genes.length) {
        throw new Error('No gene symbols were found in the biomarker list.');
      }
      const apiResponse = await api.post('/api/biomarker-validation', { genes, maxGenes: selectedGeneLimit });
      if (!apiResponse?.data?.success) {
        throw new Error(apiResponse?.data?.message || 'Biomarker validation failed.');
      }
      
      const validationData = {
        ...apiResponse.data,
        classPair: source.classPair || null,
        geneList: genes
      };
      
      setValidationResult(validationData);
      
      // Save validation results to database if we have a current analysis ID
      if (currentAnalysisId) {
        try {
          const token = localStorage.getItem('token');
          await api.post('/api/biomarker-validation/save', {
            analysisId: currentAnalysisId,
            validationData: validationData
          }, {
            headers: { Authorization: `Bearer ${token}` }
          });
          console.log('Validation results saved to database');
        } catch (saveError) {
          console.error('Failed to save validation results:', saveError);
          // Don't fail the validation if saving fails
        }
      }
    } catch (error) {
      setValidationError(error.response?.data?.message || error.message || 'Unable to validate biomarkers.');
      setValidationResult(null);
    } finally {
      setValidationLoading(false);
    }
  };

  const canValidateBiomarkers = useMemo(() => Boolean(resolveValidationSource()), [resolveValidationSource]);

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
    setCanRunPathwayAnalysis(false);
    setEnrichmentAnalyses([]);
    setCompletedEnrichmentTypes({});
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
    setSelectedFilePreviews([]);
    setLoading(false);
    setAnalyzing(false);
    setProcessing(false);
    setPreviousAnalyses([]);
    setAnalysisInformation([]);
    setAnotherAnalysis([0]);
    setUploadedInfo(null);
    setUploadedInfos(null);
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
    setActiveUploadIndex(0);
    setUploadContexts({});
    setEnrichmentAnalyses([]);
    setEnrichmentProcessing({});
    setCompletedEnrichmentTypes({});
    setCanRunPathwayAnalysis(false);
    classCacheRef.current = new Map();

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
    if (!analysisFilePath) {
        setError("Cannot summarize: File path is missing.");
    }
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
    setError('');
    setCanRunPathwayAnalysis(false);
    setEnrichmentAnalyses([]);
    setCompletedEnrichmentTypes({});

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
        filePath: analysisFilePath,
        selectedClassPair: selectedClassPair,
        // Optional aggregation overrides for combine step
        aggregationMethod: aggregationMethod || undefined,
        aggregationWeights: aggregationWeights || undefined,
        rrfK: typeof rrfK === 'number' ? rrfK : undefined,
        analysisId: currentAnalysisId // Pass current analysis ID
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
          setCanRunPathwayAnalysis(true);
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

  const handleViewGuestAnalysis = async () => {
    try {
      const token = localStorage.getItem('token');
      const response = await api.get('/api/user/guest/last-analysis', {
        headers: { Authorization: `Bearer ${token}` }
      });

      if (response.data.success && response.data.analysis) {
        // Navigate to the analysis detail page
        navigate(`/analysis/${response.data.analysis.id}`);
      } else {
        alert('No analysis found. Please run an analysis first.');
      }
    } catch (error) {
      console.error('Error fetching guest analysis:', error);
      alert('No analysis found or error occurred. Please run an analysis first.');
    }
  };

  const handleLogout = () => {
    // Clear auth token from state and storage
    setToken(null);
    localStorage.removeItem('token');

    // Reset upload / file related state
    setFile(null);
    setSelectedFilePreviews([]);
    setUploadedInfo(null);

    // Reset UI step state
    setShowStepOne(true);
    setShowStepTwo(false);
    setShowStepThree(false);
    setShowStepFour(false);
    setShowStepFive(false);
    setShowStepSix(false);
    setShowStepAnalysis(false);

    // Reset analysis related state
    setPreviousAnalyses([]);
    setAnalysisInformation([]);
    setAnotherAnalysis([0]);
    setselectedClasses([]);
    setClassTable({ class: [] });
    setColumns([]);
    setAllColumns([]);
    setEnrichmentAnalyses([]);
    setEnrichmentProcessing({});
    setCompletedEnrichmentTypes({});
    setCanRunPathwayAnalysis(false);

    // Navigate to login page
    navigate(LOGIN_PATH);
  };

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
        <span>BIOMARK-X: Biomarker Analysis Tool</span>
        
        <div className="header-buttons">
          <UserMenu 
            isGuest={isGuestUser()}
            username={username}
            onNavigateToLogin={() => navigate(LOGIN_PATH)}
            onLogout={handleLogout}
            onViewGuestAnalysis={handleViewGuestAnalysis}
          />

          <button className="user-guide-link" onClick={handleOpenUserGuide}>
            <span>User</span>
            <span>Guide</span>
          </button>
        </div>
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
            
            <span id="file-name">
              {selectedFilePreviews.length > 0
                ? selectedFilePreviews.map((name, index) => (
                    <React.Fragment key={`${name}-${index}`}>
                      {index > 0 && ', '}
                      {truncateFileName(name)}
                    </React.Fragment>
                  ))
                : 'No file chosen'}
            </span>
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
            multiple // Allow selecting multiple files
          />
        </div>
      </div>
      )}
      
      {/* Step 1: Format popup */}
      {showFormatPopup && <InputFormatPopup onClose={handleCloseFormatPopup} />}
      
      {/* Step 2: Upload file */}
      {showStepTwo && (
      <div className="file-upload-section">
        <div className="step-and-instruction">
          <div className="step-number">2</div>
          <h2 className="title">Upload your file</h2>
        </div>

        <div className="upload-main-area">
          {/* Loading / info message */}
          {info && (
            <div className="loading-message">
              {loading && <div className="spinner"></div>}
              {info}
            </div>
          )}

          {/* Single upload controls */}
          <div style={{ marginTop: 8 }}>
            {!hasSuccessfulUpload && (
              <button className="upload-button" onClick={handleUpload} disabled={uploading || loading}>
                Upload
              </button>
            )}
            {uploading && (
              <div className="file-is-loading">
                <div className="spinner"></div>
                File is uploading...
              </div>
            )}
            {error && <div className="error-message">{error}</div>}
          </div>

          {/* If multiple uploaded infos exist, render them via a single loop */}
          {Array.isArray(uploadedInfos) && uploadedInfos.length > 0 ? (
            <div style={{ marginTop: 12 }}>
              <div className="uploaded-info">Uploaded files:</div>
              {uploadedInfos.map((infoItem, i) => (
                <div key={i} className="uploaded-info" style={{ marginTop: 8 }}>
                  Uploaded file: <b>{truncateFileName(infoItem.name)}</b>
                  {infoItem.size ? ` (${infoItem.size})` : ''}
                  {infoItem.duration && <div className="upload-duration">Upload time: {infoItem.duration}</div>}
                </div>
              ))}
            </div>
          ) : (
            /* Fallback: single uploadedInfo (shown once) */
            uploadedInfo && !loading && (
              <div style={{ marginTop: 12 }}>
                <div className="uploaded-info">
                  Uploaded file: <b>{truncateFileName(uploadedInfo.name)}</b> ({uploadedInfo.size})
                </div>
                {uploadDuration && <div className="upload-duration">Upload time: {uploadDuration}</div>}
              </div>
            )
          )}
        </div>
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
                <div className="step-three-content">
                  {Array.isArray(uploadedInfos) && uploadedInfos.length > 0 && (
                    <div className="uploaded-file-selector">
                      <h3>Uploaded Files</h3>
                      {uploadedInfos.map((infoItem, idx) => {
                        const isActive = idx === activeUploadIndex;
                        const hasFilePath = Boolean(infoItem && infoItem.filePath);
                        const context = hasFilePath ? uploadContexts[infoItem.filePath] : null;
                        const hasSelections = Boolean(context && context.illnessColumn && context.sampleColumn);
                        const includeInMerge = context?.includeInMerge !== false;
                        const buttonClass = [
                          'uploaded-file-button',
                          isActive ? 'is-active' : '',
                          !hasFilePath ? 'is-disabled' : '',
                          hasSelections ? 'is-configured' : '',
                          !includeInMerge && hasFilePath ? 'is-excluded' : ''
                        ].filter(Boolean).join(' ');
                        const illnessLabel = context?.illnessColumn ? truncateFileName(context.illnessColumn, 18) : '?';
                        const sampleLabel = context?.sampleColumn ? truncateFileName(context.sampleColumn, 18) : '?';
                        return (
                          <button
                            key={`${infoItem.name}-${idx}`}
                            className={buttonClass}
                            onClick={() => hasFilePath && handleUploadedFileSelection(idx)}
                            disabled={!hasFilePath}
                            title={!hasFilePath ? (infoItem.error || 'Upload failed') : undefined}
                          >
                            {hasFilePath && (
                              <span
                                className="uploaded-file-button__checkbox"
                                onClick={(event) => event.stopPropagation()}
                                onMouseDown={(event) => event.stopPropagation()}
                              >
                                <input
                                  type="checkbox"
                                  checked={includeInMerge}
                                  onChange={(event) => handleToggleFileInclusion(infoItem?.filePath, event.target.checked)}
                                  onClick={(event) => event.stopPropagation()}
                                  onMouseDown={(event) => event.stopPropagation()}
                                  disabled={!hasFilePath}
                                  aria-label={includeInMerge ? 'Exclude from merge' : 'Include in merge'}
                                />
                              </span>
                            )}
                            <span className="uploaded-file-button__name">
                              {truncateFileName(infoItem.name, 28)}
                            </span>
                            {hasFilePath && <span className="uploaded-file-button__status" aria-hidden="true" />}
                            {!hasFilePath && <span className="uploaded-file-button__status uploaded-file-button__status--error" aria-hidden="true">!</span>}
                            {hasFilePath && !includeInMerge && (
                              <span className="uploaded-file-button__meta uploaded-file-button__meta--excluded">
                                Excluded from merge
                              </span>
                            )}
                            {hasFilePath && (
                              <span className="uploaded-file-button__meta">
                                PG: {illnessLabel} | SID: {sampleLabel}
                              </span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  )}

                  <div className="column-selection-area">
                    <div className="column-select-block">
                      <label>Patient Group Column:</label>
                      <SearchableColumnList
                        initialColumns={firstTenColumns}
                        allColumns={allColumns}
                        onSelect={handleIllnessColumnSelection}
                        selectedColumns={activeUploadContext?.illnessColumn || ''}
                        placeholder="Search Patient Group column..."
                        listHeight="150px"
                        isLoading={loadingAllColumns}
                        disabled={loadingAllColumns}
                      />
                    </div>

                    <div className="column-select-block">
                      <label>Sample ID Column:</label>
                      <SearchableColumnList
                        initialColumns={firstTenColumns}
                        allColumns={allColumns}
                        onSelect={handleSampleColumnSelection}
                        selectedColumns={activeUploadContext?.sampleColumn || ''}
                        placeholder="Search Sample ID column..."
                        listHeight="150px"
                        isLoading={loadingAllColumns}
                        disabled={loadingAllColumns}
                      />
                    </div>
                  </div>
                </div>

                {successfulUploads.length > 0 && (
                <div className="merge-action-panel">
                    <div className="merge-action-copy">
                      <h3>{requiresMerge ? 'Merge uploaded files' : 'Confirm dataset selection'}</h3>
                      <p>{requiresMerge ? 'Combine the configured files into a single dataset before continuing to Step 4.' : 'Confirm the selected file before continuing to Step 4.'}</p>
                      {requiresMerge && !allFilesHaveSelections && (
                        <p className="merge-hint">Select Patient Group and Sample ID columns for each included file to enable merging.</p>
                      )}
                      {!requiresMerge && !mergeCompleted && !singleIncludedReady && (
                        <p className="merge-hint">Select Patient Group and Sample ID columns to continue.</p>
                      )}
                      {!requiresMerge && !mergeCompleted && singleIncludedReady && (
                        <p className="merge-hint">Review your selections, then click Continue.</p>
                      )}
                      {mergeMetadata && mergeCompleted && (
                        <div className="merge-summary">
                          <span className="merge-summary__label">Current dataset:</span>
                          <span className="merge-summary__value">
                            {truncateFileName(mergeMetadata.name, 32)} ({mergeMetadata.size})
                          </span>
                        </div>
                      )}
                    </div>
                    <div className="merge-action-controls">
                      <button
                        type="button"
                        className="merge-files-button"
                        onClick={handleMergeFiles}
                        disabled={!canMerge}
                      >
                        {mergeButtonLabel}
                      </button>
                      {mergeInProgress && (
                        <span className="merge-status merge-status--progress">{requiresMerge ? 'Merging files. This may take a moment.' : 'Preparing dataset...'}</span>
                      )}
                      {!mergeInProgress && mergeCompleted && mergeMetadata && (
                        <span className="merge-status merge-status--success">{requiresMerge ? 'Merged successfully.' : 'Dataset ready.'}</span>
                      )}
                      {!mergeInProgress && requiresMerge && !mergeCompleted && allFilesHaveSelections && (
                        <span className="merge-status">All selections ready. Click merge to continue.</span>
                      )}
                    </div>
                  </div>
                )}

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
                  {classColumnOptions.length > 0 && (
                    <div className="class-column-selector">
                      <label htmlFor="class-column-select">Patient Group Column for Step 4</label>
                      <select
                        id="class-column-select"
                        value={selectedIllnessColumn || ''}
                        onChange={handleClassColumnChange}
                        disabled={classColumnOptions.length === 0}
                      >
                        {!selectedIllnessColumn && <option value="" disabled>Select a column</option>}
                        {classColumnOptions.map((columnName) => (
                          <option key={columnName} value={columnName}>
                            {columnName}
                          </option>
                        ))}
                      </select>
                      {requiresMerge && classColumnOptions.length > 1 && (
                        <p className="class-column-selector__hint">
                          Choose which patient group column to use when fetching class values from the merged dataset.
                        </p>
                      )}
                    </div>
                  )}
                </div>
              )}
              {/* Step 4: Class Table */}
              {classTable.class && Array.isArray(classTable.class) && showStepFour && !previousAnalyses[index] && classTable.class.length > 0 && (
                <BarChartWithSelection
                  key={`${analysisFilePath || 'no-file'}::${selectedIllnessColumn || 'no-column'}`}
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
                      initialColumns={analysisFirstTenColumns}
                      allColumns={analysisAllColumns}
                        onSelect={handleAddNonFeatureColumn}
                        selectedColumns={nonFeatureColumns}
                        placeholder="Search columns to exclude..."
                        listHeight="200px"
                        isLoading={loadingAllColumns}
                        disabled={loadingAllColumns || loadingClasses}
                      useAllColumnsAsDefault
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
                        <optgroup label="Rank-based methods">
                          <option value="sum">Mean Rank</option>
                          <option value="weighted_borda">Weighted Borda Count (Weighted Mean Rank)</option>
                          <option value="median_rank">Median Rank</option>
                          <option value="mra">Median Rank Algorithm (MRA)</option>
                          <option value="min_rank">Minimum (Best) Rank</option>
                          <option value="rank_product">Geometric Mean Rank</option>
                          <option value="stuart">Stuart Rank Aggregation</option>
                          <option value="rra">Robust Rank Aggregation (RRA)</option>
                          <option value="rrf">Reciprocal Rank Fusion (RRF)</option>
                        </optgroup>
                        <optgroup label="Weight-based methods">
                          <option value="mean_weight">Mean Weight</option>
                          <option value="median_weight">Median Weight</option>
                          <option value="max_weight">Max Weight</option>
                          <option value="geometric_mean_weight">Geometric Mean Weight</option>
                          <option value="ta">Threshold Algorithm (TA)</option>
                        </optgroup>
                      </select>
                      {aggregationMethod === 'weighted_borda' && (
                        <>
                          <label style={{ fontWeight: 600 }}>weights (JSON)</label>
                          <input type="text" value={aggregationWeights} onChange={(e) => setAggregationWeights(e.target.value)} placeholder='{"shap":1.5,"anova":1.0,"t_test":1.0,"lime":1.2}' style={{ minWidth: 350, fontSize: 16 }} />
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

                  {canRunPathwayAnalysis && remainingEnrichmentOptions.length > 0 && (
                    <div className="kegg-trigger-container">
                      <div className="or-container">
                        <h1 className="or-text">OR</h1>
                      </div>
                      <div className="enrichment-button-grid">
                        {remainingEnrichmentOptions.map((key) => {
                          const option = ENRICHMENT_OPTIONS[key];
                          if (!option) {
                            return null;
                          }
                          const busy = Boolean(enrichmentProcessing[key]);
                          return (
                            <button
                              key={key}
                              className="button perform-analysis kegg-trigger-button"
                              onClick={() => handleEnrichmentAnalysis(key)}
                              disabled={busy}
                            >
                              {busy ? `Running ${option.analysisDisplayName}...` : option.buttonLabel}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {enrichmentAnalyses.length > 0 && (
                    <div className="kegg-analysis-results">
                      {enrichmentAnalyses.map((entry) => {
                        const friendlyPair = entry.classPair ? entry.classPair.split('_').join(' vs ') : 'All Classes';
                        const rows = Array.isArray(entry.table?.rows) ? entry.table.rows : [];
                        const displayedRows = rows.slice(0, KEGG_PREVIEW_LIMIT);
                        const columns = buildKeggColumns(entry.table);
                        const hasTableData = displayedRows.length > 0;
                        const footnoteMessage = rows.length > displayedRows.length
                          ? `Showing top ${displayedRows.length} of ${rows.length} pathways. Download the CSV for the complete list.`
                          : `Showing top ${displayedRows.length} pathways. Download the CSV to keep a copy.`;
                        return (
                          <div
                            key={`${entry.id}-${entry.timestamp}`}
                            className="kegg-analysis-card"
                          >
                            <h3 className="kegg-analysis-title">{entry.analysisDisplayName || 'Pathway Enrichment'} ({friendlyPair})</h3>
                            <p className="kegg-summary-text">{entry.summary}</p>
                            <div className="kegg-stats-row">
                              <span><strong>Input genes:</strong> {entry.inputGeneCount}</span>
                              <span>
                                <strong>Significant pathways:</strong> {entry.significantPathwayCount} / {entry.totalPathways}
                              </span>
                            </div>
                            {entry.downloadUrl && (
                              <div className="kegg-download">
                                <a href={entry.downloadUrl} download className="kegg-download-link">
                                  Download {entry.analysisDisplayName || 'enrichment'} results CSV
                                </a>
                              </div>
                            )}
                            {hasTableData && (
                              <div className="kegg-table-wrapper">
                                <table className="kegg-table">
                                  <thead>
                                    <tr>
                                      {columns.map((column, idx) => (
                                        <th
                                          key={`${entry.id}-header-${idx}`}
                                          className={`kegg-table-header ${idx === 0 ? 'kegg-table-header--index' : ''}`}
                                        >
                                          {column.label || 'Unnamed'}
                                        </th>
                                      ))}
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {displayedRows.map((row, rowIdx) => (
                                      <tr key={`${entry.id}-row-${rowIdx}`}>
                                        {columns.map((column, colIdx) => (
                                          <td
                                            key={`${entry.id}-row-${rowIdx}-col-${colIdx}`}
                                            className={`kegg-table-cell ${colIdx === 0 ? 'kegg-table-cell--index' : ''}`}
                                          >
                                            {column.getValue(row, rowIdx)}
                                          </td>
                                        ))}
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                                <div className="kegg-table-footnote">
                                  {footnoteMessage}
                                </div>
                              </div>
                            )}
                            {!hasTableData && (
                              <div className="kegg-table-footnote">No pathway table was returned for this run.</div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                  
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
                    datasetFileName={datasetNamesForReport}
                    enrichmentAnalyses={enrichmentAnalyses}
                    onValidateBiomarkers={handleBiomarkerValidation}
                    biomarkerValidationResult={validationResult}
                    biomarkerValidationError={validationError}
                    biomarkerValidationLoading={validationLoading}
                    canValidateBiomarkers={canValidateBiomarkers}
                    validationGeneCap={validationGeneCap}
                    validationGeneOptions={VALIDATION_GENE_OPTIONS}
                    onValidationGeneCapChange={handleValidationGeneCapChange}
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