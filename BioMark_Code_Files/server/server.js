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
const { sendMail } = require('./mailer');

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
app.get('/get-demo-data', (req, res) => {
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
    db.prepare('INSERT INTO uploads (id, session_id, original_name, server_path) VALUES (?,?,?,?)')
      .run(uploadId, req.sessionId, 'GSE120584_serum_norm_demo.csv', demoFilePath);
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
app.post('/upload', upload.single('file'), (req, res) => {
    console.log("At upload endpoint.");
    const filePath = req.file.path;
    const uploadId = req.uploadId;

    // Persist upload metadata
    try {
        db.prepare('INSERT INTO uploads (id, session_id, original_name, server_path) VALUES (?,?,?,?)')
          .run(uploadId, req.sessionId, req.file.originalname, filePath);
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

// step3 - Get all columns
app.post('/get_all_columns', (req, res) => {
    console.log("At get all columns endpoint.");
    const { filePath } = req.body;

    // Check if the file is owned by the current session
    try {
        const derivedUploadId = path.basename(filePath).split('_')[0];
        const uploadOwner = db.prepare('SELECT session_id FROM uploads WHERE id = ?').get(derivedUploadId);
        
        if (!uploadOwner || uploadOwner.session_id !== req.sessionId) {
            return res.status(403).json({ success: false, error: 'Access denied for this file' });
        }
    } catch (e) {
        console.error('Ownership check failed:', e);
        return res.status(500).json({ success: false, error: 'Internal server error' });
    }

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
app.post('/get_classes', (req, res) => { 
    console.log("At get classes endpoint.")
    const {filePath, columnName} = req.body; // Get the file path and column name from the request body
    console.log("columnName: ", columnName);

    // Check if the file is owned by the current session
    try {
        const derivedUploadId = path.basename(filePath).split('_')[0];
        const uploadOwner = db.prepare('SELECT session_id FROM uploads WHERE id = ?').get(derivedUploadId);
        
        if (!uploadOwner || uploadOwner.session_id !== req.sessionId) {
            return res.status(403).json({ success: false, error: 'Access denied for this file' });
        }
    } catch (e) {
        console.error('Ownership check failed:', e);
        return res.status(500).json({ success: false, error: 'Internal server error' });
    }
    
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
app.post('/analyze', (req, res) => {
    
    console.log("At analyze endpoint.")
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

    // Derive uploadId from prefixed filename (UUID_originalName.ext)
    const derivedUploadId = path.basename(filePath).split('_')[0];

    // Ownership check
    const uploadOwner = db.prepare('SELECT session_id FROM uploads WHERE id = ?').get(derivedUploadId);
    if (!uploadOwner || uploadOwner.session_id !== req.sessionId) {
        return res.status(403).json({ success: false, error: 'Access denied for this file' });
    }

    // Allow client to provide a stable job id so email subscriptions can match
    const analysisId = req.body.clientJobId && typeof req.body.clientJobId === 'string' && req.body.clientJobId.trim() !== ''
        ? req.body.clientJobId.trim()
        : uuidv4();

    // Record analysis start
    try {
        db.prepare('INSERT INTO analyses (id, upload_id, status) VALUES (?,?,?)')
          .run(analysisId, derivedUploadId, 'running');
    } catch (err) {
        console.error('Failed to insert analysis record:', err);
    }
    
    const startTime = Date.now(); // Start time of the process
    console.log(filePath, IlnessColumnName, SampleColumnName, selectedClasses, statisticalTest, dimensionalityReduction, classificationAnalysis, modelExplanation, nonFeatureColumns, isDiffAnalysis);
    
    // Fix undefined values
    const safeIsDiffAnalysis = isDiffAnalysis || [...(statisticalTest || []), ...(modelExplanation || [])];
    const safeAfterFeatureSelection = afterFeatureSelection === undefined ? false : afterFeatureSelection;
    
    // Prepare Python command and parameters
    const pythonArgs = [
        '-Xfrozen_modules=off', 
        path.join(__dirname, 'services', 'analyze.py'), 
        filePath, 
        IlnessColumnName, 
        SampleColumnName, 
        Array.isArray(selectedClasses) ? selectedClasses.join(',') : '', 
        Array.isArray(statisticalTest) && statisticalTest.length > 0 ? statisticalTest.join(',') : '', 
        Array.isArray(dimensionalityReduction) && dimensionalityReduction.length > 0 ? dimensionalityReduction.join(',') : '', 
        Array.isArray(classificationAnalysis) && classificationAnalysis.length > 0 ? classificationAnalysis.join(',') : '', 
        Array.isArray(modelExplanation) && modelExplanation.length > 0 ? modelExplanation.join(',') : '', // Add explanation
        Array.isArray(nonFeatureColumns) ? nonFeatureColumns.join(',') : '', 
        Array.isArray(safeIsDiffAnalysis) ? safeIsDiffAnalysis.join(',') : '', // Differential analyses
        String(safeAfterFeatureSelection) // After feature selection status
    ];
    
    // If not using default parameters, add --params argument and parameters
    if (!useDefaultParams) {
        pythonArgs.push('--params');
        pythonArgs.push(JSON.stringify({
            // Differential Analysis Parameters
            feature_type: featureType || "microRNA",
            reference_class: referenceClass || "",
            lime_global_explanation_sample_num: limeGlobalExplanationSampleNum || 50,
            shap_model_finetune: !!shapModelFinetune, // Convert to Boolean
            lime_model_finetune: !!limeModelFinetune, // Convert to Boolean
            scoring: scoring || "f1",
            feature_importance_finetune: !!featureImportanceFinetune, // Convert to Boolean
            num_top_features: numTopFeatures || 20,
            // Clustering Analysis Parameters
            plotter: plotter || "seaborn",
            dim: dim || "3D",
            // Classification Analysis Parameters
            param_finetune: !!paramFinetune, // Convert to Boolean
            finetune_fraction: finetuneFraction || 1.0,
            save_best_model: saveBestModel !== false, // Convert to Boolean, default true
            standard_scaling: standardScaling !== false, // Convert to Boolean, default true
            save_data_transformer: saveDataTransformer !== false, // Convert to Boolean, default true
            save_label_encoder: saveLabelEncoder !== false, // Convert to Boolean, default true
            verbose: verbose !== false, // Convert to Boolean, default true
            use_preprocessing: usePreprocessing !== false, // Convert to Boolean, default true
            // Common parameters
            test_size: testSize || 0.2,
            n_folds: nFolds || 5,
            // String conversion for boolean parameters
            is_diff_analysis: Array.isArray(safeIsDiffAnalysis) ? safeIsDiffAnalysis.join(',') : '',
            after_feature_selection: String(safeAfterFeatureSelection)
        }));
    }
    
    // Print the full command arguments to the console
    // console.log("Python command and arguments:", JSON.stringify(pythonArgs));
    
    const pythonCommand = getPythonCommand();
    console.log("Python command:", pythonCommand);
    const python = spawn(pythonCommand, pythonArgs);
    let outputData = [];
    let errorOutput = '';
    let categoricalEncodingInfo = null;

    python.stdout.on('data', (data) => {
        console.log(`Python stdout: ${data}`);
        const output = data.toString().trim().split('\n');
        
        // Check for categorical encoding information
        output.forEach(line => {
            if (line.startsWith('CATEGORICAL_ENCODING_INFO:')) {
                console.log('Found CATEGORICAL_ENCODING_INFO line:', line);
                try {
                    categoricalEncodingInfo = JSON.parse(line.replace('CATEGORICAL_ENCODING_INFO:', '').trim());
                    console.log('Parsed categorical encoding info:', categoricalEncodingInfo);
                } catch (e) {
                    console.error('Failed to parse categorical encoding info:', e);
                }
            }
        });
        
        // Capture best hyperparameters if present
        output.forEach(line => {
            if (line.startsWith('BEST_PARAMS:')) {
                try {
                    const parsed = JSON.parse(line.replace('BEST_PARAMS:', '').trim());
                    if (parsed && typeof parsed === 'object') {
                        // Attach to response via closure variable
                        if (!req.bestParams) req.bestParams = {};
                        req.bestParams = Object.assign(req.bestParams, parsed);
                    }
                } catch (e) {
                    console.error('Failed to parse BEST_PARAMS line:', e);
                }
            }
        });

        // Filter only file paths starting with "results/"
        // Use path.sep for Windows compatibility
        const resultsPrefix = path.join('results', ''); // Ensure trailing separator
        const filteredResults = output.filter(p => p.trim().startsWith(resultsPrefix));
        outputData = outputData.concat(filteredResults);
    });

    python.stderr.on('data', (data) => {
        console.error(`stderr: ${data}`);
        errorOutput += data.toString();
    });

    python.on('close', (code) => {
        const endTime = Date.now(); // End time of the process
        const elapsedTime = formatElapsedTime(endTime - startTime); // Calculate elapsed time in a suitable format

        if (code === 0) {
            console.log("output data: ", outputData);
            
            // Mark analysis as finished in DB
            try {
                db.prepare('UPDATE analyses SET status = ?, result_path = ? WHERE id = ?')
                  .run('finished', outputData.join(','), analysisId);
            } catch (err) {
                console.error('Failed to update analysis record:', err);
            }

            // Persist best hyperparameters to a JSON file under the results directory (if available)
            try {
                if (req.bestParams && Object.keys(req.bestParams).length > 0 && Array.isArray(outputData) && outputData.length > 0) {
                    const firstPath = outputData.find(p => typeof p === 'string' && p.includes(path.join('results', path.sep)) || typeof p === 'string' && p.startsWith('results')) || outputData[0];
                    if (firstPath) {
                        // Derive base directory: results/<file>/<class_pair>
                        const parts = firstPath.split(path.sep);
                        const idx = parts.indexOf('results');
                        if (idx >= 0 && parts.length >= idx + 3) {
                            const baseDir = path.join(...parts.slice(0, idx + 3));
                            const bestParamsPath = path.join(baseDir, 'best_params.json');
                            try {
                                fs.writeFileSync(bestParamsPath, JSON.stringify(req.bestParams, null, 2), 'utf8');
                                console.log('Saved best_params.json at:', bestParamsPath);
                            } catch (e) {
                                console.error('Failed to write best_params.json', e);
                            }

                            // Also persist a CSV export for convenience
                            try {
                                const bestParamsCsvPath = path.join(baseDir, 'best_params.csv');
                                const escapeCsv = (val) => `"${String(val).replace(/"/g, '""')}"`;
                                let csv = 'Model,Parameter,Value\n';
                                Object.entries(req.bestParams || {}).forEach(([modelName, paramsObj]) => {
                                    if (paramsObj && typeof paramsObj === 'object') {
                                        Object.entries(paramsObj).forEach(([key, value]) => {
                                            const printable = Array.isArray(value) ? JSON.stringify(value) : String(value);
                                            csv += `${escapeCsv(modelName)},${escapeCsv(key)},${escapeCsv(printable)}\n`;
                                        });
                                    }
                                });
                                fs.writeFileSync(bestParamsCsvPath, csv, 'utf8');
                                console.log('Saved best_params.csv at:', bestParamsCsvPath);
                            } catch (e) {
                                console.error('Failed to write best_params.csv', e);
                            }
                        }
                    }
                }
            } catch (e) {
                console.error('Unexpected error while persisting best params:', e);
            }

            // Send the response here
            console.log('Sending response with categoricalEncodingInfo:', categoricalEncodingInfo);
            res.json({
                success: true,
                analysisId: analysisId,
                imagePaths: outputData,
                elapsedTime: elapsedTime,
                categoricalEncodingInfo: categoricalEncodingInfo,
                bestParams: req.bestParams || null
            });

            // After responding, notify pending email subscribers (fire-and-forget)
            try {
                const publicBase = process.env.PUBLIC_BASE_URL || 'http://localhost:3000';
                const viewUrl = `${publicBase}/#/results/${analysisId}`;
                const subject = 'Your analysis has finished';
                const html = `<div style="font-family:Arial,sans-serif;font-size:14px;color:#333">`
                  + `<p>Your analysis is complete.</p>`
                  + `<p><a href="${viewUrl}">Click here to view the results</a></p>`
                  + `<p>If the link does not work, copy and paste this URL into your browser:</p>`
                  + `<p>${viewUrl}</p>`
                  + `</div>`;
                const pending = db.prepare('SELECT id, email FROM notification_subscriptions WHERE job_id = ? AND status = ?').all(analysisId, 'pending');
                if (Array.isArray(pending) && pending.length > 0) {
                    pending.forEach(async (row) => {
                        try {
                            await sendMail({ to: row.email, subject, html, text: `Your analysis is complete. View: ${viewUrl}` });
                            db.prepare('UPDATE notification_subscriptions SET status = ?, sent_at = CURRENT_TIMESTAMP WHERE id = ?').run('sent', row.id);
                        } catch (mailErr) {
                            console.error('Failed to send email notification:', mailErr);
                            db.prepare('UPDATE notification_subscriptions SET status = ?, error_message = ? WHERE id = ?').run('failed', String(mailErr), row.id);
                        }
                    });
                }
            } catch (notifyErr) {
                console.error('Notification error:', notifyErr);
            }
        } else {
            console.error(`Python script failed with code ${code}`);
            // Mark analysis as failed
            try {
                db.prepare('UPDATE analyses SET status = ? WHERE id = ?')
                  .run('failed', analysisId);
            } catch (err) {
                console.error('Failed to set analysis status to failed:', err);
            }
            res.status(500).json({
                success: false,
                message: 'Python script failed',
                error: errorOutput
            });

            // On failure, also notify subscribers about failure
            try {
                const publicBase = process.env.PUBLIC_BASE_URL || 'http://localhost:3000';
                const viewUrl = `${publicBase}/#/results/${analysisId}`;
                const subject = 'Your analysis has failed';
                const html = `<div style="font-family:Arial,sans-serif;font-size:14px;color:#333">`
                  + `<p>Unfortunately, your analysis failed. You may try again or check logs.</p>`
                  + `<p>You can still open the results viewer page: <a href="${viewUrl}">${viewUrl}</a></p>`
                  + `</div>`;
                const pending = db.prepare('SELECT id, email FROM notification_subscriptions WHERE job_id = ? AND status = ?').all(analysisId, 'pending');
                if (Array.isArray(pending) && pending.length > 0) {
                    pending.forEach(async (row) => {
                        try {
                            await sendMail({ to: row.email, subject, html, text: `Your analysis failed. View: ${viewUrl}` });
                            db.prepare('UPDATE notification_subscriptions SET status = ?, sent_at = CURRENT_TIMESTAMP WHERE id = ?').run('sent', row.id);
                        } catch (mailErr) {
                            console.error('Failed to send failure email notification:', mailErr);
                            db.prepare('UPDATE notification_subscriptions SET status = ?, error_message = ? WHERE id = ?').run('failed', String(mailErr), row.id);
                        }
                    });
                }
            } catch (notifyErr) {
                console.error('Notification error:', notifyErr);
            }
        }
    });
});

// step8 - Endpoint to summarize statistical methods
app.post('/summarize_statistical_methods', (req, res) => {
    console.log("At summarize statistical methods endpoint.")
    const featureCount = req.body.featureCount || 10; // Default is 10
    const filePath = req.body.filePath;
    const selectedClassPair = req.body.selectedClassPair; // User-selected class pair (optional)
    
    // Ownership check: ensure the request's session owns this file
    try {
        const derivedUploadId = path.basename(filePath).split('_')[0];
        const uploadOwner = db.prepare('SELECT session_id FROM uploads WHERE id = ?').get(derivedUploadId);
        if (!uploadOwner || uploadOwner.session_id !== req.sessionId) {
            return res.status(403).json({ success: false, message: 'Access denied for this file' });
        }
    } catch (e) {
        console.error('Ownership check failed:', e);
        return res.status(500).json({ success: false, message: 'Internal server error' });
    }
    
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
            ]);
            
            let outputData = '';
            python.stdout.on('data', (data) => {
                outputData += data.toString();
            });
            
            let sumErr = '';
            python.stderr.on('data', (data) => {
                console.error(`stderr: ${data}`);
                sumErr += data.toString();
            });
            
            python.on('close', (code) => {
                if (code !== 0) {
                    console.error(`Python process exited with code ${code}`);
                    return res.status(500).json({ success: false, message: 'Process failed', error: sumErr });
                }
                
                // Clean up line endings
                const cleanedOutput = outputData.trim();
                console.log(`Python process output: ${cleanedOutput}`);
                
                // Best effort legacy CSV path
                const legacyCsvPath = path.join('results', fileName, 'ranked_features_df.csv');
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
        ]);

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
        ]);

        const maybeRerank = runRerank();
        let outputData = '';
        const finalize = () => {
            const py = runSummary(aggLabel);
            let sumErr = '';
            py.stdout.on('data', (data) => { outputData += data.toString(); console.log(`Python stdout: ${data}`); });
            py.stderr.on('data', (data) => { console.error(`stderr: ${data}`); sumErr += data.toString(); });
            py.on('close', (code) => {
                if (code !== 0) {
                    console.error(`Python process exited with code ${code}`);
                    return res.status(500).json({ success: false, message: 'Process failed', error: sumErr });
                }
                const cleanedOutput = outputData.trim();
                console.log(`Python process output: ${cleanedOutput}`);
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
app.post('/api/analysis/notify', (req, res) => {
    try {
        const { jobId, email } = req.body || {};
        if (!jobId || !email) {
            return res.status(400).json({ success: false, message: 'jobId and email are required' });
        }
        if (!isValidEmail(email)) {
            return res.status(400).json({ success: false, message: 'Invalid email address' });
        }
        const id = uuidv4();
        db.prepare('INSERT INTO notification_subscriptions (id, job_id, email, status) VALUES (?,?,?,?)')
          .run(id, jobId, email, 'pending');
        return res.json({ success: true, id });
    } catch (e) {
        console.error('Failed to save notification subscription:', e);
        return res.status(500).json({ success: false, message: 'Internal server error' });
    }
});

// Public endpoint for results viewer to fetch analysis state
app.get('/api/analyses/:analysisId', (req, res) => {
    try {
        const row = db.prepare('SELECT id, result_path, status, created_at FROM analyses WHERE id = ?').get(req.params.analysisId);
        if (!row) return res.status(404).json({ success: false, message: 'Analysis not found' });
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