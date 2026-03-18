import React, { useState, useEffect, useMemo, useCallback } from 'react';
import jsPDF from 'jspdf';
import '../css/step9-generateAnalysisReport.css';
import { buildUrl } from '../api';
import { buildBackendUrl } from '../CHANGE_AFTER_DEPLOYMENT';
import { buildKeggColumns, sanitizeKeggCell } from '../utils/keggTable';

const ENRICHMENT_REPORT_PREVIEW_LIMIT = 10; // limit report tables to top 10 pathways



/**
 * Component for generating biomarker analysis report
 *
 * IMPORTANT: The `analysisResults` prop from `App.js` is expected to have the following structure for each analysis:
 * {
 *   title: string,        // e.g., "Analysis 1"
 *   images: Array<{ id: string, path: string, caption: string }>,
 *   classPair: string,    // e.g., "Disease vs Healthy"
 *   date: string,         // Date of analysis
 *   time: string,         // Execution time
 *   types: {              // Analysis types
 *     differential?: string[],
 *     clustering?: string[],
 *     classification?: string[]
 *   },
 *   parameters?: object    // Optional extra parameters (e.g., for caption generation)
 * }
 */
const AnalysisReport = ({ 
  analysisResults, // This prop should have the enriched structure described above
  // The following global props can still be used for a general report title or summary for all analyses,
  // but main details now come from `analysisResults`.
  analysisDate, 
  executionTime, 
  selectedClasses, // Global - last selected or general context
  selectedIllnessColumn, // Global
  selectedAnalyzes, // Global
  featureCount, // Global
  // selectedClassPair, // already comes from summarizeAnalyses
  summaryImagePath, // This prop is related to summarizeAnalyses and its structure is preserved
  summarizeAnalyses, // This prop's structure is good and preserved
  datasetFileName, // Name(s) of the file(s) used in the analysis (string or string[])
  enrichmentAnalyses = [],
  onValidateBiomarkers,
  biomarkerValidationResult, // For backward compatibility (current analysis flow)
  biomarkerValidationResults = [], // New: Array of validation results (for My Analysis page)
  biomarkerValidationError,
  biomarkerValidationLoading = false,
  canValidateBiomarkers = true,
  showValidationSeparator = false,
  validationGeneCap,
  validationGeneOptions = [],
  onValidationGeneCapChange
}) => {
  // State for loading overlay
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [logoDataUrl, setLogoDataUrl] = useState(null);
  const [activeValidationView, setActiveValidationView] = useState('biomarkers');

  // Merge single validation result with array for uniform handling
  const allValidationResults = useMemo(() => {
    if (biomarkerValidationResult) {
      // Current analysis flow: single result
      return [biomarkerValidationResult];
    }
    // My Analysis page: array of results
    return biomarkerValidationResults;
  }, [biomarkerValidationResult, biomarkerValidationResults]);

  const datasetNameList = useMemo(() => {
    if (Array.isArray(datasetFileName)) {
      return datasetFileName.filter(name => typeof name === 'string' && name.trim().length > 0);
    }
    if (typeof datasetFileName === 'string' && datasetFileName.trim().length > 0) {
      return [datasetFileName.trim()];
    }
    return [];
  }, [datasetFileName]);

  const datasetNamesDisplay = datasetNameList.join(', ');
  const datasetSlug = datasetNameList.length > 0
    ? datasetNameList.join('_').replace(/[\s,]+/g, '_').replace(/[<>:"/\\|?*]/g, '')
    : 'Unknown_File';

  const deriveNormalizationDetails = useCallback((metadata = {}) => {
    if (!metadata || typeof metadata !== 'object') {
      return ['Normalization: Not applied'];
    }

    let config = metadata.normalizationConfig || metadata.executedNormalizationConfig || null;

    if (!config && metadata.normalizationPipeline && typeof metadata.normalizationPipeline === 'object') {
      const pipeline = metadata.normalizationPipeline;
      const pipelineType = (metadata.normalizationPipelineType || (pipeline.mogonetPreprocess ? 'mogonet' : 'standard')).toLowerCase();

      if (pipelineType === 'mogonet') {
        const mogonetCfg = pipeline.mogonetPreprocess || {};
        const legacyOmics = String(mogonetCfg.omicsType || '').toLowerCase();
        config = {
          pipelineType: 'mogonet',
          mogonet: {
            applyLogTransform: typeof mogonetCfg.applyLogTransform === 'boolean'
              ? mogonetCfg.applyLogTransform
              : ['proteomics', 'metabolomics'].includes(legacyOmics),
            fdrAlpha: mogonetCfg.fdrAlpha ?? 0.05,
            varThreshMrna: mogonetCfg.varThreshMrna ?? 0.1,
            varThreshMeth: mogonetCfg.varThreshMeth ?? 0.001,
            pc1Max: mogonetCfg.pc1Max ?? 0.5,
            minKeep: mogonetCfg.minKeep ?? 200,
            maxKeep: mogonetCfg.maxKeep ?? 300,
            hm27Restriction: Boolean(mogonetCfg.hm27Restriction),
            hm27ArtifactPath: mogonetCfg.hm27ArtifactPath || '../artifacts/hm27_probe_ids.json',
          },
        };
      } else {
        const log = pipeline.logTransformation || {};
        const batch = pipeline.batchEffectCorrection || {};
        const norm = pipeline.normalization || {};
        const outlier = pipeline.outlierDetection || {};

        config = {
          pipelineType: 'standard',
          logTransform: {
            enabled: Boolean(log.requested),
            base: log.base,
            offset: log.offset,
          },
          batchCorrection: {
            enabled: Boolean(batch.requested),
            batchColumn: batch.batchColumn || '',
            covariates: Array.isArray(batch.covariates) ? batch.covariates : [],
            parametric: Boolean(batch.parametric),
          },
          normalization: {
            enabled: Boolean(norm.requested),
            method: norm.method || 'zscore',
            zscore: norm.zscore || { center: true, scale: true },
            minmax: norm.minmax || { rangeMin: 0, rangeMax: 1 },
            quantile: {
              tieBreaking: norm?.quantile?.tieBreaking || norm?.quantile?.tieBreakingMethod || 'mean',
            },
          },
          outlierDetection: {
            enabled: Boolean(outlier.requested),
            method: outlier.method || 'iqr',
            iqrCoefficient: outlier.iqrCoefficient,
            zscoreDeviation: outlier.zscoreDeviation,
            action: outlier.action || 'impute',
          },
        };
      }
    }

    if (!config) {
      if (metadata.normalizationMode === 'skipped') return ['Normalization: Skipped'];
      if (metadata.normalizationMode === 'normalized') return ['Normalization: Applied (details unavailable)'];
      if (metadata.normalizationMode === 'preloaded') return ['Normalization: Loaded from previous results (no saved config)'];
      return ['Normalization: Not applied'];
    }

    const pipelineType = (config.pipelineType || 'standard').toLowerCase();
    if (pipelineType === 'mogonet') {
      const mogonetCfg = config.mogonet || {};
      return [
        'Normalization: Applied (MOGONET-Style)',
        `Log Transform=${mogonetCfg.applyLogTransform ? 'on' : 'off'}, FDR Alpha=${mogonetCfg.fdrAlpha ?? 0.05}`,
        `Keep Range=${mogonetCfg.minKeep ?? 200}-${mogonetCfg.maxKeep ?? 300}, PC1 Max=${mogonetCfg.pc1Max ?? 0.5}`,
      ];
    }

    const logCfg = config.logTransform || {};
    const batchCfg = config.batchCorrection || {};
    const normCfg = config.normalization || {};
    const outlierCfg = config.outlierDetection || {};

    return [
      'Normalization: Applied (Standard Pipeline)',
      `Log=${logCfg.enabled ? `on (base=${logCfg.base}, offset=${logCfg.offset})` : 'off'}`,
      `Batch=${batchCfg.enabled ? `on (column=${batchCfg.batchColumn || 'N/A'}, ${batchCfg.parametric ? 'parametric' : 'non-parametric'})` : 'off'}`,
      `Norm=${normCfg.enabled ? `${normCfg.method || 'zscore'}` : 'off'}, Outlier=${outlierCfg.enabled ? `${outlierCfg.method || 'iqr'} (${outlierCfg.action || 'impute'})` : 'off'}`,
    ];
  }, []);

  const normalizationSummaryLines = useMemo(() => {
    if (!Array.isArray(analysisResults) || analysisResults.length === 0) {
      return ['Normalization: Not applied'];
    }

    const detailsPerAnalysis = analysisResults.map((analysis) => ({
      classPair: analysis?.classPair || 'N/A',
      lines: deriveNormalizationDetails(analysis?.parameters || {}),
    }));

    const uniqueSignatures = new Set(detailsPerAnalysis.map((entry) => entry.lines.join('|')));
    if (uniqueSignatures.size <= 1) {
      return detailsPerAnalysis[0]?.lines || ['Normalization: Not applied'];
    }

    return detailsPerAnalysis.map((entry) => `${entry.classPair}: ${entry.lines.join(' | ')}`);
  }, [analysisResults, deriveNormalizationDetails]);

  // Helper to render analysis type selections (supports old and new keys)
  const buildAnalysisTypesText = (typesObj) => {
    if (!typesObj || typeof typesObj !== 'object') return 'N/A';
    const parts = [];
    const add = (arr, label) => {
      if (Array.isArray(arr) && arr.length) parts.push(`${label}: ${arr.join(', ')}`);
    };
    // New keys
    add(typesObj.statisticalTest, 'Statistical Test');
    add(typesObj.dimensionalityReduction, 'Dimensionality Reduction');
    add(typesObj.classificationAnalysis, 'Classification');
    add(typesObj.modelExplanation, 'Model Explanation');
    add(typesObj.survivalAnalysis, 'Survival Analysis');
    // Backward-compatibility with old keys
    add(typesObj.differential, 'Statistical Test');
    add(typesObj.clustering, 'Dimensionality Reduction');
    add(typesObj.classification, 'Classification');
    return parts.length ? parts.join('; ') : 'N/A';
  };

  // Group analyses by class pairs
  const groupedAnalyses = useMemo(() => {
    if (!analysisResults || !Array.isArray(analysisResults)) return {};
    return analysisResults.reduce((acc, analysis) => {
      // Assume each analysis object has a 'classPair' field.
      const classPairKey = analysis.classPair || 'Unknown Class Pair';
      if (!acc[classPairKey]) {
        acc[classPairKey] = [];
      }
      acc[classPairKey].push(analysis);
      return acc;
    }, {});
  }, [analysisResults]);

  const hasSummariesSection = Array.isArray(summarizeAnalyses) && summarizeAnalyses.length > 0;
  const hasEnrichmentAnalyses = Array.isArray(enrichmentAnalyses) && enrichmentAnalyses.length > 0;

  let nextSectionNumber = 2;
  const statisticalSectionNumber = hasSummariesSection ? nextSectionNumber++ : null;
  const enrichmentSectionNumber = hasEnrichmentAnalyses ? nextSectionNumber++ : null;
  const analysisResultsSectionNumber = nextSectionNumber;

  const friendlyClassPair = (value) => (value ? value.replaceAll('_', ' ') : 'All Classes');
  const formatScore = (score) => {
    if (typeof score !== 'number' || Number.isNaN(score)) {
      return null;
    }
    return score >= 1 ? score.toFixed(2) : score.toPrecision(2);
  };
  const normalizeScoreValue = (value) => {
    if (typeof value !== 'number' || Number.isNaN(value)) return null;
    return Math.max(0, Math.min(1, value));
  };
  const getScoreColor = (score) => {
    const normalized = normalizeScoreValue(score);
    // Use a blue hue with darker shade as score approaches 1.0
    const lightness = normalized == null ? 60 : 78 - normalized * 60;
    return `hsl(205, 60%, ${lightness}%)`;
  };

  const formatTotalScore = (score) => {
    if (typeof score !== 'number' || Number.isNaN(score)) {
      return null;
    }
    return String(Number(score.toFixed(4)));
  };

  // Helper function to create validation views for a single validation result
  const createValidationViews = useCallback((validationResult) => {
    if (!validationResult) return null;

    const validationTable = validationResult.table;
    const detailedTableColumns = Array.isArray(validationTable?.columns) && validationTable.columns.length > 0
      ? validationTable.columns
      : [
          { key: 'biomarkerSymbol', label: 'Biomarker' },
          { key: 'biomarkerType', label: 'Type' },
          { key: 'biomarkerName', label: 'Name' },
          { key: 'disease', label: 'Disease / Condition' },
          { key: 'score', label: 'Association Score' },
          { key: 'source', label: 'Source' },
        ];

    const detailedTableRows = (!validationTable || !Array.isArray(validationTable.rows))
      ? []
      : validationTable.rows.map((row, index) => ({
          __rowId: `${row.biomarkerSymbol || row.geneSymbol || 'biomarker'}-${index}`,
          ...row,
        }));

    // Diseases view
    const diseaseMap = new Map();
    detailedTableRows.forEach((row) => {
      const diseaseName = row.disease || 'Unknown disease';
      const biomarkerName = row.biomarkerSymbol || row.geneSymbol || row.biomarkerName || row.geneName || 'Unknown biomarker';
      const score = normalizeScoreValue(row.score);
      if (!diseaseMap.has(diseaseName)) {
        diseaseMap.set(diseaseName, new Map());
      }
      const biomarkerScores = diseaseMap.get(diseaseName);
      const existing = biomarkerScores.get(biomarkerName);
      const bestScore = existing == null ? score : (score == null ? existing : Math.max(existing, score));
      biomarkerScores.set(biomarkerName, bestScore);
    });

    const diseasesViewRows = Array.from(diseaseMap.entries()).map(([diseaseName, biomarkersMap], index) => ({
      __rowId: `disease-${index}`,
      disease: diseaseName,
      biomarkers: Array.from(biomarkersMap.entries())
        .map(([biomarker, score]) => ({ label: biomarker, score }))
        .sort((a, b) => a.label.localeCompare(b.label)),
      totalScore: Array.from(biomarkersMap.values()).reduce((sum, value) => (
        typeof value === 'number' && !Number.isNaN(value) ? sum + value : sum
      ), 0),
    }));

    diseasesViewRows.sort((a, b) => {
      const scoreA = typeof a?.totalScore === 'number' ? a.totalScore : 0;
      const scoreB = typeof b?.totalScore === 'number' ? b.totalScore : 0;
      if (scoreB !== scoreA) return scoreB - scoreA;
      return String(a?.disease ?? '').localeCompare(String(b?.disease ?? ''));
    });

    const topDiseases = diseasesViewRows
      .slice(0, 5)
      .map((row) => String(row?.disease ?? '').trim())
      .filter(Boolean);

    // Biomarker view - group by biomarker symbol and type
    const biomarkerMap = new Map();
    detailedTableRows.forEach((row) => {
      const biomarkerKey = row.biomarkerSymbol || row.geneSymbol || row.biomarkerName || row.geneName || 'Unknown biomarker';
      if (!biomarkerMap.has(biomarkerKey)) {
        biomarkerMap.set(biomarkerKey, {
          biomarkerSymbol: row.biomarkerSymbol || row.geneSymbol || biomarkerKey,
          biomarkerType: row.biomarkerType || 'Gene',
          biomarkerName: row.biomarkerName || row.geneName || '',
          diseases: new Map(),
          source: row.source || 'Open Targets',
          link: row.link || '',
        });
      }
      const current = biomarkerMap.get(biomarkerKey);
      const diseaseName = row.disease || 'Unknown disease';
      const score = normalizeScoreValue(row.score);
      const existing = current.diseases.get(diseaseName);
      const bestScore = existing == null ? score : (score == null ? existing : Math.max(existing, score));
      current.diseases.set(diseaseName, bestScore);
      if (!current.link && row.link) {
        current.link = row.link;
      }
    });

    const biomarkerViewRows = Array.from(biomarkerMap.values()).map((entry, index) => ({
      __rowId: `biomarker-${index}`,
      biomarkerSymbol: entry.biomarkerSymbol,
      biomarkerType: entry.biomarkerType,
      biomarkerName: entry.biomarkerName,
      diseases: Array.from(entry.diseases.entries())
        .map(([disease, score]) => ({ label: disease, score }))
        .sort((a, b) => a.label.localeCompare(b.label)),
      source: entry.source,
      link: entry.link,
    }));

    return {
      classPairLabel: validationResult.classPair ? friendlyClassPair(validationResult.classPair) : null,
      timestamp: validationResult.timestamp ? new Date(validationResult.timestamp).toLocaleString() : null,
      geneCount: validationResult.geneCount,
      biomarkerCount: validationResult.biomarkerCount || (Array.isArray(validationResult.geneList) ? validationResult.geneList.length : 0),
      mirnaCount: validationResult.mirnaCount,
      maxGenes: validationResult.maxGenes,
      topDiseases,
      views: {
        biomarkers: {
          label: 'Biomarker view',
          columns: [
            { key: 'biomarkerSymbol', label: 'Biomarker' },
            { key: 'biomarkerType', label: 'Type' },
            { key: 'biomarkerName', label: 'Name' },
            { key: 'diseases', label: 'Diseases' },
            { key: 'source', label: 'Source' },
          ],
          rows: biomarkerViewRows,
        },
        diseases: {
          label: 'Diseases view',
          columns: [
            { key: 'disease', label: 'Disease / Condition' },
            { key: 'biomarkers', label: 'Biomarkers' },
            { key: 'totalScore', label: 'Total Score' },
          ],
          rows: diseasesViewRows,
        },
        detailed: {
          label: 'Detailed view',
          columns: detailedTableColumns,
          rows: detailedTableRows,
        },
      }
    };
  }, []);

  // Process all validation results
  const processedValidations = useMemo(() => {
    return allValidationResults
      .map((result, index) => ({
        id: index,
        ...createValidationViews(result)
      }))
      .filter(v => v.views);
  }, [allValidationResults, createValidationViews]);

  const validationTabOrder = useMemo(() => ([
    { key: 'biomarkers', label: 'Biomarker view' },
    { key: 'diseases', label: 'Diseases view' },
    { key: 'detailed', label: 'Detailed view' },
  ]), []);

  const hasValidationResults = processedValidations.length > 0;
  const showValidationSection = hasValidationResults;

  useEffect(() => {
    if (!processedValidations.length) return;
    const views = processedValidations[0]?.views;
    if (!views) return;
    if (!views[activeValidationView]) {
      setActiveValidationView('biomarkers');
    }
  }, [processedValidations, activeValidationView]);

  const handleDownloadValidationCsv = useCallback((validationIndex) => {
    const validation = processedValidations[validationIndex];
    if (!validation) return;
    
    const view = validation.views[activeValidationView] || validation.views.detailed;
    if (!view.rows.length) {
      return;
    }
    const headers = view.columns.map((col) => col.label || col.key);
    const columnKeys = view.columns.map((col) => col.key);

    const sortScoredItemsForCsv = (items) => {
      if (!Array.isArray(items) || items.length === 0) return items;
      const hasScoreObjects = items.some((item) => item && typeof item === 'object' && typeof item.score === 'number');
      if (!hasScoreObjects) return items;

      return [...items].sort((a, b) => {
        const scoreA = typeof a?.score === 'number' ? a.score : 0;
        const scoreB = typeof b?.score === 'number' ? b.score : 0;
        if (scoreB !== scoreA) return scoreB - scoreA;
        const labelA = String(a?.label ?? '').trim();
        const labelB = String(b?.label ?? '').trim();
        return labelA.localeCompare(labelB);
      });
    };

    const toCsvValue = (value) => {
      if (Array.isArray(value)) {
        const normalizedItems = sortScoredItemsForCsv(value).map((item) => {
          if (item && typeof item === 'object') {
            const label = item.label ?? String(item);
            const scoreText = item.score != null && typeof item.score === 'number' ? formatScore(item.score) : '';
            return scoreText ? `${label} (${scoreText})` : label;
          }
          return String(item ?? '');
        });
        return normalizedItems.join(', ');
      }
      const normalizedValue = value;
      const stringValue = normalizedValue == null ? '' : String(normalizedValue);
      if (/[",\n]/.test(stringValue)) {
        return `"${stringValue.replace(/"/g, '""')}"`;
      }
      return stringValue;
    };
    const rows = view.rows.map((row) => (
      columnKeys.map((key) => {
        if (key === 'link' && row[key]) {
          return toCsvValue(row[key]);
        }
        if (key === 'score' && row[key] != null) {
          return toCsvValue(row[key]);
        }
        if (key === 'totalScore' && row[key] != null) {
          const total = row[key];
          const formatted = typeof total === 'number' ? formatTotalScore(total) : String(total);
          return toCsvValue(formatted);
        }
        return toCsvValue(row[key]);
      }).join(';')
    ));
    const csvContent = [headers.map(toCsvValue).join(';'), ...rows].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `external_biomarker_validation_${validationIndex + 1}_${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }, [activeValidationView, processedValidations]);
  
  // Load logo as DataURL for PDF
  useEffect(() => {
    const loadLogo = async () => {
      try {
        const img = new Image();
        img.crossOrigin = "Anonymous";
        img.src = (process.env.PUBLIC_URL || '') + '/logo192.png';
        
        img.onload = () => {
          // Draw logo to canvas and get DataURL
          const canvas = document.createElement('canvas');
          canvas.width = img.width;
          canvas.height = img.height;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, img.width, img.height);
          
          setLogoDataUrl(canvas.toDataURL('image/png'));
        };
        
        img.onerror = () => {
          console.error("Logo could not be loaded");
        };
      } catch (error) {
        console.error("Logo loading error:", error);
      }
    };
    
    loadLogo();
  }, []);
  
  // PDF generation function
  const generatePDF = async () => {
    const reportElement = document.getElementById('analysis-report');
    
    if (!reportElement) {
      console.error('Report element not found');
      return;
    }
    
    // Show loading overlay
    setLoading(true);
    setProgress(5);
    
    try {
      // Calculate content height      
      // Set PDF page size based on content
      const pageWidth = 210; // A4 width (mm)
      const pageHeight = 297; // Standard A4 height (mm). Additional pages will be added automatically.
      // contentHeight * 0.3528
      // Create PDF
      const pdf = new jsPDF({
        orientation: 'portrait',
        unit: 'mm',
        format: [pageWidth, pageHeight]
      });
      
      setProgress(10);
      
      // Margin values
      const marginLeft = 20;
      const marginRight = 20;
      
      // Content width
      const contentWidth = pageWidth - marginLeft - marginRight;
      
      // 30mm space for logo and title
      const topMargin = 40;
      
    let yPosition = topMargin;
    let sectionNumber = 2;
    const baseLineHeight = 6;
      
      // ----- COVER TITLE -----
      
      // Add logo
      if (logoDataUrl) {
        try {
          const logoWidth = 50;
          const logoHeight = 50;
          const logoX = (pageWidth - logoWidth) / 2;
          const logoY = yPosition;
          
          pdf.addImage(logoDataUrl, 'PNG', logoX, logoY, logoWidth, logoHeight);
          yPosition += logoHeight + 20;
        } catch (error) {
          console.error("Error adding logo to PDF:", error);
        }
      }
      
      // Report title
      pdf.setFontSize(28);
      pdf.setTextColor(40, 40, 40);
      pdf.setFont('helvetica', 'bold');
      pdf.text('BIOMARKER', pageWidth / 2, yPosition, { align: 'center' });
      yPosition += 15;
      pdf.text('ANALYSIS REPORT', pageWidth / 2, yPosition, { align: 'center' });
      yPosition += 20;
      
      // Decorative line
      pdf.setDrawColor(74, 109, 167);
      pdf.setLineWidth(1);
      pdf.line(marginLeft + 30, yPosition, pageWidth - marginRight - 30, yPosition);
      yPosition += 20;
      
      // Subtitle
      pdf.setFontSize(16);
      pdf.setTextColor(80, 80, 80);
      pdf.setFont('helvetica', 'italic');
      pdf.text('Comprehensive Analysis Results', pageWidth / 2, yPosition, { align: 'center' });
      yPosition += 20;
      
      // Class info - List all analyzed pairs
      pdf.setFontSize(12); // Adjusted font size
      pdf.setTextColor(90, 90, 90);
      pdf.setFont('helvetica', 'normal');
      
      if (Object.keys(groupedAnalyses).length > 0) {
        Object.keys(groupedAnalyses).forEach(classPair => {
          if (yPosition > pageHeight - 50) { // New page if near end
            pdf.addPage();
            yPosition = topMargin - 20;
          }
          pdf.text(`Comparing: ${classPair}`, pageWidth / 2, yPosition, { align: 'center' });
          yPosition += 8;
        });
      } else if (selectedClasses && Array.isArray(selectedClasses)) {
        // If selectedClasses is an array of class pairs (for multiple analyses)
        selectedClasses.forEach(classPair => {
          if (yPosition > pageHeight - 50) {
            pdf.addPage();
            yPosition = topMargin - 20;
          }
          pdf.text(`Comparing: ${classPair}`, pageWidth / 2, yPosition, { align: 'center' });
          yPosition += 8;
        });
      } else if (selectedClasses && typeof selectedClasses === 'string') {
        // Fallback for single string
        pdf.text(`Comparing: ${selectedClasses}`, pageWidth / 2, yPosition, { align: 'center' });
        yPosition += 8;
      }
      yPosition += 12;
      
      // Decorative bottom line
      pdf.setDrawColor(220, 220, 220);
      pdf.setLineWidth(0.5);
      pdf.line(marginLeft + 40, yPosition, pageWidth - marginRight - 40, yPosition);
      yPosition += 20;
      
      // Corporate info
      pdf.setFontSize(10);
      pdf.setTextColor(150, 150, 150);
      pdf.text('Biomark - Biomarker Analysis Tool © ' + new Date().getFullYear(), pageWidth / 2, yPosition, { align: 'center' });
      yPosition += 10;
      pdf.text('All Rights Reserved', pageWidth / 2, yPosition, { align: 'center' });
      yPosition += 30;
      pdf.addPage();
      yPosition = topMargin - 20;
      // ----- ANALYSIS SUMMARY -----
      
      // Section title
      pdf.setFontSize(16);
      pdf.setTextColor(60, 60, 60);
      pdf.setFont('helvetica', 'bold');
      pdf.text('1. Analysis Summary', marginLeft, yPosition);
      yPosition += 10;
      
      // Bottom line
      pdf.setDrawColor(74, 109, 167);
      pdf.setLineWidth(0.5);
      pdf.line(marginLeft, yPosition, marginLeft + 50, yPosition);
      yPosition += 15;
      
      // Summary info - now by grouped analyses
      pdf.setFontSize(10);
      pdf.setFont('helvetica', 'normal');
      pdf.setTextColor(80, 80, 80);
      
      const leftColumnX = marginLeft;
      const lineHeight = baseLineHeight;

      // Dataset filename info
      if (datasetNameList.length > 0) {
        pdf.setFont('helvetica', 'bold');
        pdf.text(datasetNameList.length > 1 ? 'Dataset Files:' : 'Dataset Filename:', leftColumnX, yPosition);
        pdf.setFont('helvetica', 'normal');
        const maxLineWidth = contentWidth - 40;
        const lines = pdf.splitTextToSize(datasetNamesDisplay, maxLineWidth);
        pdf.text(lines, leftColumnX + 40, yPosition);
        yPosition += lineHeight * lines.length + 5;

        pdf.setFont('helvetica', 'bold');
        pdf.text('Normalization:', leftColumnX, yPosition);
        pdf.setFont('helvetica', 'normal');
        const normalizationText = normalizationSummaryLines.join('\n');
        const normLines = pdf.splitTextToSize(normalizationText, maxLineWidth);
        pdf.text(normLines, leftColumnX + 40, yPosition);
        yPosition += lineHeight * normLines.length + 6;
      }

      if (Object.keys(groupedAnalyses).length > 0) {
        let globalAnalysisIndex = 1;
        for (const [classPair, analysesInGroup] of Object.entries(groupedAnalyses)) {
          if (yPosition > pageHeight - 70) { pdf.addPage(); yPosition = topMargin - 20; }
          
          pdf.setFontSize(12);
          pdf.setFont('helvetica', 'bold');
          pdf.setTextColor(65, 65, 65);
          pdf.text(classPair, leftColumnX, yPosition);
          yPosition += lineHeight + 2;
          pdf.setDrawColor(150,150,150);
          pdf.setLineWidth(0.2);
          pdf.line(leftColumnX, yPosition, pageWidth - marginRight, yPosition);
          yPosition += lineHeight + 2;

          for (const analysis of analysesInGroup) {
            if (yPosition > pageHeight - 60) { pdf.addPage(); yPosition = topMargin - 20; }
            
            pdf.setFontSize(11);
            pdf.setFont('helvetica', 'bold');
            pdf.setTextColor(70, 70, 70);
            // Use global index that increments across all groups
            pdf.text(`Analysis ${globalAnalysisIndex}`, leftColumnX + 5, yPosition);
            yPosition += lineHeight;

            pdf.setFontSize(10);
            pdf.setFont('helvetica', 'normal');
            pdf.setTextColor(80, 80, 80);

            // Analysis date
            pdf.setFont('helvetica', 'bold');
            pdf.text('Analysis Date:', leftColumnX + 10, yPosition);
            pdf.setFont('helvetica', 'normal');
            pdf.text(analysis.date || 'N/A', leftColumnX + 40, yPosition);
            yPosition += lineHeight;

            // Analysis types
            pdf.setFont('helvetica', 'bold');
            pdf.text('Analysis Types:', leftColumnX + 10, yPosition);
            pdf.setFont('helvetica', 'normal');
            const analysisTypesText = buildAnalysisTypesText(analysis.types);
            const splitTypes = pdf.splitTextToSize(analysisTypesText, contentWidth - 30);
            pdf.text(splitTypes, leftColumnX + 40, yPosition);
            yPosition += lineHeight * splitTypes.length;
            
            // Execution time
            pdf.setFont('helvetica', 'bold');
            pdf.text('Execution Time:', leftColumnX + 10, yPosition);
            pdf.setFont('helvetica', 'normal');
            pdf.text(analysis.time || 'N/A', leftColumnX + 40, yPosition);
            yPosition += lineHeight;

            // Resampling / class imbalance handling
            const resMethod = analysis.parameters?.resamplingMethod;
            if (resMethod) {
              const resParams = analysis.parameters?.resamplingParams || {};
              const methodLabel = resMethod.toUpperCase();
              const resParts = [];
              if (methodLabel === 'SMOTE') {
                resParts.push(`k_neighbors=${resParams.k_neighbors ?? 5}`);
              } else if (methodLabel === 'ADASYN') {
                resParts.push(`n_neighbors=${resParams.n_neighbors ?? 5}`);
              }
              if (resParams.sampling_strategy) resParts.push(`strategy=${resParams.sampling_strategy}`);
              const resamplingText = resParts.length ? `${methodLabel} (${resParts.join(', ')})` : methodLabel;
              if (yPosition > pageHeight - 30) { pdf.addPage(); yPosition = topMargin - 20; }
              pdf.setFont('helvetica', 'bold');
              pdf.text('Resampling:', leftColumnX + 10, yPosition);
              pdf.setFont('helvetica', 'normal');
              pdf.text(resamplingText, leftColumnX + 40, yPosition);
              yPosition += lineHeight;
            }
            yPosition += 5;
            globalAnalysisIndex++;
          }
          
          yPosition += 5;
        }
      } else {
        // Fallback if no groupedAnalyses (old global info)
        pdf.setFont('helvetica', 'bold');
        pdf.text('Analysis Date:', leftColumnX, yPosition);
        pdf.setFont('helvetica', 'normal');
        pdf.text(analysisDate || 'N/A', leftColumnX + 30, yPosition);
        yPosition += lineHeight;
      }
      yPosition += 10;

      // ----- STATISTICAL ANALYSIS RESULTS -----
      if (hasSummariesSection) {
        if (yPosition > pageHeight - 40) {
          pdf.addPage();
          yPosition = topMargin - 20;
        }
        // Section title
        pdf.setFontSize(16);
        pdf.setTextColor(60, 60, 60);
        pdf.setFont('helvetica', 'bold');
        pdf.text(`${sectionNumber}. Statistical Method Results`, marginLeft, yPosition);
        yPosition += 10;
        
        // Bottom line
        pdf.setDrawColor(74, 109, 167);
        pdf.setLineWidth(0.5);
        pdf.line(marginLeft, yPosition, marginLeft + 70, yPosition);
        yPosition += 15;
        
        // Add summary image - summarizeAnalyses already comes by classPair
        for (let k = 0; k < summarizeAnalyses.length; k++) {
          const summaryAnalysis = summarizeAnalyses[k];
          if (yPosition > pageHeight - 80) { pdf.addPage(); yPosition = topMargin - 20; }

          pdf.setFontSize(12);
          pdf.setFont('helvetica', 'bold');
          pdf.setTextColor(70, 70, 70);
          // classPair = ClassA_vs_ClassB_vs_ClassC -> ClassA vs ClassB vs ClassC
          // not ClassA vs vs vs ClassB vs vs vs ClassC
          const formattedClassPair = summaryAnalysis.classPair ? summaryAnalysis.classPair.replaceAll('_', ' ') : 'All Classes';
          pdf.text(`Summary for: ${formattedClassPair}`, marginLeft, yPosition);
          yPosition += 8;

          try {
            // Load the summary image directly (avoid html2canvas and DOM dependency)
            const img = new Image();
            img.crossOrigin = 'Anonymous';
            // Use buildUrl to construct proper URL with base URL
            img.src = summaryAnalysis.imagePath.startsWith('http') 
              ? summaryAnalysis.imagePath 
              : buildUrl(`/${summaryAnalysis.imagePath}`);

            await new Promise((resolve, reject) => {
              img.onload = () => resolve();
              img.onerror = () => reject(new Error(`Failed to load image: ${summaryAnalysis.imagePath.split('/').pop()}`));
              setTimeout(() => reject(new Error('Image loading timeout')), 15000);
            });

            const canvas = document.createElement('canvas');
            const scaleFactor = 2;
            canvas.width = img.width * scaleFactor;
            canvas.height = img.height * scaleFactor;
            const ctx = canvas.getContext('2d');
            ctx.scale(scaleFactor, scaleFactor);
            ctx.drawImage(img, 0, 0, img.width, img.height);

            const imgData = canvas.toDataURL('image/jpeg', 0.85);
            const aspectRatio = img.width / img.height;
            let imgWidth = contentWidth;
            let imgHeight = imgWidth / aspectRatio;

            const maxImgHeight = pageHeight * 0.6;
            if (imgHeight > maxImgHeight) {
              imgHeight = maxImgHeight;
              imgWidth = imgHeight * aspectRatio;
            }

            if (yPosition + imgHeight > pageHeight - 30) {
              pdf.addPage();
              yPosition = topMargin - 20;
              pdf.setFontSize(12);
              pdf.setFont('helvetica', 'bold');
              pdf.setTextColor(70, 70, 70);
              const formattedClassPairContinued = summaryAnalysis.classPair ? summaryAnalysis.classPair.replaceAll('_', ' ') : 'All Classes';
              pdf.text(`Summary for: ${formattedClassPairContinued} (Continued)`, marginLeft, yPosition);
              yPosition += 8;
            }

            pdf.addImage(imgData, 'JPEG', marginLeft + (contentWidth - imgWidth) / 2, yPosition, imgWidth, imgHeight);
            yPosition += imgHeight + 15;
          } catch (error) {
            console.error('Error adding image:', error);
            if (yPosition > pageHeight - 30) { pdf.addPage(); yPosition = topMargin - 20; }
            pdf.setFontSize(10);
            pdf.setTextColor(255, 0, 0);
            pdf.text(`*Summary image for ${summaryAnalysis.classPair} failed: ${error.message}`, marginLeft, yPosition);
            yPosition += 10;
          }
          yPosition += 10;
        }

        sectionNumber += 1;
      }
      
      // ----- ENRICHMENT ANALYSES -----
      if (hasEnrichmentAnalyses) {
        if (yPosition > pageHeight - 40) {
          pdf.addPage();
          yPosition = topMargin - 20;
        }

        pdf.setFontSize(16);
        pdf.setTextColor(60, 60, 60);
        pdf.setFont('helvetica', 'bold');
        pdf.text(`${sectionNumber}. Enrichment Analyses`, marginLeft, yPosition);
        yPosition += 10;

        pdf.setDrawColor(74, 109, 167);
        pdf.setLineWidth(0.5);
        pdf.line(marginLeft, yPosition, marginLeft + 80, yPosition);
        yPosition += 15;

        pdf.setFontSize(10);
        pdf.setFont('helvetica', 'normal');
        pdf.setTextColor(80, 80, 80);

        const tableBorderColor = { r: 215, g: 226, b: 255 };
        const tableHeaderFill = { r: 234, g: 240, b: 255 };
        const tableStripeFill = { r: 244, g: 247, b: 255 };
        const tableTextColor = { r: 43, g: 54, b: 90 };
        const tablePaddingX = 2;
        const tablePaddingY = 1.8;
        const tableRowLineHeight = 4.2;
        const tableHeaderHeight = lineHeight + 2;
        const columnWeightMap = {
          '#': 0.07,
          Pathway: 0.26,
          Overlap: 0.1,
          'Adjusted p-value': 0.14,
          'Raw p-value': 0.14,
          'Odds ratio': 0.11,
          Genes: 0.18
        };

        const drawEnrichmentTable = (headers, rows) => {
          if (!Array.isArray(headers) || headers.length === 0 || !Array.isArray(rows) || rows.length === 0) {
            return false;
          }

          const columnCount = headers.length;
          const defaultWeight = 1 / columnCount;
          const weights = headers.map((header) => columnWeightMap[header] ?? defaultWeight);
          const totalWeight = weights.reduce((sum, w) => sum + w, 0) || 1;
          const columnWidths = weights.map((weight, idx) => {
            if (idx === columnCount - 1) {
              const allocated = weights.slice(0, idx).reduce((sum, w) => sum + w, 0);
              return contentWidth - (allocated / totalWeight) * contentWidth;
            }
            return (weight / totalWeight) * contentWidth;
          });
          const columnOffsets = headers.map((_, idx) => {
            if (idx === 0) return marginLeft;
            const widthSum = columnWidths.slice(0, idx).reduce((sum, width) => sum + width, 0);
            return marginLeft + widthSum;
          });

          const headerLineSets = headers.map((header, colIdx) => {
            const cellWidth = Math.max(columnWidths[colIdx] - tablePaddingX * 2, 10);
            const lines = pdf.splitTextToSize(sanitizeKeggCell(header) || 'Unnamed', cellWidth);
            return lines.length > 0 ? lines : [''];
          });
          const headerRowHeight = Math.max(
            tableHeaderHeight,
            Math.max(...headerLineSets.map((lines) => Math.max(lines.length, 1))) * tableRowLineHeight + tablePaddingY * 2
          );

          const renderHeader = () => {
            if (yPosition > pageHeight - 30) {
              pdf.addPage();
              yPosition = topMargin - 20;
            }
            pdf.setFont('helvetica', 'bold');
            pdf.setFontSize(10);
            pdf.setTextColor(tableTextColor.r, tableTextColor.g, tableTextColor.b);
            headers.forEach((header, colIdx) => {
              const cellX = columnOffsets[colIdx];
              const cellWidth = columnWidths[colIdx];
              pdf.setDrawColor(tableBorderColor.r, tableBorderColor.g, tableBorderColor.b);
              pdf.setFillColor(tableHeaderFill.r, tableHeaderFill.g, tableHeaderFill.b);
              pdf.rect(cellX, yPosition, cellWidth, headerRowHeight, 'FD');
              const headerLines = headerLineSets[colIdx];
              headerLines.forEach((line, lineIdx) => {
                pdf.text(line, cellX + tablePaddingX, yPosition + tablePaddingY + tableRowLineHeight * (lineIdx + 0.7));
              });
            });
            yPosition += headerRowHeight;
          };

          const renderRow = (lineSets, rowHeight, isStriped) => {
            pdf.setDrawColor(tableBorderColor.r, tableBorderColor.g, tableBorderColor.b);
            pdf.setFont('helvetica', 'normal');
            pdf.setFontSize(9);
            pdf.setTextColor(tableTextColor.r, tableTextColor.g, tableTextColor.b);
            headers.forEach((_, colIdx) => {
              const cellX = columnOffsets[colIdx];
              const cellWidth = columnWidths[colIdx];
              const fillColor = isStriped ? tableStripeFill : { r: 255, g: 255, b: 255 };
              pdf.setFillColor(fillColor.r, fillColor.g, fillColor.b);
              pdf.rect(cellX, yPosition, cellWidth, rowHeight, 'FD');
              const textLines = lineSets[colIdx].length > 0 ? lineSets[colIdx] : [''];
              textLines.forEach((line, lineIdx) => {
                pdf.text(line, cellX + tablePaddingX, yPosition + tablePaddingY + tableRowLineHeight * (lineIdx + 0.7));
              });
            });
            yPosition += rowHeight;
          };

          renderHeader();

          rows.forEach((row, rowIdx) => {
            const lineSets = headers.map((_, colIdx) => {
              const cellWidth = Math.max(columnWidths[colIdx] - tablePaddingX * 2, 8);
              return pdf.splitTextToSize(sanitizeKeggCell(row[colIdx]), cellWidth);
            });
            const maxLines = Math.max(...lineSets.map((lines) => Math.max(lines.length, 1)));
            const rowHeight = maxLines * tableRowLineHeight + tablePaddingY * 2;
            if (yPosition + rowHeight > pageHeight - 20) {
              pdf.addPage();
              yPosition = topMargin - 20;
              renderHeader();
            }
            renderRow(lineSets, rowHeight, rowIdx % 2 === 1);
          });

          yPosition += 6;
          return true;
        };

        enrichmentAnalyses.forEach((entry, index) => {
          if (yPosition > pageHeight - 60) {
            pdf.addPage();
            yPosition = topMargin - 20;
          }

          const friendlyPair = entry.classPair ? entry.classPair.replaceAll('_', ' ') : `Analysis ${index + 1}`;
          const displayName = entry.analysisDisplayName || entry.analysisType || 'Pathway Enrichment';
          pdf.setFont('helvetica', 'bold');
          pdf.setFontSize(12);
          pdf.setTextColor(70, 70, 70);
          pdf.text(`${displayName} (${friendlyPair})`, marginLeft, yPosition);
          yPosition += lineHeight;

          if (entry.summary) {
            const summaryLines = pdf.splitTextToSize(entry.summary, contentWidth);
            pdf.setFont('helvetica', 'normal');
            pdf.setFontSize(10);
            pdf.setTextColor(tableTextColor.r, tableTextColor.g, tableTextColor.b);
            summaryLines.forEach((line) => {
              if (yPosition > pageHeight - 30) {
                pdf.addPage();
                yPosition = topMargin - 20;
              }
              pdf.text(line, marginLeft, yPosition);
              yPosition += lineHeight - 1;
            });
            yPosition += 2;
          }

          pdf.setFont('helvetica', 'normal');
          pdf.setFontSize(10);
          pdf.setTextColor(80, 80, 80);
          const metricLine = `Input genes: ${entry.inputGeneCount ?? 'N/A'}    Significant pathways: ${entry.significantPathwayCount ?? 'N/A'} / ${entry.totalPathways ?? 'N/A'}`;
          const metricLines = pdf.splitTextToSize(metricLine, contentWidth);
          metricLines.forEach((line) => {
            if (yPosition > pageHeight - 25) {
              pdf.addPage();
              yPosition = topMargin - 20;
            }
            pdf.text(line, marginLeft, yPosition);
            yPosition += lineHeight - 1;
          });
          yPosition += 2;

          const rows = Array.isArray(entry.table?.rows) ? entry.table.rows : [];
          const columns = buildKeggColumns(entry.table);
          const displayedRows = rows.slice(0, ENRICHMENT_REPORT_PREVIEW_LIMIT);
          const tableHeaders = columns.map((column) => column.label);
          const tableRows = displayedRows.map((row, rowIdx) => columns.map((column) => column.getValue(row, rowIdx)));
          const tableDrawn = drawEnrichmentTable(tableHeaders, tableRows);

          if (!tableDrawn) {
            if (yPosition > pageHeight - 30) {
              pdf.addPage();
              yPosition = topMargin - 20;
            }
            pdf.setFont('helvetica', 'italic');
            pdf.setFontSize(9);
            pdf.setTextColor(110, 110, 110);
            
            // Check if we have a download URL to provide
            if (entry.downloadUrl || entry.rawPath) {
              pdf.text('Table preview not available. Download the CSV file to view full results.', marginLeft, yPosition);
              yPosition += lineHeight;
              
              if (entry.downloadUrl) {
                pdf.setFont('helvetica', 'bold');
                pdf.setTextColor(47, 79, 181);
                const downloadLink = entry.downloadUrl || buildBackendUrl(entry.rawPath); // CHANGE AFTER DEPLOYMENT
                pdf.textWithLink('Download CSV', marginLeft, yPosition, { url: downloadLink });
                yPosition += lineHeight;
                pdf.setFont('helvetica', 'italic');
                pdf.setTextColor(110, 110, 110);
              }
            } else {
              pdf.text('No pathway table was returned for this run.', marginLeft, yPosition);
              yPosition += lineHeight;
            }
          } else {
            if (yPosition > pageHeight - 20) {
              pdf.addPage();
              yPosition = topMargin - 20;
            }
            pdf.setFont('helvetica', 'italic');
            pdf.setFontSize(9);
            pdf.setTextColor(110, 110, 110);
            const footnoteText = rows.length > displayedRows.length
              ? `Showing top ${displayedRows.length} of ${rows.length} pathways. Download the CSV for the complete list.`
              : `Showing top ${displayedRows.length} pathways. Download the CSV to keep a copy.`;
            const footnoteLines = pdf.splitTextToSize(footnoteText, contentWidth);
            footnoteLines.forEach((line) => {
              if (yPosition > pageHeight - 20) {
                pdf.addPage();
                yPosition = topMargin - 20;
              }
              pdf.text(line, marginLeft, yPosition);
              yPosition += lineHeight - 1;
            });
            yPosition += 1;

            if (entry.downloadUrl) {
              if (yPosition > pageHeight - 20) {
                pdf.addPage();
                yPosition = topMargin - 20;
              }
              pdf.setFont('helvetica', 'bold');
              pdf.setFontSize(9);
              pdf.setTextColor(47, 79, 181);
              const linkLabel = `Download ${displayName} results CSV`;
              pdf.textWithLink(linkLabel, marginLeft, yPosition, { url: entry.downloadUrl });
              yPosition += lineHeight;
              pdf.setFont('helvetica', 'normal');
              pdf.setTextColor(80, 80, 80);
            }
          }

          yPosition += 8;
        });

        sectionNumber += 1;
      }

      // ----- DETAILED ANALYSIS RESULTS (Charts) -----
      // Check if there are any images to display (excluding biomarker summaries which are already shown)
      const hasNonBiomarkerImages = Object.values(groupedAnalyses).some(analysesInGroup => 
        analysesInGroup.some(analysis => analysis.images && analysis.images.length > 0)
      );
      
      if (Object.keys(groupedAnalyses).length > 0 && hasNonBiomarkerImages) {
        if (yPosition > pageHeight - 40) { pdf.addPage(); yPosition = topMargin - 20; }
        // Section title
        pdf.setFontSize(16);
        pdf.setTextColor(60, 60, 60);
        pdf.setFont('helvetica', 'bold');
        pdf.text(`${sectionNumber}. Analysis Results`, marginLeft, yPosition);
        yPosition += 10;
        
        // Bottom line
        pdf.setDrawColor(74, 109, 167);
        pdf.setLineWidth(0.5);
        pdf.line(marginLeft, yPosition, marginLeft + 85, yPosition);
        yPosition += 15;
        
        let groupIdxForResults = 0;
        for (const [classPair, analysesInGroup] of Object.entries(groupedAnalyses)) {
          if (yPosition > pageHeight - 60) { pdf.addPage(); yPosition = topMargin - 20; }

          pdf.setFontSize(14);
          pdf.setFont('helvetica', 'bold');
          pdf.setTextColor(65, 65, 65);
          pdf.text(classPair, marginLeft, yPosition);
          yPosition += 8;
           pdf.setDrawColor(180,180,180);
           pdf.setLineWidth(0.2);
           pdf.line(marginLeft, yPosition, pageWidth - marginRight, yPosition);
           yPosition += 10;

          let analysisIdxInResults = 0;
          for (const analysis of analysesInGroup) {
            if (yPosition > pageHeight - 50) { pdf.addPage(); yPosition = topMargin - 20; }
            
            pdf.setFontSize(12);
            pdf.setTextColor(70, 70, 70);
            pdf.setFont('helvetica', 'bold');
            // analysis.title (e.g., "Analysis 1") should already include this.
            pdf.text(analysis.title ? `${analysis.title.replace(/Analysis \d+/, `Analysis ${analysisIdxInResults + 1}`)} for ${classPair}` : `Analysis ${analysisIdxInResults + 1} for ${classPair}`, marginLeft + 5, yPosition);
            yPosition += 8;
            
            if (analysis.images && analysis.images.length > 0) {
              for (let j = 0; j < analysis.images.length; j++) {
                try {
                  if (analysis.images[j].path) {
                    if (yPosition > pageHeight - 80 && !(j === 0 && analysisIdxInResults === 0 && groupIdxForResults === 0)) {
                       pdf.addPage(); 
                       yPosition = topMargin - 20; 
                    }

                    // Image caption
                    if (analysis.images[j].caption) {
                      pdf.setFontSize(10);
                      pdf.setTextColor(100, 100, 100);
                      pdf.setFont('helvetica', 'italic');
                      const splitCaption = pdf.splitTextToSize(analysis.images[j].caption, contentWidth);
                      pdf.text(splitCaption, marginLeft + 5, yPosition);
                      yPosition += 5 * splitCaption.length;
                    }
                    
                    const img = new Image();
                    img.crossOrigin = "Anonymous";
                    // Use buildUrl to construct proper URL with base URL
                    img.src = analysis.images[j].path.startsWith('http') 
                      ? analysis.images[j].path 
                      : buildUrl(`/${analysis.images[j].path}`);
                    
                    await new Promise((resolve, reject) => {
                      img.onload = () => {
                        resolve();
                      };
                      img.onerror = (err) => {
                        reject(new Error(`Failed to load image: ${analysis.images[j].path.split('/').pop()}`));
                      };
                      setTimeout(() => {
                        reject(new Error('Image loading timeout'));
                      }, 15000);
                    });
                    
                    const canvas = document.createElement('canvas');
                    const scaleFactor = 2;
                    canvas.width = img.width * scaleFactor;
                    canvas.height = img.height * scaleFactor;
                    const ctx = canvas.getContext('2d');
                    ctx.scale(scaleFactor, scaleFactor);
                    ctx.drawImage(img, 0, 0, img.width, img.height);
                    
                    const imgData = canvas.toDataURL('image/jpeg', 0.85);
                    const aspectRatio = img.width / img.height;
                    let imgPdfWidth = contentWidth;
                    let imgPdfHeight = imgPdfWidth / aspectRatio;

                    // Adjust image size to prevent page overflow
                    const maxImgHeight = pageHeight * 0.7;
                    if (imgPdfHeight > maxImgHeight) {
                        imgPdfHeight = maxImgHeight;
                        imgPdfWidth = imgPdfHeight * aspectRatio;
                    }
                    if (imgPdfWidth > contentWidth) {
                        imgPdfWidth = contentWidth;
                        imgPdfHeight = imgPdfWidth / aspectRatio;
                    }

                    if (yPosition + imgPdfHeight > pageHeight - 25) {
                      pdf.addPage();
                      yPosition = topMargin - 20;
                       pdf.setFontSize(10);
                       pdf.setTextColor(100,100,100);
                       pdf.setFont('helvetica', 'italic');
                       pdf.text(analysis.images[j].caption + " (Continued)", marginLeft+5, yPosition);
                       yPosition +=5;
                    }
                    
                    pdf.addImage(imgData, 'JPEG', marginLeft + (contentWidth - imgPdfWidth) / 2, yPosition, imgPdfWidth, imgPdfHeight);
                    yPosition += imgPdfHeight + 10;
                  }
                } catch (error) {
                  if (yPosition > pageHeight - 30) { pdf.addPage(); yPosition = topMargin - 20; }
                  pdf.setFontSize(9);
                  pdf.setTextColor(255, 0, 0);
                  pdf.text(`*Image '${analysis.images[j].caption}' could not be loaded: ${error.message}`, marginLeft + 5, yPosition);
                  yPosition += 5;
                }
              }
            }
            yPosition += 5;
            analysisIdxInResults++;
          }
          if (groupIdxForResults < Object.keys(groupedAnalyses).length - 1) {
            yPosition += 10;
            if (yPosition > pageHeight - 30) { pdf.addPage(); yPosition = topMargin - 20; }
            pdf.setDrawColor(200,200,200);
            pdf.setLineWidth(0.3);
            pdf.line(marginLeft, yPosition, pageWidth-marginRight, yPosition);
            yPosition += 10;
          }
          groupIdxForResults++;
        }

        sectionNumber += 1;
      }

      // ----- EXTERNAL BIOMARKER VALIDATION TABLES -----
      const ensureSpace = (minHeight = 0) => {
        if (yPosition + minHeight > pageHeight - 20) {
          pdf.addPage();
          yPosition = topMargin - 20;
        }
      };

      const renderTableSection = (title, columns, rows) => {
        const safeColumns = Array.isArray(columns) && columns.length > 0 ? columns : [];
        const safeRows = Array.isArray(rows) ? rows : [];
        ensureSpace(12);
        pdf.setFontSize(12);
        pdf.setTextColor(60, 60, 60);
        pdf.setFont('helvetica', 'bold');
        pdf.text(title, marginLeft, yPosition);
        yPosition += 7;

        if (safeRows.length === 0 || safeColumns.length === 0) {
          pdf.setFontSize(10);
          pdf.setFont('helvetica', 'normal');
          pdf.setTextColor(100, 100, 100);
          pdf.text('No results available.', marginLeft, yPosition);
          yPosition += 8;
          return;
        }

        const colWidth = contentWidth / safeColumns.length;
        const baseRowHeight = 6;

        pdf.setFontSize(9);
        pdf.setFont('helvetica', 'bold');
        pdf.setTextColor(50, 50, 50);
        safeColumns.forEach((col, idx) => {
          const headerText = col.label || col.key;
          pdf.text(headerText, marginLeft + idx * colWidth, yPosition, { maxWidth: colWidth - 2 });
        });
        yPosition += baseRowHeight;

        pdf.setFont('helvetica', 'normal');
        pdf.setTextColor(70, 70, 70);

        safeRows.forEach((row) => {
          const cellLines = safeColumns.map((col) => {
            const value = row[col.key];
            if (col.key === 'link' && value) {
              return ['Open'];
            }
            if (Array.isArray(value)) {
              // sort values by score descending if possible
              if (value.length > 0 && value[0] && typeof value[0] === 'object' && typeof value[0].score === 'number') {
                value.sort((a, b) => b.score - a.score);
              }

              const normalizedItems = value.map((item) => {
                if (item && typeof item === 'object') {
                  const label = item.label ?? String(item ?? '');
                  const scoreText = item.score != null && typeof item.score === 'number' ? formatScore(item.score) : '';
                  return scoreText ? `${label} (${scoreText})` : label;
                }
                return String(item ?? '');
              });
              return pdf.splitTextToSize(normalizedItems.join(', '), colWidth - 2);
            }
            const normalized = (col.key === 'score' && typeof value === 'number'
              ? formatScore(value)
              : (value || '-'));
            return pdf.splitTextToSize(String(normalized), colWidth - 2);
          });

          const rowHeight = Math.max(...cellLines.map((lines) => lines.length)) * 5.2;
          ensureSpace(rowHeight);
          cellLines.forEach((lines, idx) => {
            const col = safeColumns[idx];
            const value = row[col.key];
            const x = marginLeft + idx * colWidth;
            if (col.key === 'link' && value) {
              const url = String(value);
              const linkLabel = 'Open';
              pdf.text(linkLabel, x, yPosition, { maxWidth: colWidth - 2 });
              pdf.setTextColor(47, 79, 181);
              pdf.text(linkLabel, x, yPosition, { maxWidth: colWidth - 2 });
              pdf.setTextColor(70, 70, 70);
              const linkWidth = Math.min(pdf.getTextWidth(linkLabel) + 2, colWidth - 2);
              pdf.link(x, yPosition - 4, linkWidth, 6, { url, target: '_blank' });
            } else {
              pdf.text(lines, x, yPosition, { maxWidth: colWidth - 2 });
            }
          });
          yPosition += rowHeight;
        });

        yPosition += 6;
      };

      if (hasValidationResults) {
        pdf.addPage();
        yPosition = topMargin - 20;
        processedValidations.forEach((validation, valIndex) => {
          ensureSpace(18);
          pdf.setFontSize(16);
          pdf.setTextColor(60, 60, 60);
          pdf.setFont('helvetica', 'bold');
          const validationTitle = processedValidations.length > 1 
            ? `${sectionNumber}. External Biomarker Validation ${valIndex + 1}`
            : `${sectionNumber}. External Biomarker Validation`;
          pdf.text(validationTitle, marginLeft, yPosition);
          yPosition += 10;

          pdf.setDrawColor(74, 109, 167);
          pdf.setLineWidth(0.5);
          pdf.line(marginLeft, yPosition, marginLeft + 95, yPosition);
          yPosition += 10;

          pdf.setFontSize(11);
          pdf.setFont('helvetica', 'normal');
          pdf.setTextColor(80, 80, 80);
          if (validation.classPairLabel) {
            pdf.text(`Class pair: ${validation.classPairLabel}`, marginLeft, yPosition);
            yPosition += 6;
          }
          if (validation.timestamp) {
            pdf.text(`Validated on: ${validation.timestamp}`, marginLeft, yPosition);
            yPosition += 6;
          }
          pdf.text(`Biomarkers checked: ${validation.biomarkerCount || validation.maxGenes || '-'}`, marginLeft, yPosition);
          yPosition += 6;
          pdf.text(`Limit: ${validation.maxGenes || '-'}`, marginLeft, yPosition);
          yPosition += 10;

          renderTableSection('Biomarker view', validation.views.biomarkers.columns, validation.views.biomarkers.rows);
          renderTableSection('Diseases view', validation.views.diseases.columns, validation.views.diseases.rows);
          renderTableSection('Detailed view', validation.views.detailed.columns, validation.views.detailed.rows);
        });

        sectionNumber += 1;
      }
      
      // Footer
      pdf.setFontSize(8);
      pdf.setTextColor(150, 150, 150);
      pdf.setFont('helvetica', 'italic');
      const currentDate = new Date().toLocaleString();
      const version = "2.3.0";
      
      // Leave enough space for footer
      yPosition += 5;
      
      // Footer line
      pdf.setDrawColor(200, 200, 200);
      pdf.setLineWidth(0.5);
      pdf.line(marginLeft, yPosition, pageWidth - marginRight, yPosition);
      yPosition += 15;
      
      // Footer text
      pdf.text(`This report was automatically generated by Biomark - Biomarker Analysis Tool v${version} on ${currentDate}`, pageWidth / 2, yPosition, { align: 'center' });
      
      // Save PDF
  pdf.save(`Biomarker_Analysis_Report_${new Date().toISOString().split('T')[0]}_${datasetSlug}.pdf`);
      
      setProgress(100);
      
      // Hide loading overlay after completion
      setTimeout(() => {
        setLoading(false);
        setProgress(0);
      }, 500);
    } catch (error) {
      setLoading(false);
      setProgress(0);
      alert('An error occurred while generating the report. Please try again.');
    }
  };

  // Version info
  const version = "2.3.0";

  const showValidationControls = Boolean(
    typeof onValidateBiomarkers === 'function'
      && canValidateBiomarkers
      && (!biomarkerValidationResult || biomarkerValidationLoading)
  );

  return (
    <div className="validation-panel">
      {showValidationControls && (
        <>
          {showValidationSeparator && (
            <div className="validation-or-separator" aria-hidden="true">
              <h1 className="or-text">OR</h1>
            </div>
          )}
          <div className="validation-action-bar">
            <label className="validation-select-label">
              Max genes per validation
              <select
                value={validationGeneCap ?? ''}
                onChange={onValidationGeneCapChange}
                disabled={biomarkerValidationLoading}
              >
                {validationGeneOptions.map((option) => (
                  <option key={option} value={option}>{option}</option>
                ))}
              </select>
            </label>
            <button
              className="biomarker-validation-button"
              onClick={onValidateBiomarkers}
              disabled={biomarkerValidationLoading}
            >
              {biomarkerValidationLoading ? 'Validating Biomarkers...' : 'Validate Biomarkers Externally'}
            </button>
            {biomarkerValidationError && (
              <div className="validation-status-row">
                <span className="validation-error-text">{biomarkerValidationError}</span>
              </div>
            )}
          </div>
        </>
      )}

      {showValidationSection && processedValidations.map((validation, valIndex) => {
        const currentView = validation.views[activeValidationView] || validation.views.detailed;
        const hasRowsInView = currentView.rows.length > 0;
        const topDiseaseSet = new Set(
          (Array.isArray(validation.topDiseases) ? validation.topDiseases : [])
            .map((name) => String(name ?? '').trim().toLowerCase())
            .filter(Boolean)
        );
        
        return (
          <div key={`validation-${valIndex}`} className="validation-results-panel">
            <div className="validation-results-header">
              <div>
                <h3>
                  External Biomarker Validation
                  {processedValidations.length > 1 && ` ${valIndex + 1}`}
                </h3>
                {validation.classPairLabel && (
                  <p className="validation-meta-line">Class pair: {validation.classPairLabel}</p>
                )}
                {validation.timestamp && (
                  <p className="validation-meta-line">Validated on: {validation.timestamp}</p>
                )}
              </div>
              <div className="validation-results-meta">
                {(validation.biomarkerCount || validation.maxGenes) && (
                  <span>Biomarker Count: {validation.biomarkerCount || validation.maxGenes}</span>
                )}
                {hasRowsInView && (
                  <button className="validation-download-button" onClick={() => handleDownloadValidationCsv(valIndex)}>
                    Download CSV
                  </button>
                )}
              </div>
            </div>
            <div className="validation-tabs" role="tablist" aria-label="Validation views">
              {validationTabOrder.map((tab) => (
                <button
                  key={tab.key}
                  type="button"
                  className={`validation-tab-button${activeValidationView === tab.key ? ' active' : ''}`}
                  onClick={() => setActiveValidationView(tab.key)}
                  role="tab"
                  aria-selected={activeValidationView === tab.key}
                  tabIndex={activeValidationView === tab.key ? 0 : -1}
                >
                  {tab.label}
                </button>
              ))}
            </div>
            <p className="validation-score-note">
              Association scores come from Open Targets (genes), JensenLab DISEASES (microRNAs), and EWAS Atlas (DNA methylation). Higher scores indicate stronger evidence. Scores are normalized to a 0-1 scale.
            </p>
            {hasRowsInView ? (
              <div className="validation-table-wrapper">
                <table className="validation-table">
                  <thead>
                    <tr>
                      {currentView.columns.map((column) => (
                        <th key={column.key}>{column.label || column.key}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {currentView.rows.map((row) => (
                      <tr key={row.__rowId}>
                        {currentView.columns.map((column) => {
                          let value = row[column.key];
                          if (column.key === 'diseases' && Array.isArray(value)) {
                            // sort diseases by score descending
                            const sortedDiseases = [...value].sort((a, b) => {
                              const scoreA = a?.score ?? 0;
                              const scoreB = b?.score ?? 0;
                              return scoreB - scoreA;
                            });
                            value = sortedDiseases;
                          }
                          if (column.key === 'biomarkers' && Array.isArray(value)) {
                            // sort biomarkers by score descending
                            const sortedBiomarkers = [...value].sort((a, b) => {
                              const scoreA = a?.score ?? 0;
                              const scoreB = b?.score ?? 0;
                              return scoreB - scoreA;
                            });
                            value = sortedBiomarkers;
                          }
                          if (column.key === 'source') {
                            const link = row.link;
                            return (
                              <td key={`${row.__rowId}-${column.key}`}>
                                {link ? (
                                  <a href={link} target="_blank" rel="noreferrer">{value || 'Source'}</a>
                                ) : (
                                  value || '-'
                                )}
                              </td>
                            );
                          }
                          if (column.key === 'score') {
                            return (
                              <td
                                key={`${row.__rowId}-${column.key}`}
                                style={{ color: getScoreColor(value) }}
                              >
                                {typeof value === 'number' ? formatScore(value) : '-'}
                              </td>
                            );
                          }
                          if (column.key === 'totalScore') {
                            const display = typeof value === 'number' ? formatTotalScore(value) : null;
                            return (
                              <td
                                key={`${row.__rowId}-${column.key}`}
                              >
                                {display ?? '-'}
                              </td>
                            );
                          }
                          if (column.key === 'disease') {
                            const diseaseLabel = String(value ?? '');
                            const isDiseasesView = activeValidationView === 'diseases';
                            const isTopDisease = isDiseasesView && topDiseaseSet.has(diseaseLabel.trim().toLowerCase());
                            return (
                              <td key={`${row.__rowId}-${column.key}`}>
                                <span style={isTopDisease ? { color: '#CC0011' } : undefined}>
                                  {diseaseLabel || '-'}
                                </span>
                              </td>
                            );
                          }
                          if (Array.isArray(value)) {
                            const hasScoredObjects = value.some((item) => item && typeof item === 'object');
                            if (hasScoredObjects) {
                              return (
                                <td key={`${row.__rowId}-${column.key}`}>
                                  {value.length ? value.map((item, idx) => {
                                    const label = item?.label ?? String(item ?? '');
                                    const score = item?.score;
                                    const displayScore = score != null ? formatScore(score) : null;
                                    const isBiomarkerViewDisease = activeValidationView === 'biomarkers' && column.key === 'diseases';
                                    const isTopDisease = isBiomarkerViewDisease && topDiseaseSet.has(String(label).trim().toLowerCase());
                                    return (
                                      <React.Fragment key={`${row.__rowId}-${column.key}-${idx}`}>
                                        <span style={isTopDisease ? { color: '#CC0011' } : undefined}>{label}</span>
                                        {displayScore ? (
                                          <span style={{ color: getScoreColor(score) }}>{` (${displayScore})`}</span>
                                        ) : null}
                                        {idx < value.length - 1 ? ', ' : ''}
                                      </React.Fragment>
                                    );
                                  }) : '-'}
                                </td>
                              );
                            }
                            return (
                              <td key={`${row.__rowId}-${column.key}`}>
                                {value.length ? value.join(', ') : '-'}
                              </td>
                            );
                          }
                          return (
                            <td key={`${row.__rowId}-${column.key}`}>
                              {value === 0 ? '0' : (value || '-')}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="validation-empty-state">No results are available for this view.</p>
            )}
          </div>
        );
      })}

      <div className="or-container">
        <h1 className="or-text">OR</h1>
      </div>

      <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '6px' }}>
        <button 
          className="generate-report-button" 
          onClick={generatePDF}
          title="Generate a professional PDF report of your analysis results"
          disabled={loading}
        >
          <i className="report-icon">{loading ? '➳' : '📊'}</i>
          {loading ? 'Generating Report...' : 'Generate Analysis Report'}
        </button>
      </div>
      
      {/* Loading Overlay */}
      {loading && (
        <div className="loading-overlay">
          <div className="loading-spinner"></div>
          <div className="loading-text">
            Generating your professional report... ({progress}%)
          </div>
          <div className="progress-bar">
            <div className="progress-bar-fill" style={{ width: `${progress}%` }}></div>
          </div>
        </div>
      )}
      
      {/* Hidden report template - html2canvas will be used for PDF generation */}
      <div id="analysis-report" className="hidden-report-template">
        <div className="report-content">
          {/* Cover Title */}
          <div className="report-header">
            <h1>BIOMARKER ANALYSIS REPORT</h1>
            <h2>Comprehensive Analysis Results</h2>
            {Object.keys(groupedAnalyses).length > 0 ? (
              Object.keys(groupedAnalyses).map(classPair => (
                <p key={classPair}>Comparing: {classPair}</p>
              ))
            ) : selectedClasses && Array.isArray(selectedClasses) ? (
              selectedClasses.map((classPair, idx) => (
                <p key={idx}>Comparing: {classPair}</p>
              ))
            ) : (
              selectedClasses && typeof selectedClasses === 'string' && (
                <p>Comparing: {selectedClasses}</p>
              )
            )}
          </div>

          {/* Analysis Summary */}
          <div className="report-section">
            <h3>1. Analysis Summary</h3>
            {datasetNameList.length > 0 && (
              <>
                <div className="info-row">
                  <span className="label">{datasetNameList.length > 1 ? 'Dataset Files:' : 'Dataset Filename:'}</span>
                  <span className="value">{datasetNamesDisplay}</span>
                </div>
                <div className="info-row normalization-info-row">
                  <span className="label">Normalization:</span>
                  <span className="value normalization-details-list">
                    {normalizationSummaryLines.map((line) => (
                      <span key={line} className="normalization-details-line">{line}</span>
                    ))}
                  </span>
                </div>
              </>
            )}
            {Object.keys(groupedAnalyses).length > 0 ? (
              Object.entries(groupedAnalyses).map(([classPair, analysesInGroup]) => (
                <div key={classPair} className="class-pair-summary-group">
                  <h4>{classPair}</h4>
                  {analysesInGroup.map((analysis, index) => (
                    <div key={analysis.title || index} className="analysis-summary-item">
                      <h5>{analysis.title ? analysis.title.replace(/Analysis \d+/, `Analysis ${index + 1}`) : `Analysis ${index + 1}`}</h5>
                      <div className="info-row">
                        <span className="label">Analysis Date:</span>
                        <span className="value">{analysis.date || 'N/A'}</span>
                      </div>
                      <div className="info-row">
                        <span className="label">Analysis Types:</span>
                        <span className="value">{buildAnalysisTypesText(analysis.types)}</span>
                      </div>
                      <div className="info-row">
                        <span className="label">Execution Time:</span>
                        <span className="value">{analysis.time || 'N/A'}</span>
                      </div>
                      {analysis.parameters?.resamplingMethod && (
                        <div className="info-row">
                          <span className="label">Resampling:</span>
                          <span className="value">
                            {(() => {
                              const m = analysis.parameters.resamplingMethod.toUpperCase();
                              const p = analysis.parameters.resamplingParams || {};
                              const parts = [];
                              if (m === 'SMOTE') parts.push(`k_neighbors=${p.k_neighbors ?? 5}`);
                              else if (m === 'ADASYN') parts.push(`n_neighbors=${p.n_neighbors ?? 5}`);
                              if (p.sampling_strategy) parts.push(`strategy=${p.sampling_strategy}`);
                              return parts.length ? `${m} (${parts.join(', ')})` : m;
                            })()}
                          </span>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ))
            ) : (
              <div className="summary-info"> {/* Fallback to old global summary if no grouped data */}
                 <div className="info-row">
                    <span className="label">Analysis Date:</span>
                    <span className="value">{analysisDate || 'N/A'}</span>
                  </div>
                  {/* ... other global fields ... */}
              </div>
            )}
          </div>

          {/* Statistical Analysis Results */}
          {hasSummariesSection && (
            <div className="report-section">
              <h3>{statisticalSectionNumber}. Statistical Method Results</h3>
              {summarizeAnalyses.map((analysis, index) => (
                <div key={index} className="summary-section" data-classpair={analysis.classPair}>
                  <h4>Analysis for {analysis.classPair}</h4>
                  <div className="summary-image">
                    <img
                      src={analysis.imagePath.startsWith('http') ? analysis.imagePath : buildUrl(`/${analysis.imagePath}`)}
                      alt={`Statistical Analysis for ${analysis.classPair}`}
                      crossOrigin="anonymous"
                    />
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Enrichment Analyses */}
          {hasEnrichmentAnalyses && (
            <div className="report-section">
              <h3>{enrichmentSectionNumber}. Enrichment Analyses</h3>
              <div className="kegg-analysis-results">
                {enrichmentAnalyses.map((entry, index) => {
                  const friendlyPair = entry.classPair ? entry.classPair.replaceAll('_', ' ') : 'All Classes';
                  const displayName = entry.analysisDisplayName || entry.analysisType || 'Pathway Enrichment';
                  const rows = Array.isArray(entry.table?.rows) ? entry.table.rows : [];
                  const columns = buildKeggColumns(entry.table);
                  const displayedRows = rows.slice(0, ENRICHMENT_REPORT_PREVIEW_LIMIT);
                  const hasTableData = displayedRows.length > 0;
                  const footnoteMessage = rows.length > displayedRows.length
                    ? `Showing top ${displayedRows.length} of ${rows.length} pathways. Download the CSV for the complete list.`
                    : `Showing top ${displayedRows.length} pathways. Download the CSV to keep a copy.`;
                  return (
                    <div key={entry.id || `${index}-${friendlyPair}`} className="kegg-analysis-card">
                      <h4 className="kegg-analysis-title">{displayName} ({friendlyPair})</h4>
                      {entry.summary && <p className="kegg-summary-text">{entry.summary}</p>}
                      <div className="kegg-stats-row">
                        <span><strong>Input genes:</strong> {entry.inputGeneCount ?? 'N/A'}</span>
                        <span><strong>Significant pathways:</strong> {entry.significantPathwayCount ?? 'N/A'} / {entry.totalPathways ?? 'N/A'}</span>
                      </div>
                      {entry.downloadUrl && (
                        <div className="kegg-download">
                          <a href={entry.downloadUrl} download className="kegg-download-link">
                            Download {displayName} results CSV
                          </a>
                        </div>
                      )}
                      {hasTableData ? (
                        <div className="kegg-table-wrapper">
                          <table className="kegg-table">
                            <thead>
                              <tr>
                                {columns.map((column, headerIdx) => (
                                  <th
                                    key={column.label || headerIdx}
                                    className={`kegg-table-header ${headerIdx === 0 ? 'kegg-table-header--index' : ''}`}
                                  >
                                    {column.label || 'Unnamed'}
                                  </th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {displayedRows.map((row, rowIdx) => (
                                <tr key={rowIdx}>
                                  {columns.map((column, cellIdx) => (
                                    <td
                                      key={column.label || cellIdx}
                                      className={`kegg-table-cell ${cellIdx === 0 ? 'kegg-table-cell--index' : ''}`}
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
                      ) : (
                        <p className="kegg-table-footnote">No pathway table was returned for this run.</p>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Detailed Analysis Results (Charts) */}
          {Object.keys(groupedAnalyses).length > 0 && (
            <div className="report-section">
              <h3>{analysisResultsSectionNumber}. Analysis Results</h3>
              {Object.entries(groupedAnalyses).map(([classPair, analysesInGroup]) => (
                <div key={classPair} className="class-pair-results-group">
                  <h4>{classPair}</h4>
                  {analysesInGroup.map((analysis, index) => (
                    <div key={analysis.title || index} className="analysis-result-item">
                      <h5>{analysis.title ? analysis.title.replace(/Analysis \d+/, `Analysis ${index + 1}`) : `Analysis ${index + 1}`}</h5>
                      {analysis.images?.map((image, imgIndex) => (
                        <div key={image.id || imgIndex} className="result-image">
                          {image.caption && <p className="image-caption">{image.caption}</p>}
                          <img
                            src={image.path.startsWith('http') ? image.path : buildUrl(`/${image.path}`)}
                            alt={image.caption || `Image ${imgIndex + 1} for ${analysis.title}`}
                            crossOrigin="anonymous"
                          />
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}

          {/* Footer */}
          <div className="report-footer">
            <p>This report was automatically generated by Biomarker Analysis Tool v{version} on {new Date().toLocaleString()}</p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AnalysisReport; 