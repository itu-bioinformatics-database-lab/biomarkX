const express = require('express');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const db = require('../db/database');

const router = express.Router();

const getPythonCommand = () => (process.platform === 'win32' ? 'python' : 'python3');

const toRelativeResultPath = (absolutePath) => {
  if (!absolutePath) {
    return absolutePath;
  }

  if (!path.isAbsolute(absolutePath)) {
    return absolutePath.replace(/\\/g, '/');
  }

  const serverRoot = path.join(__dirname, '..');
  return path.relative(serverRoot, absolutePath).replace(/\\/g, '/');
};

const ENRICHMENT_CONFIG = {
  KEGG: {
    geneSet: 'KEGG_2021_Human',
    analysisLabel: 'kegg_pathway_analysis',
    analysisDisplayName: 'KEGG Pathway Analysis',
  },
  GO_BP: {
    geneSet: 'GO_Biological_Process_2021',
    analysisLabel: 'go_biological_process',
    analysisDisplayName: 'GO Biological Process Enrichment',
  },
  GO_CC: {
    geneSet: 'GO_Cellular_Component_2021',
    analysisLabel: 'go_cellular_component',
    analysisDisplayName: 'GO Cellular Component Enrichment',
  },
  GO_MF: {
    geneSet: 'GO_Molecular_Function_2021',
    analysisLabel: 'go_molecular_function',
    analysisDisplayName: 'GO Molecular Function Enrichment',
  },
};

router.post('/pathway-analysis', async (req, res) => {
  const {
    analysisResults,
    selectedClasses = [],
    resultsDir = null,
    analysisType = 'KEGG',
    geneSet = null,
    analysisLabel = null,
    analysisDisplayName = null,
    analysisId = null, // Add analysis ID to associate pathway results
  } = req.body ?? {};

  const sanitizedGenes = Array.isArray(analysisResults)
    ? analysisResults
        .map((gene) => (typeof gene === 'string' ? gene.trim() : ''))
        .filter((gene) => gene.length > 0)
    : [];

  if (sanitizedGenes.length === 0) {
    return res.status(400).json({
      success: false,
      message: 'No significant genes provided for pathway analysis.',
    });
  }

  const pythonCommand = getPythonCommand();
  const scriptPath = path.join(__dirname, '..', 'services', 'pathway_analysis.py');

  let tempDir;
  let geneListFile;

  try {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'biomark-pathway-'));
    geneListFile = path.join(tempDir, 'significant_genes.json');
    fs.writeFileSync(geneListFile, JSON.stringify(sanitizedGenes), 'utf8');
  } catch (err) {
    console.error('Failed to prepare gene list for pathway analysis:', err);
    return res.status(500).json({
      success: false,
      message: 'Failed to prepare input for pathway analysis.',
    });
  }

  const sanitizedClasses = Array.isArray(selectedClasses)
    ? selectedClasses.map((cls) => String(cls).trim()).filter(Boolean)
    : [];
  const classPair = sanitizedClasses.length >= 2 ? `${sanitizedClasses[0]}_${sanitizedClasses[1]}` : '';

  let resolvedResultsDir = path.join(__dirname, '..', 'results');
  if (resultsDir) {
    resolvedResultsDir = path.isAbsolute(resultsDir)
      ? resultsDir
      : path.join(__dirname, '..', resultsDir);
  }

  const normalizedType = typeof analysisType === 'string' && analysisType.trim().length > 0
    ? analysisType.trim().toUpperCase()
    : 'KEGG';
  const defaultConfig = ENRICHMENT_CONFIG[normalizedType] || ENRICHMENT_CONFIG.KEGG;

  const resolvedGeneSet = geneSet || defaultConfig.geneSet;
  const resolvedAnalysisLabel = analysisLabel || defaultConfig.analysisLabel || normalizedType.toLowerCase();
  const resolvedDisplayName = analysisDisplayName || defaultConfig.analysisDisplayName || `${normalizedType} Enrichment`;

  const pythonArgs = [
    '-Xfrozen_modules=off',
    scriptPath,
    geneListFile,
    resolvedResultsDir,
    classPair,
    resolvedGeneSet,
    resolvedAnalysisLabel,
    resolvedDisplayName,
  ];

  console.log('Starting pathway analysis with command:', pythonCommand, pythonArgs.join(' '));

  const python = spawn(pythonCommand, pythonArgs);
  let stdout = '';
  let stderr = '';

  python.stdout.on('data', (data) => {
    stdout += data.toString();
  });

  python.stderr.on('data', (data) => {
    stderr += data.toString();
  });

  python.on('error', (spawnErr) => {
    console.error('Failed to start pathway analysis Python process:', spawnErr);
  });

  python.on('close', async (code) => {
    try {
      if (tempDir) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    } catch (cleanupErr) {
      console.warn('Failed to clean up temporary pathway analysis files:', cleanupErr);
    }

    if (code !== 0) {
      const trimmedStdout = stdout.trim();
      const trimmedStderr = stderr.trim();

      let parsedFailure = null;
      if (trimmedStdout) {
        try {
          parsedFailure = JSON.parse(trimmedStdout);
        } catch (parseStdoutErr) {
          console.warn('Pathway analysis failed and returned non-JSON stdout:', parseStdoutErr);
        }
      }

      if (!parsedFailure && trimmedStderr) {
        try {
          parsedFailure = JSON.parse(trimmedStderr);
        } catch (parseStderrErr) {
          console.warn('Pathway analysis failed and returned non-JSON stderr:', parseStderrErr);
        }
      }

      const resolvedMessage = parsedFailure?.message || 'Pathway analysis failed.';
      const resolvedError = parsedFailure?.error || trimmedStderr || trimmedStdout || `Process exited with code ${code}`;

      console.error('Pathway analysis Python script failed', {
        exitCode: code,
        message: resolvedMessage,
        error: resolvedError,
        stdout: trimmedStdout || null,
        stderr: trimmedStderr || null,
      });

      return res.status(500).json({
        success: false,
        message: resolvedMessage,
        error: resolvedError,
        data: parsedFailure?.data ?? null,
      });
    }

    try {
      const parsed = JSON.parse(stdout.trim());
      console.log('Pathway analysis output:', parsed);

      if (parsed?.data) {
        if (parsed.data.pathwayResults) {
          parsed.data.pathwayResults = toRelativeResultPath(parsed.data.pathwayResults);
        }
        parsed.data.analysisType = normalizedType;
      }

      // Save pathway analysis results to database if analysisId is provided
      if (analysisId && parsed.success && parsed.data?.pathwayResults) {
        try {
          const result = await db.query('SELECT analysis_metadata FROM analyses WHERE id = $1', [analysisId]);
          if (result.rows.length > 0) {
            let metadata = {};
            if (result.rows[0].analysis_metadata) {
              try {
                metadata = JSON.parse(result.rows[0].analysis_metadata);
              } catch (e) {
                console.error('Failed to parse existing metadata:', e);
              }
            }

            // Initialize pathwayAnalyses array if it doesn't exist
            if (!metadata.pathwayAnalyses) {
              metadata.pathwayAnalyses = [];
            }

            // Add this pathway analysis result
            metadata.pathwayAnalyses.push({
              type: normalizedType,
              analysisLabel: resolvedAnalysisLabel,
              displayName: resolvedDisplayName,
              geneSet: resolvedGeneSet,
              resultPath: parsed.data.pathwayResults,
              summary: parsed.data.summary || '',
              significantPathwayCount: parsed.data.significantPathwayCount || 0,
              totalPathways: parsed.data.totalPathways || 0,
              inputGeneCount: parsed.data.inputGeneCount || 0,
              timestamp: new Date().toISOString()
            });

            // Update the analysis metadata AND append to result_path
            const currentResult = await db.query('SELECT result_path FROM analyses WHERE id = $1', [analysisId]);
            let updatedResultPath = currentResult.rows[0]?.result_path || '';
            
            // Append the pathway analysis result to result_path
            if (parsed.data.pathwayResults) {
                const relativePath = toRelativeResultPath(parsed.data.pathwayResults);
                if (updatedResultPath) {
                    updatedResultPath += ',' + relativePath;
                } else {
                    updatedResultPath = relativePath;
                }
            }
            
            await db.query('UPDATE analyses SET analysis_metadata = $1, result_path = $2 WHERE id = $3',
              [JSON.stringify(metadata), updatedResultPath, analysisId]);
            
            console.log(`Saved ${normalizedType} pathway analysis to analysis ${analysisId} and added to result_path`);
          }
        } catch (dbErr) {
          console.error('Failed to save pathway analysis to database:', dbErr);
          // Don't fail the request if database save fails
        }
      }

      if (parsed.success) {
        return res.json(parsed);
      }

      return res.status(500).json({
        success: false,
        message: parsed.message || 'Pathway analysis failed.',
        error: parsed.error || null,
        data: parsed.data ?? null,
      });
    } catch (parseErr) {
      console.error('Failed to parse pathway analysis output:', parseErr, stdout);
      return res.status(500).json({
        success: false,
        message: 'Failed to parse pathway analysis output.',
        error: parseErr.toString(),
      });
    }
  });
});

module.exports = router;