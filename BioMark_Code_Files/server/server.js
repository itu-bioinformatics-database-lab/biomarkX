const path = require('path');
// Load environment from the server/.env file regardless of working directory
require('dotenv').config({ path: path.join(__dirname, '.env') });
const express = require('express');
const multer = require('multer');
const cors = require('cors');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const db = require('./db/database');
const sessionMiddleware = require('./middleware/session');
const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/user');
const authMiddleware = require('./middleware/auth');
const { sendMail } = require('./mailer');
const pathwayAnalysisRouter = require('./routes/pathwayAnalysis');
const biomarkerValidationRouter = require('./routes/biomarkerValidation');
const analysisQueue = require('./services/analysisQueue');

const { spawn } = require('child_process');

const app = express();

// Derive a safe CORS origin (scheme+host+port) from PUBLIC_BASE_URL which may include a path prefix
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || 'http://localhost:3000';
let PUBLIC_ORIGIN = PUBLIC_BASE_URL;
try {
    const u = new URL(PUBLIC_BASE_URL);
    PUBLIC_ORIGIN = u.origin;
} catch (e) {
    // keep as-is if not a valid URL
}

app.use(cors({
    origin: PUBLIC_ORIGIN,
    exposedHeaders: ['x-session-id'] // Allow client to read the session header
}));
app.use(sessionMiddleware);
app.use(express.json()); // Middleware to parse JSON request bodies

// Authentication routes
app.use('/auth', authRoutes);
app.use(authMiddleware); // Middleware to extract user info from token

// User routes (protected)
app.use('/api/user', userRoutes);
app.use('/api', pathwayAnalysisRouter);
app.use('/api', biomarkerValidationRouter);

// Helper function to get the correct python command depending on the OS
const getPythonCommand = () => {
    return process.platform === 'win32' ? 'python' : 'python3';
};

// Multer settings for file upload
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const uploadPath = path.join('uploads'); // Platform-independent uploads path
        // Create the folder if it does not exist
        if (!fs.existsSync(uploadPath)) {
            fs.mkdirSync(uploadPath, { recursive: true });
        }
        cb(null, uploadPath);
    },
    filename: (req, file, cb) => {
        // Always prefix with a UUID to guarantee uniqueness across users and uploads
        const uploadId = uuidv4();
        req.uploadId = uploadId; // expose to route handler
        const newFileName = `${uploadId}_${file.originalname}`;
        cb(null, newFileName);
    }
});

// File filter to allow only certain file types
const fileFilter = (req, file, cb) => {
    // Allow CSV, TSV, TXT, XLSX and compressed GZ/ZIP containers
    const allowedExtensions = ['.csv', '.tsv', '.txt', '.xlsx', '.gz', '.zip'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowedExtensions.includes(ext)) {
        return cb(null, true);
    }
    // Accept MIME types as a fallback
    const allowedMime = [
        'text/csv', 'text/plain',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'application/gzip', 'application/x-gzip',
        'application/zip', 'application/x-zip-compressed'
    ];
    if (allowedMime.includes(file.mimetype)) {
        return cb(null, true);
    }
    cb(new Error('Only CSV, TSV, TXT, XLSX, GZ, ZIP files are allowed'));
};

const upload = multer({ 
    storage: storage,
    fileFilter: fileFilter
});

// Helper function to format elapsed time in a human-readable way
function formatElapsedTime(milliseconds) {
    const totalSeconds = Math.floor(milliseconds / 1000);
    const seconds = totalSeconds % 60;
    const totalMinutes = Math.floor(totalSeconds / 60);
    const minutes = totalMinutes % 60;
    const hours = Math.floor(totalMinutes / 60);
  
    if (hours > 0) {
        return `${hours} hours ${minutes} mins ${seconds} secs`;
    } else if (minutes > 0) {
        return `${minutes} mins ${seconds} secs`;
    } else {
        return `${seconds} secs`;
    }
  }

// step1 - Endpoint for demo data (session-safe)
app.get('/get-demo-data', async (req, res) => {
  console.log('Demo data endpoint called');

  // Path of immutable demo file shipped with the project
  const originalDemoPath = path.join(__dirname, 'uploads', 'GSE120584_serum_norm_demo.csv');
  if (!fs.existsSync(originalDemoPath)) {
    return res.status(404).json({ success: false, error: 'Demo file missing on server' });
  }

  // Create a unique copy so each session gets its own workspace
  const uploadId = uuidv4();
  const copiedName = `${uploadId}_GSE120584_serum_norm_demo.csv`;
  const serverRelativePath = path.join('uploads', copiedName);
  const demoFilePath = path.join(__dirname, serverRelativePath);

  try {
    fs.copyFileSync(originalDemoPath, demoFilePath);
  } catch (copyErr) {
    console.error('Failed to copy demo file:', copyErr);
    return res.status(500).json({ success: false, error: 'Failed to prepare demo file' });
  }

  // Save metadata just like a normal upload
  try {
        await db.query('INSERT INTO uploads (id, session_id, original_name, server_path) VALUES ($1, $2, $3, $4)',
            [uploadId, req.sessionId, 'GSE120584_serum_norm_demo.csv', demoFilePath]);
  } catch (dbErr) {
    console.error('DB insert failed for demo upload:', dbErr);
  }

  // Obtain first columns via existing Python helper
  const python = spawn(getPythonCommand(), [
    '-Xfrozen_modules=off',
    path.join(__dirname, 'services', 'upload.py'),
    demoFilePath
  ]);

  let stdout = '', stderr = '';
  python.stdout.on('data', (d) => { stdout += d.toString(); });
  python.stderr.on('data', (d) => {
    console.error(`stderr: ${d}`);
    stderr += d.toString();
  });

  python.on('close', (code) => {
    if (code !== 0) {
      return res.status(500).json({ success: false, error: 'Python process failed', details: stderr });
    }

    try {
      const parsed = JSON.parse(stdout.trim());
      const columns = Array.isArray(parsed) ? parsed.slice(0, 10).map((c) => c.trim()) : [];
      const fileSizeBytes = fs.statSync(demoFilePath).size;
      return res.json({
        success: true,
        columns,
        filePath: demoFilePath,
        uploadId,
        fileSize: fileSizeBytes,
        message: 'Demo data loaded successfully'
      });
    } catch (parseErr) {
      console.error('Failed to parse Python output:', parseErr);
      return res.status(500).json({ success: false, error: 'Failed to parse column names' });
    }
  });
});

// step1 - Endpoint to download the demo file
app.get('/download-demo-file', (req, res) => {
    console.log("At download demo file endpoint.");
    const demoFilePath = path.join(__dirname, 'uploads', 'GSE120584_serum_norm_demo.csv');
    
    // Check if the demo file exists
    if (fs.existsSync(demoFilePath)) {
        // Send the file for download
        res.download(demoFilePath, 'GSE120584_serum_norm_demo.csv', (err) => {
            if (err) {
                console.error('Error downloading demo file:', err);
                res.status(500).send('Error downloading demo file');
            }
        });
    } else {
        // Return error if the demo file does not exist
        res.status(404).send('Demo file not found');
    }
});

// step2 - Upload endpoint
app.post('/upload', upload.single('file'), async (req, res) => {
    console.log("At upload endpoint.");
    console.log("Upload - req.sessionId:", req.sessionId, "| req.userId:", req.userId);
    const filePath = req.file.path;
    const uploadId = req.uploadId;

    // Persist upload metadata with user_id if authenticated
    try {
        await db.query('INSERT INTO uploads (id, session_id, user_id, original_name, server_path) VALUES ($1, $2, $3, $4, $5)',
            [uploadId, req.sessionId, req.userId || null, req.file.originalname, filePath]);
    } catch (err) {
        console.error('Failed to insert upload record:', err);
    }

    // Get the parameter (columns) from the request
    const columnCount = req.body.columns || 'all'; // Default is 'all'

    // Call the Python script
    const pythonCommand = getPythonCommand();
    const scriptPath = path.join(__dirname, 'services', 'upload.py');
    const python = spawn(pythonCommand, ['-Xfrozen_modules=off', scriptPath, filePath]);
    let outputData = [];
    let errorOutput = '';

    python.stdout.on('data', (data) => {
        outputData.push(data.toString());
    });

    python.stderr.on('data', (data) => {
        console.error(`stderr: ${data}`);
        errorOutput += data.toString();
    });

    python.on('close', (code) => {
        try {
            if (code === 0) {
                // Combine all chunks and parse as JSON
                const combinedOutput = outputData.join('').trim();
                const parsedOutput = JSON.parse(combinedOutput);

                if (Array.isArray(parsedOutput)) {
                    // Filter columns by column count
                    let filteredColumns = parsedOutput.map((col) => col.trim());
                    if (columnCount !== 'all' && !isNaN(columnCount)) {
                        filteredColumns = filteredColumns.slice(0, parseInt(columnCount));
                    }

                    res.json({
                        success: true,
                        columns: filteredColumns,
                        filePath: req.file.path,
                        uploadId: uploadId
                    });
                } else {
                    throw new Error('Parsed output is not an array');
                }
            } else {
                res.status(500).json({
                    success: false,
                    error: 'Python process failed'
                });
            }
        } catch (error) {
            console.error('Error parsing column names:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to parse column names'
            });
        }
    });
});

app.post('/merge-files', async (req, res) => {
    const { chosenColumns } = req.body;

    if (!chosenColumns || !Array.isArray(chosenColumns) || chosenColumns.length < 2) {
        return res.status(400).json({ success: false, error: 'Provide at least two files.' });
    }

    const pythonCommand = process.platform === 'win32' ? 'python' : 'python3';
    const scriptPath = path.join(__dirname, 'services', 'merge.py');

    // Send chosenColumns as a single JSON argument
    const pythonArgs = [
        '-Xfrozen_modules=off',
        scriptPath,
        JSON.stringify(chosenColumns)
    ];

    console.log("Running Python command:", pythonCommand, pythonArgs.join(" "));

    const python = spawn(pythonCommand, pythonArgs);
    let stdout = '', stderr = '';

    python.stdout.on('data', data => stdout += data.toString());
    python.stderr.on('data', data => stderr += data.toString());

    python.on('close', async (code) => {
        if (code === 0) {
            try {
                const parsed = JSON.parse(stdout.trim());
                const mergedFilePath = parsed.mergedFilePath;
                const mergedUploadId = parsed.uploadId;

                if (!mergedFilePath || !mergedUploadId) {
                    return res.status(500).json({ success: false, error: 'Merged file details are incomplete' });
                }

                // Build a friendly name and size information using metadata when available
                let displayName = parsed.mergedFileName || 'Merged Dataset';
                let originalName = parsed.mergedFileName || 'Merged Dataset';
                let sizeBytes = typeof parsed.sizeBytes === 'number' ? parsed.sizeBytes : 0;

                try {
                    if (parsed.metadataPath && fs.existsSync(parsed.metadataPath)) {
                        const metadata = JSON.parse(fs.readFileSync(parsed.metadataPath, 'utf8'));
                        const sourceFiles = Object.keys(metadata.input_files || {});
                        if (sourceFiles.length > 0) {
                            originalName = sourceFiles.join(', '); // Store actual source filenames
                            displayName = `Merged Files (${sourceFiles.join(', ')})`;
                        }
                        if (typeof metadata.size_bytes === 'number') {
                            sizeBytes = metadata.size_bytes;
                        }
                    }
                } catch (err) {
                    console.error('Error reading merge metadata:', err);
                }

                // Persist merged artifact so ownership checks succeed
                try {
                                await db.query('INSERT INTO uploads (id, session_id, user_id, original_name, server_path) VALUES ($1, $2, $3, $4, $5)',
                                    [mergedUploadId, req.sessionId, req.userId || null, originalName, mergedFilePath]);
                } catch (dbErr) {
                    console.error('Failed to insert merged upload record:', dbErr);
                }

                if (sizeBytes === 0 && fs.existsSync(mergedFilePath)) {
                    try {
                        sizeBytes = fs.statSync(mergedFilePath).size;
                    } catch (statErr) {
                        console.error('Failed to stat merged file:', statErr);
                    }
                }

                return res.json({
                    success: true,
                    mergedFilePath,
                    mergedFileName: displayName,
                    size: sizeBytes,
                    metadataPath: parsed.metadataPath,
                    columns: parsed.columns,
                    uploadId: mergedUploadId,
                    unifiedSampleColumn: parsed.unifiedSampleColumn || 'Sample ID'  // Always "Sample ID" after merge
                });
            } catch (err) {
                console.error(err);
                return res.status(500).json({ success: false, error: 'Failed to parse merged file info' });
            }
        } else {
            console.error(stderr);
            return res.status(500).json({ success: false, error: 'Merge failed', details: stderr });
        }
    });
});

// step3 - Get all columns
app.post('/get_all_columns', async (req, res) => {
    console.log("At get all columns endpoint.");
    const { filePath } = req.body;

    // Check if the file exists
    console.log("filePath: ", filePath);

    const pythonCommand = getPythonCommand();
    const scriptPath = path.join(__dirname, 'services', 'get_all_columns.py');
    const python = spawn(pythonCommand, ['-Xfrozen_modules=off', scriptPath, filePath]);
    let outputData = [];

    python.stdout.on('data', (data) => {
        const output = data.toString().trim().split('\n');
        outputData = outputData.concat(output.map(col => col.trim()));
    });

    python.stderr.on('data', (data) => {
        console.error(`stderr: ${data}`);
    });

    python.on('close', (code) => {
        if (code === 0) {
            res.json({
                success: true,
                columns: outputData
            });
        } else {
            res.status(500).json({
                success: false,
                error: 'Python process failed'
            });
        }
    });
});

// step3 - Get the classes of the selected column
app.post('/get_classes', async (req, res) => { 
    console.log("At get classes endpoint.");
    const {filePath, columnName} = req.body; // Get the file path and column name from the request body
    console.log("columnName: ", columnName);
    
    const pythonCommand = getPythonCommand();
    const scriptPath = path.join(__dirname, 'services', 'get_classes.py');
    const python = spawn(pythonCommand, ['-Xfrozen_modules=off', scriptPath, filePath, columnName]);
    let outputData = []; // Array to hold the output data

    python.stdout.on('data', (data) => {
        const output = data.toString().trim().split('\n'); // Split the output into lines
        outputData = outputData.concat(output.map(path => path.trim())); // Add the output to the array
    });

    python.stderr.on('data', (data) => {
        console.error(`stderr: ${data}`);
    });

    python.on('close', (code) => {
        if (code === 0) {
            // Return the response with imagePaths and success fields
            res.json({
                success: true, 
                classList_: outputData
            });
        } else {
            // Send an error message in case of a Python process failure
            res.status(500).json({ 
                success: false,
                error: 'Python process failed' 
            });
        }
    });
});

// step7 - Run the analysis
// New endpoint: Submit analysis to queue
app.post('/analyze', async (req, res) => {
    
    console.log("At analyze endpoint (queue version)");
    console.log("Request body: ", req.body);
    
    // Assign the values from req.body to the variables on the left
    const {
        filePath, 
        IlnessColumnName, 
        SampleColumnName, 
        selectedClasses, 
        statisticalTest, 
        dimensionalityReduction, 
        classificationAnalysis, 
        modelExplanation,
        nonFeatureColumns, 
        isDiffAnalysis, 
        afterFeatureSelection,
        // Parameter information
        useDefaultParams,
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
    } = req.body;

    const baseFileName = path.basename(filePath);

    // Check if it's a merged file (saved in uploads directory with _merged_dataset suffix)
    const isMergedFile = baseFileName.includes('_merged_dataset.csv');

    const analysisId = uuidv4();
    let derivedUploadIdForInsert = null;
    let mergedFileId = null;
    let sourceUploadIds = null;

    console.log('[Analyze] filePath:', filePath);
    console.log('[Analyze] baseFileName:', baseFileName);
    console.log('[Analyze] isMergedFile:', isMergedFile);

    if (!isMergedFile) {
        derivedUploadIdForInsert = path.basename(filePath).split('_')[0];
        console.log('[Analyze] Single file - derivedUploadIdForInsert:', derivedUploadIdForInsert);
    } else {
        // Extract merged file ID from filename like "FULLID_merged_dataset.csv"
        const basename = path.basename(filePath);
        const match = basename.match(/^([a-f0-9-]+)_merged_dataset\.csv$/);
        if (match) {
            mergedFileId = match[1];
            console.log('[Analyze] Merged file - mergedFileId:', mergedFileId);
        }
        
        // Get source upload IDs from the merged file's metadata
        try {
            // Metadata is saved in results/merged_files/ directory by merge.py
            const metadataPath = path.join(__dirname, 'results', 'merged_files', `${mergedFileId}_metadata.json`);
            console.log('[Analyze] Looking for metadata at:', metadataPath);
            
            if (fs.existsSync(metadataPath)) {
                console.log('[Analyze] Metadata file exists, reading...');
                const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
                console.log('[Analyze] Metadata input_files:', Object.keys(metadata.input_files || {}));
                
                // Extract upload IDs from input_files keys
                const sourceFiles = Object.keys(metadata.input_files || {});
                sourceUploadIds = sourceFiles
                    .map(f => path.basename(f).split('_')[0])
                    .sort(); // Sort for consistent comparison
                console.log('[Analyze] Extracted sourceUploadIds from metadata:', sourceUploadIds);
            } else {
                console.log('[Analyze] Metadata file does NOT exist');
            }
        } catch (err) {
            console.error('[Analyze] Error reading merged file metadata:', err);
        }
    }

    // Parent-child relationship should ONLY be established if explicitly provided
    // This happens when user clicks "Continue on this analysis" or "Perform Another Analysis"
    let parentAnalysisId = req.body.parentAnalysisId || null;
    
    if (parentAnalysisId) {
        console.log('[Analyze] Explicit parent analysis provided:', parentAnalysisId);
    } else {
        console.log('[Analyze] No parent analysis - this will be a standalone analysis');
    }

    // Record analysis start with metadata
    try {
        const metadata = {
            // Store ALL parameters for Continue Analysis feature
            filePath: filePath,
            illnessColumn: IlnessColumnName,
            sampleColumn: SampleColumnName,
            selectedClasses: selectedClasses || [],
            statisticalTest: statisticalTest || [],
            dimensionalityReduction: dimensionalityReduction || [],
            classificationAnalysis: classificationAnalysis || [],
            modelExplanation: modelExplanation || [],
            nonFeatureColumns: nonFeatureColumns || [],
            isDiffAnalysis: isDiffAnalysis || [...(statisticalTest || []), ...(modelExplanation || [])],
            afterFeatureSelection: afterFeatureSelection || false,
            useDefaultParams: useDefaultParams !== undefined ? useDefaultParams : true,
            featureType: featureType || 'numerical',
            referenceClass: referenceClass || null,
            limeGlobalExplanationSampleNum: limeGlobalExplanationSampleNum || 1000,
            shapModelFinetune: shapModelFinetune !== undefined ? shapModelFinetune : true,
            limeModelFinetune: limeModelFinetune !== undefined ? limeModelFinetune : true,
            scoring: scoring || 'accuracy',
            featureImportanceFinetune: featureImportanceFinetune !== undefined ? featureImportanceFinetune : true,
            numTopFeatures: numTopFeatures || 50,
            plotter: plotter || 'matplotlib',
            dim: dim || 2,
            paramFinetune: paramFinetune !== undefined ? paramFinetune : true,
            finetuneFraction: finetuneFraction || 0.1,
            saveBestModel: saveBestModel !== undefined ? saveBestModel : true,
            standardScaling: standardScaling !== undefined ? standardScaling : true,
            saveDataTransformer: saveDataTransformer !== undefined ? saveDataTransformer : true,
            saveLabelEncoder: saveLabelEncoder !== undefined ? saveLabelEncoder : true,
            verbose: verbose !== undefined ? verbose : true,
            testSize: testSize || 0.2,
            nFolds: nFolds || 10,
            // Also store old format for compatibility with AnalysisReport component
            analysisMethods: {
                differential: statisticalTest || [],
                clustering: dimensionalityReduction || [],
                classification: [...(classificationAnalysis || []), ...(modelExplanation || [])]
            }
        };
        
        console.log('[Analyze] Inserting analysis into database:');
        console.log('[Analyze] - analysisId:', analysisId);
        console.log('[Analyze] - upload_id:', derivedUploadIdForInsert);
        console.log('[Analyze] - merged_file_id:', mergedFileId);
        console.log('[Analyze] - source_upload_ids:', sourceUploadIds);
        console.log('[Analyze] - parent_analysis_id:', parentAnalysisId);
        console.log('[Analyze] - session_id:', req.sessionId);
        console.log('[Analyze] - user_id:', req.userId || null);
        
        await db.query('INSERT INTO analyses (id, upload_id, merged_file_id, source_upload_ids, session_id, user_id, status, analysis_metadata, parent_analysis_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)',
                    [analysisId, derivedUploadIdForInsert, mergedFileId, sourceUploadIds, req.sessionId, req.userId || null, 'queued', JSON.stringify(metadata), parentAnalysisId]);
        
        console.log('[Analyze] Analysis record inserted successfully');
    } catch (err) {
        console.error('[Analyze] Failed to insert analysis record:', err);
        return res.status(500).json({ success: false, error: 'Failed to create analysis record' });
    }
    
    // Submit analysis to queue instead of running synchronously
    try {
        console.log(`[Queue] Submitting analysis ${analysisId} to queue`);
        
        const jobData = {
            analysisId,
            uploadId: derivedUploadIdForInsert,
            uploadPath: filePath,
            originalName: baseFileName,
            sessionId: req.sessionId,
            userId: req.userId || null,
            illnessColumn: IlnessColumnName,
            sampleColumn: SampleColumnName,
            selectedClasses,
            nonFeatureColumns,
            analysisMethods: {
                statisticalTest,
                dimensionalityReduction,
                classificationAnalysis,
                modelExplanation,
            },
            mergedFileId,
            sourceFiles: isMergedFile ? (req.body.sourceFiles || []) : null,
            // Include custom parameters if provided
            useDefaultParams,
            customParams: !useDefaultParams ? {
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
                usePreprocessing,
                isDiffAnalysis: isDiffAnalysis || [...(statisticalTest || []), ...(modelExplanation || [])],
                afterFeatureSelection: afterFeatureSelection === undefined ? false : afterFeatureSelection
            } : null
        };
        
        const job = await analysisQueue.add(jobData, {
            jobId: analysisId,
            priority: req.userId ? 1 : 2, // Logged-in users get higher priority
        });
        
        console.log(`[Queue] Analysis ${analysisId} queued successfully with job ID ${job.id}`);
        
        // Return immediately with queue status
        res.json({
            success: true,
            analysisId,
            status: 'queued',
            message: 'Analysis has been queued and will be processed shortly',
            queuePosition: await analysisQueue.count() // Approximate position
        });
        
    } catch (error) {
        console.error('[Queue] Error submitting analysis to queue:', error);
        
        // Update status to failed
        try {
            await db.query('UPDATE analyses SET status = $1 WHERE id = $2', ['failed', analysisId]);
        } catch (dbErr) {
            console.error('Failed to update analysis status:', dbErr);
        }
        
        res.status(500).json({
            success: false,
            error: 'Failed to queue analysis',
            message: error.message
        });
    }
});

// Status polling endpoint for queue
app.get('/api/analysis/:id/status', async (req, res) => {
    const analysisId = req.params.id;
    
    try {
        // Check ownership first
        const result = await db.query(
            'SELECT status, result_path, analysis_metadata, session_id, user_id FROM analyses WHERE id = $1',
            [analysisId]
        );
        
        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Analysis not found' });
        }
        
        const analysis = result.rows[0];
        
        // Verify ownership
        const ownedByUser = req.userId && analysis.user_id === req.userId;
        const ownedBySession = req.sessionId && analysis.session_id === req.sessionId;
        
        if (!ownedByUser && !ownedBySession) {
            return res.status(403).json({ success: false, error: 'Access denied' });
        }
        
        // Get job progress if still queued or processing
        let progress = 0;
        let queuePosition = null;
        
        console.log(`[Status] Checking status for analysis ${analysisId}: ${analysis.status}`);
        
        if (analysis.status === 'queued' || analysis.status === 'processing') {
            try {
                const job = await analysisQueue.getJob(analysisId);
                if (job) {
                    const jobProgress = await job.progress();
                    progress = typeof jobProgress === 'number' ? jobProgress : 0;
                    
                    console.log(`[Status] Job ${analysisId} progress: ${progress}`);
                    
                    if (analysis.status === 'queued') {
                        const waiting = await analysisQueue.getWaiting();
                        queuePosition = waiting.findIndex(j => j.id === analysisId) + 1;
                        console.log(`[Status] Job ${analysisId} queue position: ${queuePosition}`);
                    }
                } else {
                    console.log(`[Status] Job ${analysisId} not found in queue`);
                }
            } catch (err) {
                console.error('Error getting job info:', err);
            }
        } else if (analysis.status === 'finished') {
            progress = 100;
        }
        
        res.json({
            success: true,
            analysisId,
            status: analysis.status,
            progress,
            queuePosition,
            resultPath: analysis.result_path,
            metadata: analysis.analysis_metadata ? JSON.parse(analysis.analysis_metadata) : null
        });
        
    } catch (error) {
        console.error('Error checking analysis status:', error);
        res.status(500).json({ success: false, error: 'Failed to check status' });
    }
});

// step8 - Endpoint to summarize statistical methods
app.post('/summarize_statistical_methods', async (req, res) => {
    console.log("At summarize statistical methods endpoint.")
    const featureCount = req.body.featureCount || 10; // Default is 10
    const filePath = req.body.filePath;
    const selectedClassPair = req.body.selectedClassPair; // User-selected class pair (optional)
    const analysisId = req.body.analysisId; // Analysis ID to associate summary with
    
    // Extract the file name
    const fileName = path.basename(filePath).split('.')[0];
    
    // Check the feature_ranking directory and find class pairs
    const featureRankingPath = path.join('results', fileName, 'feature_ranking');
    
    try {
        console.log("Checking for feature_ranking directory:", featureRankingPath);
        
        // First, check if the feature_ranking folder exists
        if (!fs.existsSync(featureRankingPath)) {
            console.log("feature_ranking directory does not exist, using classic path");
            
            // Old path, only used if there is a single class pair
            if (selectedClassPair) {
                return res.status(400).json({ success: false, message: 'No feature ranking data found for selected class pair' });
            }
            
            // Create the image file path (old path)
            const pngImagePath = path.join('results', fileName, 'summaryStatisticalMethods', 'png', 'summary_of_statistical_methods_plot.png');
            
            // Try to delete the existing image file if it exists
            try {
                if (fs.existsSync(pngImagePath)) {
                    fs.unlinkSync(pngImagePath);
                    console.log(`Existing image deleted: ${pngImagePath}`);
                }
            } catch (err) {
                console.error(`Error deleting existing image: ${err}`);
            }
            
            const pythonCommand = getPythonCommand();
            const scriptPath = path.join(__dirname, 'services', 'summary_of_statiscical_methods.py');
            const python = spawn(pythonCommand, [
                '-Xfrozen_modules=off', 
                scriptPath,
                filePath,
                String(featureCount) // Convert numeric value to string
            ], { cwd: __dirname });
            
            let outputData = '';
            python.stdout.on('data', (data) => {
                outputData += data.toString();
            });
            
            let sumErr = '';
            python.stderr.on('data', (data) => {
                console.error(`stderr: ${data}`);
                sumErr += data.toString();
            });
            
            python.on('close', async (code) => {
                if (code !== 0) {
                    console.error(`Python process exited with code ${code}`);
                    return res.status(500).json({ success: false, message: 'Process failed', error: sumErr });
                }
                
                // Clean up line endings
                const cleanedOutput = outputData.trim();
                console.log(`Python process output: ${cleanedOutput}`);
                
                // Best effort legacy CSV path
                const legacyCsvPath = path.join('results', fileName, 'ranked_features_df.csv');
                
                // Save biomarker summary to database if analysisId provided
                if (analysisId) {
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
                            
                            // Initialize biomarkerSummaries array if it doesn't exist
                            if (!metadata.biomarkerSummaries) {
                                metadata.biomarkerSummaries = [];
                            }
                            
                            // Add this biomarker summary result
                            metadata.biomarkerSummaries.push({
                                classPair: 'Summary',
                                imagePath: cleanedOutput,
                                csvPath: legacyCsvPath,
                                featureCount: featureCount,
                                timestamp: new Date().toISOString()
                            });
                            
                            // Update the analysis metadata
                            await db.query('UPDATE analyses SET analysis_metadata = $1 WHERE id = $2',
                              [JSON.stringify(metadata), analysisId]);
                            
                            console.log(`Saved biomarker summary to analysis ${analysisId}`);
                        }
                    } catch (dbErr) {
                        console.error('Failed to save biomarker summary to database:', dbErr);
                        // Don't fail the request if database save fails
                    }
                }
                
                res.json({ 
                    success: true, 
                    imagePath: cleanedOutput,
                    csvPath: legacyCsvPath
                });
            });
            
            return;
        }
        
        // Read class pairs - consider directories that have a canonical ranked_features_df.csv
        // OR have at least one labeled subdirectory containing ranked_features_df.csv
        let classPairs = [];
        try {
            classPairs = fs.readdirSync(featureRankingPath).filter(item => {
                const itemPath = path.join(featureRankingPath, item);
                if (!fs.statSync(itemPath).isDirectory()) return false;
                if (fs.existsSync(path.join(itemPath, 'ranked_features_df.csv'))) return true;
                try {
                    const subdirs = fs.readdirSync(itemPath).filter(s => {
                        const subPath = path.join(itemPath, s);
                        return fs.statSync(subPath).isDirectory();
                    });
                    return subdirs.some(s => fs.existsSync(path.join(itemPath, s, 'ranked_features_df.csv')));
                } catch (e) {
                    return false;
                }
            });
        } catch (error) {
            console.error("Error reading class pair directories:", error);
        }
        
        console.log("Found class pairs:", classPairs);
        
        // If no class pairs are found under feature_ranking, try to derive from feature_importances.json
        if (classPairs.length === 0) {
            try {
                const aggJsonPath = path.join('results', fileName, 'feature_importances.json');
                if (fs.existsSync(aggJsonPath)) {
                    const raw = fs.readFileSync(aggJsonPath, 'utf8');
                    const parsed = JSON.parse(raw);
                    if (parsed && typeof parsed === 'object') {
                        classPairs = Object.keys(parsed).filter(k => typeof parsed[k] === 'object');
                    }
                }
            } catch (e) {
                // ignore and fall through
            }
            if (classPairs.length === 0) {
                console.log("No class pairs found with ranked_features_df.csv and none derivable from feature_importances.json");
                return res.status(400).json({ 
                    success: false, 
                    message: 'No class pairs found with ranked_features_df.csv files' 
                });
            }
        }
        
        // If there is no selected class pair and there are multiple class pairs, return them for user selection
        if (!selectedClassPair && classPairs.length > 1) {
            console.log("Multiple class pairs found, asking user for selection:", classPairs);
            return res.json({ 
                success: true, 
                classPairs: classPairs,
                needsSelection: true
            });
        }
        
        // Use the selected class pair or the only one available
        const classToUse = selectedClassPair || classPairs[0];
        console.log("Using class pair:", classToUse);
        
        // Create the output directory for the selected class pair
        const outputDir = path.join('results', fileName, 'summaryStatisticalMethods', classToUse);
        // Create the folders if they do not exist
        fs.mkdirSync(path.join(outputDir, 'png'), { recursive: true });
        fs.mkdirSync(path.join(outputDir, 'pdf'), { recursive: true });
        
        // Try to delete the existing image file if it exists
        const pngImagePath = path.join(outputDir, 'png', 'summary_of_statistical_methods_plot.png');
        try {
            if (fs.existsSync(pngImagePath)) {
                fs.unlinkSync(pngImagePath);
                console.log(`Existing image deleted: ${pngImagePath}`);
            }
        } catch (err) {
            console.error(`Error deleting existing image: ${err}`);
        }
        
        // Before proceeding, ensure there are at least two biomarker-producing analyses for this class pair.
        // We check aggregated feature_importances.json for the selected class pair.
        try {
            const aggJsonPath = path.join('results', fileName, 'feature_importances.json');
            if (fs.existsSync(aggJsonPath)) {
                const raw = fs.readFileSync(aggJsonPath, 'utf8');
                try {
                    const parsed = JSON.parse(raw);
                    const cpData = parsed && parsed[classToUse];
                    let sourceCount = 0;
                    if (cpData && typeof cpData === 'object') {
                        Object.values(cpData).forEach((val) => {
                            if (val && typeof val === 'object') {
                                // Leaf dict (e.g., anova, t_test, xgb_feature_importance)
                                const looksLikeFeatureMap = Object.values(val).some(v => typeof v === 'number');
                                if (looksLikeFeatureMap) {
                                    sourceCount += 1;
                                } else {
                                    // Nested (e.g., by model key -> { shap: {...}, lime: {...} })
                                    Object.values(val).forEach((inner) => {
                                        if (inner && typeof inner === 'object') {
                                            const innerIsFeatMap = Object.values(inner).some(v => typeof v === 'number');
                                            if (innerIsFeatMap) sourceCount += 1;
                                        }
                                    });
                                }
                            }
                        });
                    }
                    if (sourceCount < 2) {
                        return res.status(400).json({
                            success: false,
                            message: 'There is only one analysis for this class pair. To combine, please run more analyses.'
                        });
                    }
                } catch (e) {
                    // If the JSON is unreadable, continue without blocking
                }
            }
        } catch (e) {
            // Non-fatal; continue
        }

        // Resolve CSV path for the selected class pair (prefer canonical; fallback to labeled subdir)
        const classDir = path.join(featureRankingPath, classToUse);
        let csvPath = path.join(classDir, 'ranked_features_df.csv');
        let selectedSubdirLabel = '';
        if (!fs.existsSync(csvPath)) {
            try {
                const subdirs = fs.readdirSync(classDir).filter(s => {
                    const subPath = path.join(classDir, s);
                    return fs.statSync(subPath).isDirectory() && fs.existsSync(path.join(subPath, 'ranked_features_df.csv'));
                });
                if (subdirs.length > 0) {
                    // Prefer model=... first, then others; stable order
                    subdirs.sort((a, b) => {
                        const ap = a.startsWith('model=') ? 0 : 1;
                        const bp = b.startsWith('model=') ? 0 : 1;
                        if (ap !== bp) return ap - bp;
                        return a.localeCompare(b);
                    });
                    selectedSubdirLabel = subdirs[0];
                    csvPath = path.join(classDir, selectedSubdirLabel, 'ranked_features_df.csv');
                }
            } catch (e) {
                // ignore
            }
        }
        console.log("Using CSV path:", csvPath);
        // Do not fail early if CSV missing; attempt re-ranking to generate it
        
        // Optional on-the-fly re-ranking based on query params
        const aggregationMethod = (req.body && req.body.aggregationMethod) ? String(req.body.aggregationMethod).toLowerCase() : null;
        const aggregationWeights = (req.body && req.body.aggregationWeights) ? String(req.body.aggregationWeights) : null;
        const rrfK = (req.body && typeof req.body.rrfK === 'number') ? String(req.body.rrfK) : null;

        const pythonCommand = getPythonCommand();
        const scriptPath = path.join(__dirname, 'services', 'summary_of_statiscical_methods.py');
        const rerankScript = path.join(__dirname, 'services', 'recompute_ranking.py');

        const runSummary = (labelForDirAndTitle = '') => spawn(pythonCommand, [
            '-Xfrozen_modules=off',
            scriptPath,
            filePath,
            String(featureCount),
            classToUse,
            csvPath,
            labelForDirAndTitle
        ], { cwd: __dirname });

        // Build a human-readable aggregation label for directory and title
        const buildAggLabel = () => {
            const parts = [];
            if (aggregationMethod) parts.push(`method=${aggregationMethod}`);
            if (aggregationMethod === 'rrf' && rrfK) parts.push(`k=${rrfK}`);
            if (aggregationMethod === 'weighted_borda' && aggregationWeights) parts.push(`weights=${aggregationWeights}`);
            return parts.join(',');
        };

        const aggLabelOverride = buildAggLabel();
        const aggLabel = aggLabelOverride || selectedSubdirLabel;

        // Always rerank to ensure combination across all analyses is up-to-date
        const runRerank = () => spawn(pythonCommand, [
            '-Xfrozen_modules=off',
            rerankScript,
            filePath,
            classToUse,
            aggregationMethod || '',
            aggregationWeights || '',
            rrfK || '',
            aggLabel || ''
        ], { cwd: __dirname });

        const maybeRerank = runRerank();
        let outputData = '';
        const finalize = () => {
            const py = runSummary(aggLabel);
            let sumErr = '';
            py.stdout.on('data', (data) => { outputData += data.toString(); console.log(`Python stdout: ${data}`); });
            py.stderr.on('data', (data) => { console.error(`stderr: ${data}`); sumErr += data.toString(); });
            py.on('close', async (code) => {
                if (code !== 0) {
                    console.error(`Python process exited with code ${code}`);
                    return res.status(500).json({ success: false, message: 'Process failed', error: sumErr });
                }
                const cleanedOutput = outputData.trim();
                console.log(`Python process output: ${cleanedOutput}`);
                
                // Save biomarker summary to database if analysisId provided
                if (analysisId) {
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
                            
                            // Initialize biomarkerSummaries array if it doesn't exist
                            if (!metadata.biomarkerSummaries) {
                                metadata.biomarkerSummaries = [];
                            }
                            
                            // Remove any previous summary for the same class pair and aggregation label
                            metadata.biomarkerSummaries = metadata.biomarkerSummaries.filter(
                                s => !(s.classPair === classToUse && (s.aggregationLabel || '') === (aggLabel || ''))
                            );
                            
                            // Add this biomarker summary result
                            metadata.biomarkerSummaries.push({
                                classPair: classToUse,
                                imagePath: cleanedOutput,
                                csvPath: csvPath,
                                featureCount: featureCount,
                                aggregationLabel: aggLabel || '',
                                timestamp: new Date().toISOString()
                            });
                            
                            // Update the analysis metadata AND append to result_path
                            const currentResult = await db.query('SELECT result_path FROM analyses WHERE id = $1', [analysisId]);
                            let updatedResultPath = currentResult.rows[0]?.result_path || '';
                            
                            // Append the biomarker summary image to result_path
                            if (cleanedOutput) {
                                if (updatedResultPath) {
                                    updatedResultPath += ',' + cleanedOutput;
                                } else {
                                    updatedResultPath = cleanedOutput;
                                }
                            }
                            
                            await db.query('UPDATE analyses SET analysis_metadata = $1, result_path = $2 WHERE id = $3',
                              [JSON.stringify(metadata), updatedResultPath, analysisId]);
                            
                            console.log(`Saved biomarker summary to analysis ${analysisId} and added to result_path`);
                        }
                    } catch (dbErr) {
                        console.error('Failed to save biomarker summary to database:', dbErr);
                        // Don't fail the request if database save fails
                    }
                }
                
                res.json({ success: true, imagePath: cleanedOutput, selectedClassPair: classToUse, aggregationLabel: aggLabel, csvPath });
            });
        };

        let rerankOut = '';
        maybeRerank.stdout.on('data', (d) => { rerankOut += d.toString(); });
        maybeRerank.stderr.on('data', (d) => { console.error(`stderr: ${d}`); });
        maybeRerank.on('close', (c) => {
            if (c !== 0) {
                console.error(`Re-ranking process exited with code ${c}`);
                // Proceed with previous csvPath if rerank failed
            } else {
                try {
                    const text = (rerankOut || '').trim();
                    const lines = text.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
                    const lastLine = lines.length > 0 ? lines[lines.length - 1] : '';
                    if (lastLine) {
                        csvPath = lastLine; // prefer the freshly produced CSV path
                        console.log('Using CSV path from re-ranking:', csvPath);
                    }
                } catch (e) {
                    console.error('Failed to parse re-ranking output path:', e);
                }
            }
            finalize();
        });
        
    } catch (error) {
        console.error("Error processing request:", error);
        res.status(500).json({ success: false, message: 'Internal server error', error: error.toString() });
    }
});

// Serve static files from the results directory
app.use('/results', express.static(path.join(__dirname, 'results')));
// Serve static files from the sample_report directory
app.use('/sample_report', express.static(path.join(__dirname, 'sample_report')));

// Direct endpoint to serve the bundled sample analysis PDF for environments
// where static file mounting may fail due to proxy or path prefix issues.
app.get('/analysis-report', (req, res) => {
    const reportPath = path.join(__dirname, 'sample_report', 'Biomarker_Sample_Analysis_Report.pdf');
    if (fs.existsSync(reportPath)) {
        return res.sendFile(reportPath);
    }
    return res.status(404).send('Sample analysis report not found on server.');
});

// Disable the default Node.js request timeout so that long-running analyses
// (e.g. Permutation-Feature-Importance) can finish without the connection
// being closed prematurely. Setting the timeout values to 0 removes the limit.
const PORT = 5003;
const server = app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});

// Remove all built-in time limits so the client can wait as long as needed
// for heavy analyses to complete.
server.timeout = 0;          // Disable the 2-minute default timeout
server.keepAliveTimeout = 0; // Ensure keep-alive connections stay open
// Node >= 13 introduces headersTimeout; disable it as well for completeness
if (server.headersTimeout !== undefined) {
    server.headersTimeout = 0;
}

// --- Notifications ---
// Lightweight email format check
function isValidEmail(email) {
    return typeof email === 'string' && /.+@.+\..+/.test(email);
}

// Save a notification subscription before or during analysis
app.post('/api/analysis/notify', async (req, res) => {
    try {
        const { jobId, email } = req.body || {};
        if (!jobId || !email) {
            return res.status(400).json({ success: false, message: 'jobId and email are required' });
        }
        if (!isValidEmail(email)) {
            return res.status(400).json({ success: false, message: 'Invalid email address' });
        }
        const id = uuidv4();
        await db.query('INSERT INTO notification_subscriptions (id, job_id, email, status) VALUES ($1, $2, $3, $4)',
          [id, jobId, email, 'pending']);
        return res.json({ success: true, id });
    } catch (e) {
        console.error('Failed to save notification subscription:', e);
        return res.status(500).json({ success: false, message: 'Internal server error' });
    }
});

// Public endpoint for results viewer to fetch analysis state
app.get('/api/analyses/:analysisId', async (req, res) => {
    try {
        const result = await db.query('SELECT id, result_path, status, created_at FROM analyses WHERE id = $1', [req.params.analysisId]);
        if (result.rows.length === 0) return res.status(404).json({ success: false, message: 'Analysis not found' });
        const row = result.rows[0];
        const resultImages = row.result_path ? row.result_path.split(',').map(s => s.trim()).filter(Boolean) : [];

        // Try to load best_params.json from results folder and include in API response
        let bestParams = null;
        try {
            if (Array.isArray(resultImages) && resultImages.length > 0) {
                const firstPath = resultImages.find(p => typeof p === 'string' && (p.startsWith('results') || p.includes(path.join('results', path.sep)))) || resultImages[0];
                if (firstPath) {
                    const parts = firstPath.split(path.sep);
                    const idx = parts.indexOf('results');
                    if (idx >= 0 && parts.length >= idx + 3) {
                        const baseDir = path.join(__dirname, parts.slice(0, idx + 3).join(path.sep));
                        const bestParamsPath = path.join(baseDir, 'best_params.json');
                        if (fs.existsSync(bestParamsPath)) {
                            const raw = fs.readFileSync(bestParamsPath, 'utf8');
                            const parsed = JSON.parse(raw);
                            if (parsed && typeof parsed === 'object') bestParams = parsed;
                        }
                    }
                }
            }
        } catch (e) {
            // ignore errors reading optional best_params.json
        }

        return res.json({ success: true, analysisId: row.id, status: row.status || 'unknown', createdAt: row.created_at, resultImages, bestParams });
    } catch (e) {
        console.error('GET /api/analyses/:analysisId error:', e);
        return res.status(500).json({ success: false, message: 'Internal server error' });
    }
});