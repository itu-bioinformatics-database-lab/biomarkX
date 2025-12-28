const express = require('express');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const db = require('../db/database');
const authMiddleware = require('../middleware/auth');

const router = express.Router();

const PYTHON_SCRIPT = path.join(__dirname, '..', 'services', 'biomarker_validation.py');
const VALIDATION_LOG = path.join(__dirname, '..', 'logs', 'biomarker_validation.log');
const getPythonCommand = () => (process.platform === 'win32' ? 'python' : 'python3');
const VALIDATION_GENE_CAP_OPTIONS = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
const FALLBACK_GENE_CAP = VALIDATION_GENE_CAP_OPTIONS[0];

const appendValidationLog = (lines) => {
  try {
    fs.mkdirSync(path.dirname(VALIDATION_LOG), { recursive: true });
    const payload = Array.isArray(lines) ? lines : [lines];
    const stamped = payload.map((line) => `${new Date().toISOString()} ${line}`).join('\n');
    fs.appendFileSync(VALIDATION_LOG, `${stamped}\n`, 'utf8');
  } catch (err) {
    console.error('Unable to write biomarker validation log:', err);
  }
};

const runPythonValidation = (genes, maxGenes) => new Promise((resolve, reject) => {
  const python = spawn(getPythonCommand(), ['-Xfrozen_modules=off', PYTHON_SCRIPT], {
    stdio: ['pipe', 'pipe', 'pipe']
  });

  const effectiveMax = VALIDATION_GENE_CAP_OPTIONS.includes(maxGenes)
    ? maxGenes
    : FALLBACK_GENE_CAP;
  const inputPayload = JSON.stringify({ genes, maxGenes: effectiveMax });
  let stdout = '';
  let stderr = '';

  python.stdout.on('data', (data) => {
    stdout += data.toString();
  });

  python.stderr.on('data', (data) => {
    stderr += data.toString();
  });

  python.on('close', (code) => {
    const logLines = [
      `[input] ${inputPayload}`,
      `[exit] code=${code}`,
    ];
    if (code !== 0) {
      const err = new Error('Python biomarker validation failed');
      err.details = stderr || stdout;
      if (stderr.trim()) logLines.push(`[stderr] ${stderr.trim()}`);
      if (stdout.trim()) logLines.push(`[stdout] ${stdout.trim()}`);
      appendValidationLog(logLines);
      return reject(err);
    }
    try {
      const parsed = JSON.parse(stdout.trim() || '{}');
      if (!parsed || parsed.success === false) {
        const err = new Error(parsed?.message || 'Python biomarker validation returned an error');
        if (stderr.trim()) logLines.push(`[stderr] ${stderr.trim()}`);
        if (stdout.trim()) logLines.push(`[stdout] ${stdout.trim()}`);
        appendValidationLog(logLines);
        return reject(err);
      }
      if (stderr.trim()) logLines.push(`[stderr] ${stderr.trim()}`);
      if (stdout.trim()) logLines.push(`[stdout] ${stdout.trim()}`);
      if (logLines.length) appendValidationLog(logLines);
      return resolve(parsed);
    } catch (parseErr) {
      const err = new Error('Unable to parse biomarker validation response');
      err.details = stdout;
      if (stderr.trim()) logLines.push(`[stderr] ${stderr.trim()}`);
      if (stdout.trim()) logLines.push(`[stdout] ${stdout.trim()}`);
      appendValidationLog(logLines);
      return reject(err);
    }
  });

  python.on('error', (err) => {
    appendValidationLog([
      `[input] ${inputPayload}`,
      `[spawn-error] ${err.message}`,
    ]);
    reject(err);
  });

  python.stdin.write(inputPayload);
  python.stdin.end();
});

router.post('/biomarker-validation', async (req, res) => {
  try {
    const genes = Array.isArray(req.body?.genes) ? req.body.genes : [];
    if (!genes.length) {
      return res.status(400).json({ success: false, message: 'Please provide at least one gene symbol.' });
    }
    const requestedMax = Number(req.body?.maxGenes);
    const maxGenes = VALIDATION_GENE_CAP_OPTIONS.includes(requestedMax) ? requestedMax : FALLBACK_GENE_CAP;
    const payload = await runPythonValidation(genes, maxGenes);
    return res.json({ success: true, ...payload });
  } catch (error) {
    console.error('Biomarker validation failed:', error);
    const message = error?.message || 'Failed to validate biomarkers';
    const details = error?.details || null;
    return res.status(500).json({ success: false, message, error: details || message });
  }
});

// Save biomarker validation results to analysis metadata
router.post('/biomarker-validation/save', authMiddleware, async (req, res) => {
  try {
    const { analysisId, validationData } = req.body;
    const userId = req.userId;
    const sessionId = req.session_id;
    
    if (!analysisId || !validationData) {
      return res.status(400).json({ success: false, message: 'Missing required parameters' });
    }
    
    // Verify the analysis belongs to this user
    let analysis;
    if (userId) {
      const result = await db.query('SELECT analysis_metadata FROM analyses WHERE id = $1 AND user_id = $2', [analysisId, userId]);
      analysis = result.rows[0];
    } else if (sessionId) {
      const result = await db.query('SELECT analysis_metadata FROM analyses WHERE id = $1 AND session_id = $2', [analysisId, sessionId]);
      analysis = result.rows[0];
    } else {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }
    
    if (!analysis) {
      return res.status(404).json({ success: false, message: 'Analysis not found' });
    }
    
    // Parse existing metadata
    let metadata = {};
    if (analysis.analysis_metadata) {
      try {
        metadata = JSON.parse(analysis.analysis_metadata);
      } catch (e) {
        console.error('Failed to parse existing metadata:', e);
      }
    }
    
    // Initialize biomarkerValidations array if it doesn't exist
    if (!metadata.biomarkerValidations) {
      metadata.biomarkerValidations = [];
    }
    
    // Add new biomarker validation data with timestamp to the array
    metadata.biomarkerValidations.push({
      ...validationData,
      timestamp: new Date().toISOString()
    });
    
    // Update the analysis metadata
    await db.query('UPDATE analyses SET analysis_metadata = $1 WHERE id = $2', [JSON.stringify(metadata), analysisId]);
    
    console.log(`Saved biomarker validation to analysis ${analysisId}`);
    
    return res.json({ success: true, message: 'Validation results saved successfully' });
  } catch (error) {
    console.error('Failed to save validation results:', error);
    return res.status(500).json({ success: false, message: 'Failed to save validation results' });
  }
});

module.exports = router;
