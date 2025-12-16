const express = require('express');
const db = require('../db/database');
const authMiddleware = require('../middleware/auth');
const { verifyToken } = require('../middleware/auth');

const router = express.Router();

// Get user statistics
router.get('/stats', verifyToken, async (req, res) => {
  try {
    const userId = req.userId;
    
    // Get total uploads
    const uploadsCount = await db.query('SELECT COUNT(*) as count FROM uploads WHERE user_id = $1', [userId]);
    
    // Get total analyses (both single-upload and merged-file analyses)
    const analysesQuery = await db.query(`
      SELECT COUNT(*) as count 
      FROM analyses a
      WHERE a.user_id = $1
    `, [userId]);
    
    // Get account creation date
    const account = await db.query('SELECT created_at FROM accounts WHERE id = $1', [userId]);
    
    return res.json({
      success: true,
      stats: {
        totalUploads: uploadsCount.rows[0].count,
        totalAnalyses: analysesQuery.rows[0].count,
        accountCreated: account.rows[0].created_at
      }
    });
  } catch (err) {
    console.error('Error fetching stats:', err);
    return res.status(500).json({ success: false, message: 'Failed to fetch statistics' });
  }
});

// Get user's analyses
router.get('/analyses', authMiddleware, async (req, res) => {
  try {
    const userId = req.userId;
    const sessionId = req.session_id;
    
    let analyses;
    if (userId) {
      // Registered user - get all analyses including parent_analysis_id
      const result = await db.query(`
        SELECT 
          a.id,
          a.upload_id,
          a.merged_file_id,
          a.result_path,
          a.status,
          a.created_at,
          a.analysis_metadata,
          a.parent_analysis_id,
          COALESCE(u.original_name, mu.original_name) as filename
        FROM analyses a
        LEFT JOIN uploads u ON a.upload_id = u.id
        LEFT JOIN uploads mu ON a.merged_file_id = mu.id
        WHERE a.user_id = $1
        ORDER BY a.created_at DESC
      `, [userId]);
      analyses = result.rows;
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
    
    // Group analyses by parent-child relationships
    const groupedAnalyses = [];
    const processedIds = new Set();
    
    enhancedAnalyses.forEach(analysis => {
      // Skip if already processed as a child
      if (processedIds.has(analysis.id)) {
        return;
      }
      
      // If this analysis has no parent, it's either standalone or a parent
      if (!analysis.parent_analysis_id) {
        // Check if this analysis has children
        const children = enhancedAnalyses.filter(a => a.parent_analysis_id === analysis.id);
        
        if (children.length > 0) {
          // This is a parent with children - create a group
          groupedAnalyses.push({
            ...analysis,
            isGroup: true,
            childAnalyses: children,
            analysisCount: children.length + 1
          });
          
          // Mark children as processed
          children.forEach(child => processedIds.add(child.id));
        } else {
          // This is a standalone analysis
          groupedAnalyses.push({
            ...analysis,
            isGroup: false
          });
        }
        
        processedIds.add(analysis.id);
      }
    });
    
    return res.json({
      success: true,
      analyses: groupedAnalyses
    });
  } catch (err) {
    console.error('Error fetching analyses:', err);
    return res.status(500).json({ success: false, message: 'Failed to fetch analyses' });
  }
});
// Get a single analysis by ID
router.get('/analyses/:id', authMiddleware, async (req, res) => {
  try {
    const userId = req.userId;
    const sessionId = req.session_id;
    const analysisId = req.params.id;
    
    // Support both registered users and guest sessions
    let analysis;
    let childAnalyses = [];
    
    if (userId) {
      // Registered user
      const result = await db.query(`
        SELECT 
          a.id,
          a.upload_id,
          a.merged_file_id,
          a.result_path,
          a.status,
          a.created_at,
          a.analysis_metadata,
          a.parent_analysis_id,
          COALESCE(u.original_name, mu.original_name) as filename
        FROM analyses a
        LEFT JOIN uploads u ON a.upload_id = u.id
        LEFT JOIN uploads mu ON a.merged_file_id = mu.id
        WHERE a.id = $1 AND a.user_id = $2
      `, [analysisId, userId]);
      analysis = result.rows[0];
      
      // Fetch child analyses if this is a parent
      if (analysis && !analysis.parent_analysis_id) {
        const childResult = await db.query(`
          SELECT 
            a.id,
            a.upload_id,
            a.merged_file_id,
            a.result_path,
            a.status,
            a.created_at,
            a.analysis_metadata,
            a.parent_analysis_id,
            COALESCE(u.original_name, mu.original_name) as filename
          FROM analyses a
          LEFT JOIN uploads u ON a.upload_id = u.id
          LEFT JOIN uploads mu ON a.merged_file_id = mu.id
          WHERE a.parent_analysis_id = $1 AND a.user_id = $2
          ORDER BY a.created_at ASC
        `, [analysisId, userId]);
        childAnalyses = childResult.rows;
      }
    } else if (sessionId) {
      // Guest user - ensure user_id is NULL to distinguish from registered users
      const result = await db.query(`
        SELECT 
          a.id,
          a.upload_id,
          a.merged_file_id,
          a.result_path,
          a.status,
          a.created_at,
          a.analysis_metadata,
          a.parent_analysis_id,
          COALESCE(u.original_name, mu.original_name) as filename
        FROM analyses a
        LEFT JOIN uploads u ON a.upload_id = u.id
        LEFT JOIN uploads mu ON a.merged_file_id = mu.id
        WHERE a.id = $1 AND a.session_id = $2 AND a.user_id IS NULL
      `, [analysisId, sessionId]);
      analysis = result.rows[0];
      
      // Fetch child analyses if this is a parent
      if (analysis && !analysis.parent_analysis_id) {
        const childResult = await db.query(`
          SELECT 
            a.id,
            a.upload_id,
            a.merged_file_id,
            a.result_path,
            a.status,
            a.created_at,
            a.analysis_metadata,
            a.parent_analysis_id,
            COALESCE(u.original_name, mu.original_name) as filename
          FROM analyses a
          LEFT JOIN uploads u ON a.upload_id = u.id
          LEFT JOIN uploads mu ON a.merged_file_id = mu.id
          WHERE a.parent_analysis_id = $1 AND a.session_id = $2 AND a.user_id IS NULL
          ORDER BY a.created_at ASC
        `, [analysisId, sessionId]);
        childAnalyses = childResult.rows;
      }
    } else {
      return res.status(401).json({ success: false, message: 'Authentication required' });
    }
    
    if (!analysis) {
      return res.status(404).json({ success: false, message: 'Analysis not found' });
    }
    
    // Parse analysis metadata for main analysis
    if (analysis.analysis_metadata) {
      try {
        analysis.metadata = JSON.parse(analysis.analysis_metadata);
      } catch (err) {
        console.error('Error parsing analysis metadata:', err);
        analysis.metadata = null;
      }
    }
    delete analysis.analysis_metadata;
    
    // Parse metadata for child analyses
    childAnalyses = childAnalyses.map(child => {
      if (child.analysis_metadata) {
        try {
          child.metadata = JSON.parse(child.analysis_metadata);
        } catch (err) {
          console.error('Error parsing child analysis metadata:', err);
          child.metadata = null;
        }
      }
      delete child.analysis_metadata;
      return child;
    });
    
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
    
    // Add child analyses info
    if (childAnalyses.length > 0) {
      analysis.isGroup = true;
      analysis.childAnalyses = childAnalyses;
      analysis.analysisCount = childAnalyses.length + 1;
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
router.get('/guest/last-analysis', authMiddleware, async (req, res) => {
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
    const result = await db.query(`
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
      WHERE a.session_id = $1 AND a.user_id IS NULL
      ORDER BY a.created_at DESC
      LIMIT 1
    `, [sessionId]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'No analysis found' });
    }
    
    const analysis = result.rows[0];
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
