const express = require('express');
const { spawn } = require('child_process');
const path = require('path');

const router = express.Router();

const PYTHON_SCRIPT = path.join(__dirname, '..', 'services', 'biomarker_validation.py');
const getPythonCommand = () => (process.platform === 'win32' ? 'python' : 'python3');
const VALIDATION_GENE_CAP_OPTIONS = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
const FALLBACK_GENE_CAP = VALIDATION_GENE_CAP_OPTIONS[0];

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
    if (code !== 0) {
      const err = new Error('Python biomarker validation failed');
      err.details = stderr || stdout;
      return reject(err);
    }
    try {
      const parsed = JSON.parse(stdout.trim() || '{}');
      if (!parsed || parsed.success === false) {
        const err = new Error(parsed?.message || 'Python biomarker validation returned an error');
        return reject(err);
      }
      return resolve(parsed);
    } catch (parseErr) {
      const err = new Error('Unable to parse biomarker validation response');
      err.details = stdout;
      return reject(err);
    }
  });

  python.on('error', (err) => {
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

module.exports = router;
