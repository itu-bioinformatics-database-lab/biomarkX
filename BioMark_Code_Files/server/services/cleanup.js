const fs = require('fs');
const path = require('path');
const db = require('../db/database');

/**
 * Cleanup Service - Deletes old uploads and their associated analysis results
 * Runs based on upload age (uploaded_at timestamp)
 * Default: deletes uploads older than 180 days (6 months)
 */

const CLEANUP_AGE_DAYS = process.env.CLEANUP_AGE_DAYS || 180;

/**
 * Get the age of an upload in days
 */
function getUploadAgeDays(uploadedAtTimestamp) {
  const uploadDate = new Date(uploadedAtTimestamp);
  const now = new Date();
  const ageMs = now - uploadDate;
  const ageDays = Math.floor(ageMs / (1000 * 60 * 60 * 24));
  return ageDays;
}

/**
 * Delete a directory recursively
 */
function deleteDirectoryRecursive(dirPath) {
  try {
    if (fs.existsSync(dirPath)) {
      fs.readdirSync(dirPath).forEach(file => {
        const curPath = path.join(dirPath, file);
        if (fs.lstatSync(curPath).isDirectory()) {
          deleteDirectoryRecursive(curPath);
        } else {
          fs.unlinkSync(curPath);
        }
      });
      fs.rmdirSync(dirPath);
      return true;
    }
    return false;
  } catch (err) {
    console.error(`Error deleting directory ${dirPath}:`, err);
    return false;
  }
}

/**
 * Main cleanup function
 */
async function runCleanup() {
  console.log(`[Cleanup] Starting cleanup of uploads older than ${CLEANUP_AGE_DAYS} days...`);
  
  try {
    // Get all uploads older than CLEANUP_AGE_DAYS
    const result = await db.query(
      `SELECT id, original_name, server_path, uploaded_at 
       FROM uploads 
       WHERE uploaded_at < NOW() - INTERVAL '${CLEANUP_AGE_DAYS} days'
       ORDER BY uploaded_at ASC`
    );

    const oldUploads = result.rows;
    console.log(`[Cleanup] Found ${oldUploads.length} uploads older than ${CLEANUP_AGE_DAYS} days`);

    if (oldUploads.length === 0) {
      console.log('[Cleanup] No old uploads to clean up');
      return { success: true, deletedCount: 0, message: 'No uploads to clean' };
    }

    let deletedCount = 0;
    let errorCount = 0;

    for (const upload of oldUploads) {
      try {
        console.log(`[Cleanup] Processing upload: ${upload.id} (${upload.original_name}, uploaded: ${upload.uploaded_at})`);

        // Find all analyses that use this upload
        const analysesResult = await db.query(
          `SELECT id, result_path FROM analyses 
           WHERE upload_id = $1 OR merged_file_id = $1`,
          [upload.id]
        );

        const analyses = analysesResult.rows;
        console.log(`[Cleanup] Found ${analyses.length} analyses using upload ${upload.id}`);

        // Delete physical result directories
        for (const analysis of analyses) {
          if (analysis.result_path) {
            try {
              const resultPath = path.join(__dirname, '..', analysis.result_path);
              if (fs.existsSync(resultPath)) {
                deleteDirectoryRecursive(resultPath);
                console.log(`[Cleanup] Deleted results directory: ${analysis.result_path}`);
              }
            } catch (err) {
              console.error(`[Cleanup] Error deleting results for analysis ${analysis.id}:`, err);
              errorCount++;
            }
          }
        }

        // Delete physical uploaded file
        try {
          if (fs.existsSync(upload.server_path)) {
            fs.unlinkSync(upload.server_path);
            console.log(`[Cleanup] Deleted upload file: ${upload.server_path}`);
          }
        } catch (err) {
          console.error(`[Cleanup] Error deleting upload file ${upload.server_path}:`, err);
          errorCount++;
        }

        // Delete database records (cascading will handle analyses -> analyses relationship)
        try {
          await db.query('DELETE FROM uploads WHERE id = $1', [upload.id]);
          console.log(`[Cleanup] Deleted upload record from database: ${upload.id}`);
          deletedCount++;
        } catch (err) {
          console.error(`[Cleanup] Error deleting upload record ${upload.id}:`, err);
          errorCount++;
        }

      } catch (err) {
        console.error(`[Cleanup] Error processing upload ${upload.id}:`, err);
        errorCount++;
      }
    }

    console.log(`[Cleanup] Cleanup complete. Deleted: ${deletedCount}, Errors: ${errorCount}`);
    
    return {
      success: true,
      deletedCount,
      errorCount,
      message: `Cleaned up ${deletedCount} old uploads (${CLEANUP_AGE_DAYS}+ days old)`
    };

  } catch (err) {
    console.error('[Cleanup] Fatal error during cleanup:', err);
    return {
      success: false,
      error: err.message,
      message: 'Cleanup failed'
    };
  }
}

module.exports = {
  runCleanup,
  CLEANUP_AGE_DAYS
};
