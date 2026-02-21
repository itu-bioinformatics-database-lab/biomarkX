const express = require('express');
const db = require('../db/database');
const authMiddleware = require('../middleware/auth');
const { verifyToken } = require('../middleware/auth');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');

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
          a.display_name,
          COALESCE(a.folder_ids, '{}') as folder_ids,
          COALESCE(a.is_favorite, false) as is_favorite,
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
        
        // Try to get a better filename from metadata or uploads table
        let baseFilename = analysis.filename;
        
        // If no filename from uploads table, try to get from metadata
        if (!baseFilename && analysis.metadata && analysis.metadata.datasetNames) {
          // metadata.datasetNames contains array of original file names
          baseFilename = analysis.metadata.datasetNames.join(', ');
        }
        
        if (baseFilename) {
          analysis.filename = `Merged Files (${baseFilename})`;
        } else {
          analysis.filename = `Merged_Files`;
        }
      } else {
        analysis.isMerged = false;
        // For single files, ensure we have a filename
        if (!analysis.filename && analysis.metadata && analysis.metadata.datasetNames && analysis.metadata.datasetNames.length > 0) {
          analysis.filename = analysis.metadata.datasetNames[0];
        } else if (!analysis.filename) {
          analysis.filename = 'Analysis_Results';
        }
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
      } else {
        // This is a child analysis - check if parent exists in our list
        const parentExists = enhancedAnalyses.some(a => a.id === analysis.parent_analysis_id);
        
        if (!parentExists) {
          // Parent doesn't exist - treat this as a standalone analysis
          console.log(`[User Analyses] Orphaned child analysis ${analysis.id} - treating as standalone`);
          groupedAnalyses.push({
            ...analysis,
            isGroup: false,
            parent_analysis_id: null // Clear parent reference since parent doesn't exist
          });
          processedIds.add(analysis.id);
        }
        // If parent exists, it will be processed when we encounter the parent
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
          a.display_name,
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
            a.display_name,
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
      
      // Try to get a better filename from metadata or uploads table
      let baseFilename = analysis.filename;
      
      // If no filename from uploads table, try to get from metadata
      if (!baseFilename && analysis.metadata && analysis.metadata.datasetNames) {
        // metadata.datasetNames contains array of original file names
        baseFilename = analysis.metadata.datasetNames.join(', ');
      }
      
      if (baseFilename) {
        analysis.filename = `Merged Files (${baseFilename})`;
      } else {
        analysis.filename = `Merged_Files`;
      }
    } else {
      analysis.isMerged = false;
      // For single files, ensure we have a filename
      if (!analysis.filename) {
        analysis.filename = 'Analysis_Results';
      }
    }
    
    // Add child analyses info
    if (childAnalyses.length > 0) {
      analysis.isGroup = true;
      analysis.childAnalyses = childAnalyses;
      analysis.analysisCount = childAnalyses.length + 1;
    }
    
    // Check if this is the latest analysis for this user
    let isLatest = false;
    if (userId) {
      const latestResult = await db.query(
        `SELECT id FROM analyses WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1`,
        [userId]
      );
      isLatest = latestResult.rows.length > 0 && latestResult.rows[0].id === analysisId;
    } else if (sessionId) {
      const latestResult = await db.query(
        `SELECT id FROM analyses WHERE session_id = $1 AND user_id IS NULL ORDER BY created_at DESC LIMIT 1`,
        [sessionId]
      );
      isLatest = latestResult.rows.length > 0 && latestResult.rows[0].id === analysisId;
    }
    
    return res.json({
      success: true,
      analysis,
      isLatest
    });
  } catch (err) {
    console.error('Error fetching analysis:', err);
    return res.status(500).json({ success: false, message: 'Failed to fetch analysis' });
  }
});

// Get analysis continuation data - returns all info needed to restore the analysis state
router.get('/analyses/:id/continue', authMiddleware, async (req, res) => {
  try {
    const userId = req.userId;
    const sessionId = req.session_id;
    const analysisId = req.params.id;
    
    // Get the main analysis
    let analysis;
    if (userId) {
      const result = await db.query(`
        SELECT 
          a.id,
          a.upload_id,
          a.merged_file_id,
          a.result_path,
          a.status,
          a.created_at,
          a.analysis_metadata,
          a.parent_analysis_id
        FROM analyses a
        WHERE a.id = $1 AND a.user_id = $2
      `, [analysisId, userId]);
      analysis = result.rows[0];
    } else if (sessionId) {
      const result = await db.query(`
        SELECT 
          a.id,
          a.upload_id,
          a.merged_file_id,
          a.result_path,
          a.status,
          a.created_at,
          a.analysis_metadata,
          a.parent_analysis_id
        FROM analyses a
        WHERE a.id = $1 AND a.session_id = $2 AND a.user_id IS NULL
      `, [analysisId, sessionId]);
      analysis = result.rows[0];
    } else {
      return res.status(401).json({ success: false, message: 'Authentication required' });
    }
    
    if (!analysis) {
      return res.status(404).json({ success: false, message: 'Analysis not found' });
    }
    
    // Get child analyses if this is a parent
    let childAnalyses = [];
    if (!analysis.parent_analysis_id) {
      let childResult;
      if (userId) {
        childResult = await db.query(`
          SELECT 
            a.id,
            a.upload_id,
            a.merged_file_id,
            a.result_path,
            a.status,
            a.created_at,
            a.analysis_metadata,
            a.parent_analysis_id
          FROM analyses a
          WHERE a.parent_analysis_id = $1 AND a.user_id = $2
          ORDER BY a.created_at ASC
        `, [analysisId, userId]);
      } else if (sessionId) {
        childResult = await db.query(`
          SELECT 
            a.id,
            a.upload_id,
            a.merged_file_id,
            a.result_path,
            a.status,
            a.created_at,
            a.analysis_metadata,
            a.parent_analysis_id
          FROM analyses a
          WHERE a.parent_analysis_id = $1 AND a.session_id = $2 AND a.user_id IS NULL
          ORDER BY a.created_at ASC
        `, [analysisId, sessionId]);
      }
      if (childResult) {
        childAnalyses = childResult.rows;
      }
    }
    
    // Parse metadata for all analyses
    const allAnalyses = [analysis, ...childAnalyses];
    const analysesData = allAnalyses.map(a => {
      let meta = {};
      if (a.analysis_metadata) {
        try {
          meta = JSON.parse(a.analysis_metadata);
        } catch (err) {
          console.error('Error parsing analysis metadata:', err);
        }
      }
      
      const imagePaths = a.result_path ? a.result_path.split(',').filter(p => p.trim()) : [];
      const hasAfterFSFolder = imagePaths.some(p => /AfterFeatureSelection/i.test(p));
      const producedFeatureScores = imagePaths.some(p => /(feature_importance|anova|t_test|wilcoxon_rank_sum|kruskal_wallis|shap|lime|feature_ranking)/i.test(p));
      
      return {
        analysisId: a.id,
        metadata: meta,
        resultPath: a.result_path,
        hasAfterFSFolder,
        producedFeatureScores,
        createdAt: a.created_at
      };
    });
    
    // Parse metadata for the main analysis (for file info)
    let metadata = {};
    if (analysis.analysis_metadata) {
      try {
        metadata = JSON.parse(analysis.analysis_metadata);
      } catch (err) {
        console.error('Error parsing analysis metadata:', err);
      }
    }

    const metadataFilePath = typeof metadata?.filePath === 'string' && metadata.filePath.trim()
      ? metadata.filePath.trim()
      : (typeof metadata?.normalizedFilePath === 'string' && metadata.normalizedFilePath.trim()
        ? metadata.normalizedFilePath.trim()
        : null);
    
    // Get the upload/merged file info
    let fileInfo = null;
    if (analysis.merged_file_id) {
      const fileResult = await db.query(
        'SELECT id, original_name, server_path FROM uploads WHERE id = $1',
        [analysis.merged_file_id]
      );
      if (fileResult.rows.length > 0) {
        fileInfo = {
          id: fileResult.rows[0].id,
          filename: fileResult.rows[0].original_name,
          filepath: metadataFilePath || fileResult.rows[0].server_path,
          isMerged: true
        };
      }
    } else if (analysis.upload_id) {
      const fileResult = await db.query(
        'SELECT id, original_name, server_path FROM uploads WHERE id = $1',
        [analysis.upload_id]
      );
      if (fileResult.rows.length > 0) {
        fileInfo = {
          id: fileResult.rows[0].id,
          filename: fileResult.rows[0].original_name,
          filepath: metadataFilePath || fileResult.rows[0].server_path,
          isMerged: /_merged_dataset/i.test(metadataFilePath || fileResult.rows[0].server_path || '')
        };
      }
    }

    if (!fileInfo && metadataFilePath) {
      fileInfo = {
        id: null,
        filename: path.basename(metadataFilePath),
        filepath: metadataFilePath,
        isMerged: /_merged_dataset/i.test(metadataFilePath)
      };
    }
    
    return res.json({
      success: true,
      continuationData: {
        fileInfo,
        analyses: analysesData // Return all analyses (parent + children)
      }
    });
  } catch (err) {
    console.error('Error fetching analysis continuation data:', err);
    return res.status(500).json({ success: false, message: 'Failed to fetch analysis continuation data' });
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

// ==================== FOLDER MANAGEMENT ====================

// Get all folders for user
router.get('/folders', verifyToken, async (req, res) => {
  try {
    const userId = req.userId;
    
    if (!userId) {
      return res.status(401).json({ success: false, message: 'Authentication required' });
    }
    
    const result = await db.query(
      'SELECT id, name, created_at FROM folders WHERE user_id = $1 ORDER BY name ASC',
      [userId]
    );
    
    return res.json({
      success: true,
      folders: result.rows
    });
  } catch (err) {
    console.error('Error fetching folders:', err);
    return res.status(500).json({ success: false, message: 'Failed to fetch folders' });
  }
});

// Create a new folder
router.post('/folders', verifyToken, async (req, res) => {
  try {
    const userId = req.userId;
    const { name } = req.body;
    
    if (!userId) {
      return res.status(401).json({ success: false, message: 'Authentication required' });
    }
    
    if (!name || !name.trim()) {
      return res.status(400).json({ success: false, message: 'Folder name is required' });
    }
    
    // Check for duplicate name (case-insensitive)
    const duplicateCheck = await db.query(
      'SELECT id FROM folders WHERE user_id = $1 AND LOWER(name) = LOWER($2)',
      [userId, name.trim()]
    );
    
    if (duplicateCheck.rows.length > 0) {
      return res.status(400).json({ success: false, message: 'A list with this name already exists' });
    }
    
    const folderId = uuidv4();
    const result = await db.query(
      'INSERT INTO folders (id, user_id, name) VALUES ($1, $2, $3) RETURNING id, name, created_at',
      [folderId, userId, name.trim()]
    );
    
    return res.json({
      success: true,
      folder: result.rows[0]
    });
  } catch (err) {
    console.error('Error creating folder:', err);
    return res.status(500).json({ success: false, message: 'Failed to create folder' });
  }
});

// Update folder name
router.put('/folders/:id', verifyToken, async (req, res) => {
  try {
    const userId = req.userId;
    const folderId = req.params.id;
    const { name } = req.body;
    
    if (!userId) {
      return res.status(401).json({ success: false, message: 'Authentication required' });
    }
    
    if (!name || !name.trim()) {
      return res.status(400).json({ success: false, message: 'Folder name is required' });
    }
    
    const result = await db.query(
      'UPDATE folders SET name = $1 WHERE id = $2 AND user_id = $3 RETURNING id, name, created_at',
      [name.trim(), folderId, userId]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Folder not found' });
    }
    
    return res.json({
      success: true,
      folder: result.rows[0]
    });
  } catch (err) {
    console.error('Error updating folder:', err);
    return res.status(500).json({ success: false, message: 'Failed to update folder' });
  }
});

// Delete folder (removes folder from all analyses' folder_ids)
router.delete('/folders/:id', verifyToken, async (req, res) => {
  try {
    const userId = req.userId;
    const folderId = req.params.id;
    
    if (!userId) {
      return res.status(401).json({ success: false, message: 'Authentication required' });
    }
    
    // First, remove this folder from all analyses' folder_ids arrays
    await db.query(
      'UPDATE analyses SET folder_ids = array_remove(folder_ids, $1) WHERE user_id = $2 AND $1 = ANY(folder_ids)',
      [folderId, userId]
    );
    
    // Then delete the folder
    const result = await db.query(
      'DELETE FROM folders WHERE id = $1 AND user_id = $2 RETURNING id',
      [folderId, userId]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Folder not found' });
    }
    
    return res.json({ success: true });
  } catch (err) {
    console.error('Error deleting folder:', err);
    return res.status(500).json({ success: false, message: 'Failed to delete folder' });
  }
});

// ==================== ANALYSIS ORGANIZATION ====================

// Toggle favorite status
router.put('/analyses/:id/favorite', verifyToken, async (req, res) => {
  try {
    const userId = req.userId;
    const analysisId = req.params.id;
    const { is_favorite } = req.body;
    
    if (!userId) {
      return res.status(401).json({ success: false, message: 'Authentication required' });
    }
    
    const result = await db.query(
      'UPDATE analyses SET is_favorite = $1 WHERE id = $2 AND user_id = $3 RETURNING id, is_favorite',
      [is_favorite, analysisId, userId]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Analysis not found' });
    }
    
    return res.json({
      success: true,
      analysis: result.rows[0]
    });
  } catch (err) {
    console.error('Error updating favorite:', err);
    return res.status(500).json({ success: false, message: 'Failed to update favorite status' });
  }
});

// Update analysis display name (custom name)
router.put('/analyses/:id/display-name', verifyToken, async (req, res) => {
  try {
    const userId = req.userId;
    const analysisId = req.params.id;
    const { display_name } = req.body;
    
    if (!userId) {
      return res.status(401).json({ success: false, message: 'Authentication required' });
    }
    
    // Validate display_name (allow empty string to reset, but limit length)
    if (display_name && display_name.length > 200) {
      return res.status(400).json({ success: false, message: 'Display name too long (max 200 characters)' });
    }
    
    // Set to null if empty string (to reset to original filename)
    const nameToSet = display_name && display_name.trim() ? display_name.trim() : null;
    
    const result = await db.query(
      'UPDATE analyses SET display_name = $1 WHERE id = $2 AND user_id = $3 RETURNING id, display_name',
      [nameToSet, analysisId, userId]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Analysis not found' });
    }
    
    return res.json({
      success: true,
      analysis: result.rows[0]
    });
  } catch (err) {
    console.error('Error updating display name:', err);
    return res.status(500).json({ success: false, message: 'Failed to update display name' });
  }
});

// Update analysis lists (add to multiple lists)
router.put('/analyses/:id/lists', verifyToken, async (req, res) => {
  try {
    const userId = req.userId;
    const analysisId = req.params.id;
    const { folder_ids } = req.body;
    
    if (!userId) {
      return res.status(401).json({ success: false, message: 'Authentication required' });
    }
    
    // Verify all folder_ids belong to the user
    if (folder_ids && folder_ids.length > 0) {
      const folderCheck = await db.query(
        'SELECT id FROM folders WHERE id = ANY($1) AND user_id = $2',
        [folder_ids, userId]
      );
      
      if (folderCheck.rows.length !== folder_ids.length) {
        return res.status(400).json({ success: false, message: 'Invalid folder IDs' });
      }
    }
    
    const result = await db.query(
      'UPDATE analyses SET folder_ids = $1 WHERE id = $2 AND user_id = $3 RETURNING id, folder_ids',
      [folder_ids || [], analysisId, userId]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Analysis not found' });
    }
    
    return res.json({
      success: true,
      analysis: result.rows[0]
    });
  } catch (err) {
    console.error('Error updating analysis lists:', err);
    return res.status(500).json({ success: false, message: 'Failed to update analysis lists' });
  }
});

// Move analysis to folder (legacy, single folder)
router.put('/analyses/:id/folder', verifyToken, async (req, res) => {
  try {
    const userId = req.userId;
    const analysisId = req.params.id;
    const { folder_id } = req.body;
    
    if (!userId) {
      return res.status(401).json({ success: false, message: 'Authentication required' });
    }
    
    // If folder_id is provided, verify it belongs to the user
    if (folder_id) {
      const folderCheck = await db.query(
        'SELECT id FROM folders WHERE id = $1 AND user_id = $2',
        [folder_id, userId]
      );
      
      if (folderCheck.rows.length === 0) {
        return res.status(404).json({ success: false, message: 'Folder not found' });
      }
    }
    
    const result = await db.query(
      'UPDATE analyses SET folder_id = $1 WHERE id = $2 AND user_id = $3 RETURNING id, folder_id',
      [folder_id, analysisId, userId]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Analysis not found' });
    }
    
    return res.json({
      success: true,
      analysis: result.rows[0]
    });
  } catch (err) {
    console.error('Error moving analysis:', err);
    return res.status(500).json({ success: false, message: 'Failed to move analysis' });
  }
});

// Delete analysis (and its children)
router.delete('/analyses/:id', verifyToken, async (req, res) => {
  try {
    const userId = req.userId;
    const analysisId = req.params.id;
    
    if (!userId) {
      return res.status(401).json({ success: false, message: 'Authentication required' });
    }
    
    // First, get the analysis to verify ownership and get result paths
    const analysisResult = await db.query(
      'SELECT id, result_path FROM analyses WHERE id = $1 AND user_id = $2',
      [analysisId, userId]
    );
    
    if (analysisResult.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Analysis not found' });
    }
    
    // Get all child analyses
    const childrenResult = await db.query(
      'SELECT id, result_path FROM analyses WHERE parent_analysis_id = $1 AND user_id = $2',
      [analysisId, userId]
    );
    
    // Collect all result paths to delete (parent + children)
    const allAnalyses = [analysisResult.rows[0], ...childrenResult.rows];
    const resultPaths = [];
    
    for (const analysis of allAnalyses) {
      if (analysis.result_path) {
        const paths = analysis.result_path.split(',').map(p => p.trim()).filter(p => p);
        resultPaths.push(...paths);
      }
    }
    
    // Delete result files from filesystem
    const resultsDir = path.join(__dirname, '..', 'results');
    for (const resultPath of resultPaths) {
      try {
        const fullPath = path.join(__dirname, '..', resultPath);
        if (fs.existsSync(fullPath)) {
          fs.unlinkSync(fullPath);
          console.log(`Deleted file: ${fullPath}`);
        }
      } catch (fileErr) {
        console.warn(`Failed to delete file ${resultPath}:`, fileErr.message);
      }
    }
    
    // Delete result folders if empty
    const foldersToCheck = new Set();
    for (const resultPath of resultPaths) {
      const folderPath = path.dirname(path.join(__dirname, '..', resultPath));
      foldersToCheck.add(folderPath);
    }
    
    for (const folderPath of foldersToCheck) {
      try {
        if (fs.existsSync(folderPath)) {
          const files = fs.readdirSync(folderPath);
          if (files.length === 0) {
            fs.rmdirSync(folderPath);
            console.log(`Deleted empty folder: ${folderPath}`);
          }
        }
      } catch (folderErr) {
        console.warn(`Failed to delete folder ${folderPath}:`, folderErr.message);
      }
    }
    
    // Delete child analyses first (due to foreign key constraint)
    if (childrenResult.rows.length > 0) {
      await db.query(
        'DELETE FROM analyses WHERE parent_analysis_id = $1 AND user_id = $2',
        [analysisId, userId]
      );
    }
    
    // Delete the parent analysis
    await db.query(
      'DELETE FROM analyses WHERE id = $1 AND user_id = $2',
      [analysisId, userId]
    );
    
    return res.json({ 
      success: true,
      deletedCount: allAnalyses.length
    });
  } catch (err) {
    console.error('Error deleting analysis:', err);
    return res.status(500).json({ success: false, message: 'Failed to delete analysis' });
  }
});

module.exports = router;
