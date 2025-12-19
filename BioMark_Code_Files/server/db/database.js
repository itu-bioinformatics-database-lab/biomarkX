const { Pool } = require('pg');

// PostgreSQL connection pool
const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'biomark_db',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
  max: 20, // Maximum number of connections in the pool
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

// Initialize database schema
const initializeDatabase = async () => {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        session_id SERIAL PRIMARY KEY,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_users_session_id ON users(session_id);

      CREATE TABLE IF NOT EXISTS accounts (
        id TEXT PRIMARY KEY,
        email TEXT UNIQUE,
        password_hash TEXT,
        username TEXT UNIQUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS uploads (
        id TEXT PRIMARY KEY,
        session_id INTEGER REFERENCES users(session_id) ON DELETE CASCADE,
        user_id TEXT REFERENCES accounts(id) ON DELETE SET NULL,
        original_name TEXT NOT NULL,
        server_path TEXT NOT NULL,
        uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_uploads_session_id ON uploads(session_id);
      CREATE INDEX IF NOT EXISTS idx_uploads_user_id ON uploads(user_id);

      CREATE TABLE IF NOT EXISTS analyses (
        id TEXT PRIMARY KEY,
        upload_id TEXT REFERENCES uploads(id) ON DELETE CASCADE,
        merged_file_id TEXT,
        session_id INTEGER REFERENCES users(session_id) ON DELETE CASCADE,
        user_id TEXT REFERENCES accounts(id) ON DELETE SET NULL,
        result_path TEXT,
        status TEXT DEFAULT 'pending',
        analysis_metadata TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      -- Add parent_analysis_id column if it doesn't exist
      DO $$ 
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name = 'analyses' AND column_name = 'parent_analysis_id'
        ) THEN
          ALTER TABLE analyses ADD COLUMN parent_analysis_id TEXT REFERENCES analyses(id) ON DELETE SET NULL;
        END IF;
      END $$;

      -- Add source_upload_ids column to track original files in merged datasets
      DO $$ 
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name = 'analyses' AND column_name = 'source_upload_ids'
        ) THEN
          ALTER TABLE analyses ADD COLUMN source_upload_ids TEXT[];
        END IF;
      END $$;

      CREATE INDEX IF NOT EXISTS idx_analyses_session_id ON analyses(session_id);
      CREATE INDEX IF NOT EXISTS idx_analyses_user_id ON analyses(user_id);
      CREATE INDEX IF NOT EXISTS idx_analyses_upload_id ON analyses(upload_id);
      CREATE INDEX IF NOT EXISTS idx_analyses_parent_analysis_id ON analyses(parent_analysis_id);

      CREATE TABLE IF NOT EXISTS notification_subscriptions (
        id TEXT PRIMARY KEY,
        job_id TEXT NOT NULL,
        email TEXT NOT NULL,
        status TEXT DEFAULT 'pending',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        sent_at TIMESTAMP,
        error_message TEXT
      );
    `);
    console.log('Database schema initialized successfully');
  } catch (err) {
    console.error('Error initializing database schema:', err);
    throw err;
  } finally {
    client.release();
  }
};

// Initialize on module load
initializeDatabase().catch(err => {
  console.error('Failed to initialize database:', err);
  process.exit(1);
});

module.exports = pool; 