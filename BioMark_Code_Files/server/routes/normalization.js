const express = require('express');
const { spawn } = require('child_process');
const path = require('path');

const router = express.Router();

const getPythonCommand = () => (process.platform === 'win32' ? 'python' : 'python3');
const NORMALIZATION_SCRIPT = path.join(__dirname, '..', 'services', 'normalize_pipeline.py');

const runNormalizationTemplate = (payload) => new Promise((resolve, reject) => {
  const python = spawn(getPythonCommand(), ['-Xfrozen_modules=off', NORMALIZATION_SCRIPT], {
    stdio: ['pipe', 'pipe', 'pipe']
  });

  let stdout = '';
  let stderr = '';

  python.stdout.on('data', (data) => {
    stdout += data.toString();
  });

  python.stderr.on('data', (data) => {
    stderr += data.toString();
  });

  python.on('error', (err) => {
    reject(err);
  });

  python.on('close', (code) => {
    if (code !== 0) {
      const err = new Error('Normalization template script failed.');
      err.details = stderr || `Process exited with code ${code}`;
      return reject(err);
    }

    try {
      const parsed = JSON.parse((stdout || '').trim() || '{}');
      resolve(parsed);
    } catch (parseErr) {
      const err = new Error('Failed to parse normalization template response.');
      err.details = stdout;
      reject(err);
    }
  });

  python.stdin.write(JSON.stringify(payload || {}));
  python.stdin.end();
});

router.post('/normalize-dataset', async (req, res) => {
  try {
    const body = req.body || {};

    if (!body.filePath || typeof body.filePath !== 'string') {
      return res.status(400).json({
        success: false,
        message: 'filePath is required for normalization.'
      });
    }

    if (!body.normalizationPipeline || typeof body.normalizationPipeline !== 'object') {
      return res.status(400).json({
        success: false,
        message: 'normalizationPipeline object is required.'
      });
    }

    const result = await runNormalizationTemplate(body);

    if (!result || result.success === false) {
      return res.status(400).json({
        success: false,
        message: result?.message || 'Normalization request is invalid.',
        data: result?.data || null,
      });
    }

    return res.json(result);
  } catch (error) {
    console.error('Normalization route failed:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to process normalization request.',
      error: error?.details || error?.message || 'Unknown server error'
    });
  }
});

module.exports = router;
