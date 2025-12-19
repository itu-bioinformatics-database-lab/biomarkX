const Queue = require('bull');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const db = require('../db/database');

// Create the analysis queue
// Bull will use Redis at localhost:6379 by default
// If Redis is not available, it will fall back to in-memory (but won't persist)
const analysisQueue = new Queue('biomarker-analysis', {
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: process.env.REDIS_PORT || 6379,
  },
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 2000,
    },
    removeOnComplete: 100, // Keep last 100 completed jobs
    removeOnFail: 200, // Keep last 200 failed jobs
  },
});

// Helper function to get Python command
const getPythonCommand = () => {
  return process.platform === 'win32' ? 'python' : 'python3';
};

// Process analysis jobs
analysisQueue.process(async (job) => {
  const {
    analysisId,
    uploadId,
    uploadPath,
    originalName,
    sessionId,
    userId,
    illnessColumn,
    sampleColumn,
    selectedClasses,
    nonFeatureColumns,
    analysisMethods,
    mergedFileId,
    sourceFiles,
    useDefaultParams,
    customParams,
  } = job.data;

  console.log(`[Queue] Processing analysis ${analysisId}`);

  // Update status to 'processing'
  await db.query(
    'UPDATE analyses SET status = $1 WHERE id = $2',
    ['processing', analysisId]
  );

  // Report progress
  job.progress(10);

  const startTime = Date.now();

  return new Promise((resolve, reject) => {
    const pythonScript = path.join(__dirname, '..', 'services', 'analyze.py');
    
    // Fix undefined values for isDiffAnalysis
    const safeIsDiffAnalysis = customParams?.isDiffAnalysis || [
      ...(analysisMethods.statisticalTest || []),
      ...(analysisMethods.modelExplanation || [])
    ];
    const safeAfterFeatureSelection = customParams?.afterFeatureSelection === undefined 
      ? false 
      : customParams.afterFeatureSelection;
    
    const pythonArgs = [
      '-Xfrozen_modules=off',
      pythonScript,
      uploadPath,
      illnessColumn,
      sampleColumn,
      Array.isArray(selectedClasses) ? selectedClasses : [],
      Array.isArray(analysisMethods.statisticalTest) && analysisMethods.statisticalTest.length > 0 
        ? analysisMethods.statisticalTest.join(',') : '',
      Array.isArray(analysisMethods.dimensionalityReduction) && analysisMethods.dimensionalityReduction.length > 0 
        ? analysisMethods.dimensionalityReduction.join(',') : '',
      Array.isArray(analysisMethods.classificationAnalysis) && analysisMethods.classificationAnalysis.length > 0 
        ? analysisMethods.classificationAnalysis.join(',') : '',
      Array.isArray(analysisMethods.modelExplanation) && analysisMethods.modelExplanation.length > 0 
        ? analysisMethods.modelExplanation.join(',') : '',
      Array.isArray(nonFeatureColumns) ? nonFeatureColumns : [],
      Array.isArray(safeIsDiffAnalysis) ? safeIsDiffAnalysis.join(',') : '',
      String(safeAfterFeatureSelection)
    ];
    
    // If not using default parameters, add custom parameters
    if (!useDefaultParams && customParams) {
      pythonArgs.push('--params');
      pythonArgs.push(JSON.stringify({
        feature_type: customParams.featureType || "microRNA",
        reference_class: customParams.referenceClass || "",
        lime_global_explanation_sample_num: customParams.limeGlobalExplanationSampleNum || 50,
        shap_model_finetune: !!customParams.shapModelFinetune,
        lime_model_finetune: !!customParams.limeModelFinetune,
        scoring: customParams.scoring || "f1",
        feature_importance_finetune: !!customParams.featureImportanceFinetune,
        num_top_features: customParams.numTopFeatures || 20,
        plotter: customParams.plotter || "seaborn",
        dim: customParams.dim || "3D",
        param_finetune: !!customParams.paramFinetune,
        finetune_fraction: customParams.finetuneFraction || 1.0,
        save_best_model: customParams.saveBestModel !== false,
        standard_scaling: customParams.standardScaling !== false,
        save_data_transformer: customParams.saveDataTransformer !== false,
        save_label_encoder: customParams.saveLabelEncoder !== false,
        verbose: customParams.verbose !== false,
        use_preprocessing: customParams.usePreprocessing !== false,
        test_size: customParams.testSize || 0.2,
        n_folds: customParams.nFolds || 5,
        is_diff_analysis: Array.isArray(safeIsDiffAnalysis) ? safeIsDiffAnalysis.join(',') : '',
        after_feature_selection: String(safeAfterFeatureSelection)
      }));
    }

    console.log(`[Queue] Spawning Python process for analysis ${analysisId}`);
    const pythonProcess = spawn(getPythonCommand(), pythonArgs);

    let outputData = [];
    let stderrData = '';
    let categoricalEncodingInfo = null;
    let bestParams = null;

    pythonProcess.stdout.on('data', (data) => {
      const output = data.toString();
      console.log(`[Queue] Python stdout (${analysisId}):`, output);
      
      const lines = output.trim().split('\n');
      
      lines.forEach(line => {
        // Progress tracking
        if (line.includes('Progress:')) {
          const match = line.match(/Progress:\s*(\d+)%/);
          if (match) {
            const progress = parseInt(match[1]);
            job.progress(Math.min(progress, 90));
          }
        }
        
        // Categorical encoding info
        if (line.startsWith('CATEGORICAL_ENCODING_INFO:')) {
          try {
            categoricalEncodingInfo = JSON.parse(line.replace('CATEGORICAL_ENCODING_INFO:', '').trim());
          } catch (e) {
            console.error(`[Queue] Failed to parse categorical encoding info:`, e);
          }
        }
        
        // Best parameters
        if (line.startsWith('BEST_PARAMS:')) {
          try {
            const parsed = JSON.parse(line.replace('BEST_PARAMS:', '').trim());
            if (parsed && typeof parsed === 'object') {
              bestParams = parsed;
            }
          } catch (e) {
            console.error(`[Queue] Failed to parse BEST_PARAMS:`, e);
          }
        }
        
        // Filter result paths
        const resultsPrefix = path.join('results', '');
        if (line.trim().startsWith(resultsPrefix)) {
          outputData.push(line.trim());
        }
      });
    });

    pythonProcess.stderr.on('data', (data) => {
      const error = data.toString();
      stderrData += error;
      console.error(`[Queue] Python stderr (${analysisId}):`, error);
    });

    pythonProcess.on('close', async (code) => {
      const endTime = Date.now();
      const elapsedMs = endTime - startTime;
      const elapsedTime = formatElapsedTime(elapsedMs);
      
      if (code !== 0) {
        console.error(`[Queue] Python process failed for ${analysisId} with code ${code}`);
        
        // Update status to 'failed'
        await db.query(
          'UPDATE analyses SET status = $1 WHERE id = $2',
          ['failed', analysisId]
        );
        
        reject(new Error(`Analysis failed: ${stderrData || 'Unknown error'}`));
        return;
      }

      try {
        console.log(`[Queue] Python process completed successfully for ${analysisId}`);
        
        // Get existing metadata and add execution time
        const result = await db.query('SELECT analysis_metadata FROM analyses WHERE id = $1', [analysisId]);
        let metadata = {};
        
        if (result.rows[0]?.analysis_metadata) {
          try {
            metadata = JSON.parse(result.rows[0].analysis_metadata);
          } catch (e) {
            console.error('[Queue] Failed to parse existing metadata:', e);
          }
        }
        
        // Add execution time and best params
        metadata.executionTime = elapsedTime;
        if (bestParams && Object.keys(bestParams).length > 0) {
          metadata.bestParams = bestParams;
        }

        job.progress(95);

        // Update database with results
        await db.query(
          'UPDATE analyses SET result_path = $1, status = $2, analysis_metadata = $3 WHERE id = $4',
          [outputData.join(','), 'finished', JSON.stringify(metadata), analysisId]
        );
        
        // Save best params if available
        if (bestParams && Object.keys(bestParams).length > 0 && outputData.length > 0) {
          const firstPath = outputData[0];
          const parts = firstPath.split(path.sep);
          const idx = parts.indexOf('results');
          if (idx >= 0 && parts.length >= idx + 3) {
            const baseDir = path.join(...parts.slice(0, idx + 3));
            const bestParamsPath = path.join(baseDir, 'best_params.json');
            try {
              fs.writeFileSync(bestParamsPath, JSON.stringify(bestParams, null, 2), 'utf8');
              console.log(`[Queue] Saved best_params.json at: ${bestParamsPath}`);
            } catch (e) {
              console.error(`[Queue] Failed to write best_params.json:`, e);
            }
          }
        }

        console.log(`[Queue] Analysis ${analysisId} completed and saved to database`);
        
        job.progress(100);

        resolve({
          success: true,
          analysisId,
          resultPath: outputData.join(','),
          metadata,
          categoricalEncodingInfo,
          bestParams,
        });
      } catch (error) {
        console.error(`[Queue] Error processing results for ${analysisId}:`, error);
        
        await db.query(
          'UPDATE analyses SET status = $1 WHERE id = $2',
          ['failed', analysisId]
        );
        
        reject(error);
      }
    });

    pythonProcess.on('error', async (error) => {
      console.error(`[Queue] Failed to start Python process for ${analysisId}:`, error);
      
      await db.query(
        'UPDATE analyses SET status = $1 WHERE id = $2',
        ['failed', analysisId]
      );
      
      reject(error);
    });
  });
});

// Helper function to format elapsed time
function formatElapsedTime(ms) {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  
  if (hours > 0) {
    return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
  } else if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  } else {
    return `${seconds}s`;
  }
}

// Event handlers for monitoring
analysisQueue.on('completed', (job, result) => {
  console.log(`[Queue] Job ${job.id} completed successfully for analysis ${result.analysisId}`);
});

analysisQueue.on('failed', (job, err) => {
  console.error(`[Queue] Job ${job.id} failed:`, err.message);
});

analysisQueue.on('stalled', (job) => {
  console.warn(`[Queue] Job ${job.id} stalled`);
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, closing analysis queue...');
  await analysisQueue.close();
});

module.exports = analysisQueue;
