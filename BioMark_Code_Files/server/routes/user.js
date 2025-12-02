const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db/database');
const { verifyToken } = require('../middleware/auth');
const authMiddleware = require('../middleware/auth');

const router = express.Router();

// Get user statistics
router.get('/stats', verifyToken, (req, res) => {
  try {
    const userId = req.userId;
    
    // Get total uploads
    const uploadsCount = db.prepare('SELECT COUNT(*) as count FROM uploads WHERE user_id = ?').get(userId);
    
    // Get total analyses (both single-upload and merged-file analyses)
    const analysesQuery = db.prepare(`
      SELECT COUNT(*) as count 
      FROM analyses a
      WHERE a.user_id = ?
    `).get(userId);
    
    // Get account creation date
    const account = db.prepare('SELECT created_at FROM accounts WHERE id = ?').get(userId);
    
    return res.json({
      success: true,
      stats: {
        totalUploads: uploadsCount.count,
        totalAnalyses: analysesQuery.count,
        accountCreated: account.created_at
      }
    });
  } catch (err) {
    console.error('Error fetching stats:', err);
    return res.status(500).json({ success: false, message: 'Failed to fetch statistics' });
  }
});

// Get user's analyses
router.get('/analyses', authMiddleware, (req, res) => {
  try {
    const userId = req.userId;
    const sessionId = req.session_id;
    
    let analyses;
    if (userId) {
      // Registered user - get all analyses
      analyses = db.prepare(`
        SELECT 
          a.id,
          a.upload_id,
          a.merged_file_id,
          a.result_path,
          a.status,
          a.created_at,
          a.analysis_metadata,
          COALESCE(u.original_name, mu.original_name) as filename
        FROM analyses a
        LEFT JOIN uploads u ON a.upload_id = u.id
        LEFT JOIN uploads mu ON a.merged_file_id = mu.id
        WHERE a.user_id = ?
        ORDER BY a.created_at DESC
      `).all(userId);
    } else if (sessionId) {
      // Guest user - redirect to last analysis endpoint
      return res.status(403).json({ 
        success: false, 
        message: 'Guest users should use /api/user/guest/last-analysis endpoint',
        isGuest: true 
      });
    } else {
      return res.status(401).json({ success: false, message: 'Authentication required' });
    }
    
    // Enhance analyses with merged file information and parse metadata
    const enhancedAnalyses = analyses.map(analysis => {
      // Parse analysis metadata
      if (analysis.analysis_metadata) {
        try {
          analysis.metadata = JSON.parse(analysis.analysis_metadata);
        } catch (err) {
          console.error('Error parsing analysis metadata:', err);
          analysis.metadata = null;
        }
      }
      delete analysis.analysis_metadata; // Remove raw JSON string
      
      if (analysis.merged_file_id) {
        analysis.isMerged = true;
        // Filename is already set from the uploads table join
        // Wrap it with "Merged Files (...)" for display
        if (analysis.filename) {
          analysis.filename = `Merged Files (${analysis.filename})`;
        } else {
          analysis.filename = `Merged file (${analysis.merged_file_id})`;
        }
      } else {
        analysis.isMerged = false;
      }
      return analysis;
    });
    
    return res.json({
      success: true,
      analyses: enhancedAnalyses
    });
  } catch (err) {
    console.error('Error fetching analyses:', err);
    return res.status(500).json({ success: false, message: 'Failed to fetch analyses' });
  }
});

// Get a single analysis by ID
router.get('/analyses/:id', authMiddleware, (req, res) => {
  try {
    const userId = req.userId;
    const sessionId = req.session_id;
    const analysisId = req.params.id;
    
    // Support both registered users and guest sessions
    let analysis;
    if (userId) {
      // Registered user
      analysis = db.prepare(`
        SELECT 
          a.id,
          a.upload_id,
          a.merged_file_id,
          a.result_path,
          a.status,
          a.created_at,
          a.analysis_metadata,
          COALESCE(u.original_name, mu.original_name) as filename
        FROM analyses a
        LEFT JOIN uploads u ON a.upload_id = u.id
        LEFT JOIN uploads mu ON a.merged_file_id = mu.id
        WHERE a.id = ? AND a.user_id = ?
      `).get(analysisId, userId);
    } else if (sessionId) {
      // Guest user - ensure user_id is NULL to distinguish from registered users
      analysis = db.prepare(`
        SELECT 
          a.id,
          a.upload_id,
          a.merged_file_id,
          a.result_path,
          a.status,
          a.created_at,
          a.analysis_metadata,
          COALESCE(u.original_name, mu.original_name) as filename
        FROM analyses a
        LEFT JOIN uploads u ON a.upload_id = u.id
        LEFT JOIN uploads mu ON a.merged_file_id = mu.id
        WHERE a.id = ? AND a.session_id = ? AND a.user_id IS NULL
      `).get(analysisId, sessionId);
    } else {
      return res.status(401).json({ success: false, message: 'Authentication required' });
    }
    
    if (!analysis) {
      return res.status(404).json({ success: false, message: 'Analysis not found' });
    }
    
    // Parse analysis metadata
    if (analysis.analysis_metadata) {
      try {
        analysis.metadata = JSON.parse(analysis.analysis_metadata);
      } catch (err) {
        console.error('Error parsing analysis metadata:', err);
        analysis.metadata = null;
      }
    }
    delete analysis.analysis_metadata; // Remove raw JSON string
    
    // Enhance with merged file information
    if (analysis.merged_file_id) {
      analysis.isMerged = true;
      // Filename is already set from the uploads table join
      // Wrap it with "Merged Files (...)" for display
      if (analysis.filename) {
        analysis.filename = `Merged Files (${analysis.filename})`;
      } else {
        analysis.filename = `Merged file (${analysis.merged_file_id})`;
      }
    } else {
      analysis.isMerged = false;
    }
    
    return res.json({
      success: true,
      analysis
    });
  } catch (err) {
    console.error('Error fetching analysis:', err);
    return res.status(500).json({ success: false, message: 'Failed to fetch analysis' });
  }
});

// Get last analysis for guest users
router.get('/guest/last-analysis', authMiddleware, (req, res) => {
  try {
    console.log('Guest last analysis - req.session_id:', req.session_id, '| req.userId:', req.userId);
    
    // Ensure this is a guest session
    if (!req.session_id) {
      console.log('No session_id found, returning 401');
      return res.status(401).json({ success: false, message: 'Guest session required' });
    }
    
    const sessionId = req.session_id;
    console.log('Searching for analysis with session_id:', sessionId);
    
    // Get the most recent analysis for this guest session (where user_id is NULL)
    const analysis = db.prepare(`
      SELECT 
        a.id,
        a.upload_id,
        a.merged_file_id,
        a.result_path,
        a.status,
        a.created_at,
        a.analysis_metadata,
        COALESCE(u.original_name, mu.original_name) as filename
      FROM analyses a
      LEFT JOIN uploads u ON a.upload_id = u.id
      LEFT JOIN uploads mu ON a.merged_file_id = mu.id
      WHERE a.session_id = ? AND a.user_id IS NULL
      ORDER BY a.created_at DESC
      LIMIT 1
    `).get(sessionId);
    
    if (!analysis) {
      return res.status(404).json({ success: false, message: 'No analysis found' });
    }
    
    // Parse analysis metadata
    if (analysis.analysis_metadata) {
      try {
        analysis.metadata = JSON.parse(analysis.analysis_metadata);
      } catch (err) {
        console.error('Error parsing analysis metadata:', err);
        analysis.metadata = null;
      }
    }
    delete analysis.analysis_metadata; // Remove raw JSON string
    
    // Enhance with merged file information
    if (analysis.merged_file_id) {
      analysis.isMerged = true;
      if (analysis.filename) {
        analysis.filename = `Merged Files (${analysis.filename})`;
      } else {
        analysis.filename = `Merged file (${analysis.merged_file_id})`;
      }
    } else {
      analysis.isMerged = false;
    }
    
    return res.json({
      success: true,
      analysis
    });
  } catch (err) {
    console.error('Error fetching guest last analysis:', err);
    return res.status(500).json({ success: false, message: 'Failed to fetch analysis' });
  }
});

module.exports = router;
