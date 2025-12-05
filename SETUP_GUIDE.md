# BioMark PostgreSQL Setup Guide

## Overview
This application has been migrated from SQLite to PostgreSQL for better scalability and multi-user support.

## Understanding .env Files

### `.env.example`
- **Purpose**: Template file showing what environment variables are needed
- **Usage**: Should be committed to git as a reference
- **Contains**: Placeholder values (like `your_password_here`)
- **For**: New developers to know what configuration is needed

### `.env`
- **Purpose**: Your actual configuration with real credentials
- **Usage**: Should **NEVER** be committed to git (already in `.gitignore`)
- **Contains**: Real database passwords, API keys, secrets
- **For**: Running the application on your local machine

## For Your Friend: Setting Up PostgreSQL

### Step 1: Install PostgreSQL
```bash
# macOS
brew install postgresql@15
brew services start postgresql@15

# Linux (Ubuntu/Debian)
sudo apt update
sudo apt install postgresql postgresql-contrib
sudo systemctl start postgresql

# Windows
# Download installer from: https://www.postgresql.org/download/windows/
```

### Step 2: Add PostgreSQL to PATH (macOS only)
```bash
echo 'export PATH="/opt/homebrew/opt/postgresql@15/bin:$PATH"' >> ~/.zshrc
source ~/.zshrc
```

### Step 3: Create Database
```bash
# Create database
createdb biomark_db

# Or using psql:
psql postgres
CREATE DATABASE biomark_db;
\q
```

### Step 4: Configure Environment
```bash
cd BioMark_Code_Files/server

# Copy the example file
cp .env.example .env

# Edit .env with your credentials
nano .env
```

Edit `.env` to match your system:
```env
DB_HOST=localhost
DB_PORT=5432
DB_NAME=biomark_db
DB_USER=your_username  # On Mac: your system username, Linux: postgres, Windows: postgres
DB_PASSWORD=           # Leave empty if no password, or set your postgres password
JWT_SECRET=your-secret-key-here-change-in-production
PUBLIC_BASE_URL=http://localhost:3000
```

### Step 5: Install Node Dependencies
```bash
cd BioMark_Code_Files/server
npm install
```

### Step 6: Start Server
The database schema will be created automatically on first run!

```bash
# Activate Python environment first
source env/bin/activate

# Start server
node server.js
```

The server will automatically:
- Connect to PostgreSQL
- Create all tables (users, accounts, uploads, analyses, etc.)
- Set up proper indexes
- Be ready to use!

## Database Management

### View Your Database Tables
```bash
# Connect to PostgreSQL
psql biomark_db

# List all tables
\dt

# View table structure
\d users
\d accounts
\d uploads
\d analyses

# Query data
SELECT * FROM users;
SELECT * FROM analyses LIMIT 10;

# Exit
\q
```

### Common PostgreSQL Commands
```sql
-- See all analyses
SELECT id, status, created_at FROM analyses ORDER BY created_at DESC;

-- Count records
SELECT COUNT(*) FROM users;
SELECT COUNT(*) FROM analyses;

-- View recent analyses with details
SELECT a.id, a.status, a.created_at, u.original_name 
FROM analyses a 
LEFT JOIN uploads u ON a.upload_id = u.id 
ORDER BY a.created_at DESC 
LIMIT 5;
```

### Delete Old SQLite Database
```bash
cd BioMark_Code_Files/server/db
rm app.sqlite   # Safe to delete, we're using PostgreSQL now
```

## Key Differences from SQLite

### Session IDs
- **Old (SQLite)**: UUID strings like `"550e8400-e29b-41d4-a716-446655440000"` (36 characters)
- **New (PostgreSQL)**: Auto-increment integers like `1, 2, 3, ...` (4 bytes)
- **Benefit**: ~90% space savings, simpler guest tokens

### Date/Time Format
- PostgreSQL uses `TIMESTAMP` type
- Returns dates like: `2025-12-02T10:30:45.123Z`
- The 'Z' suffix indicates UTC timezone

### Connection Pooling
- PostgreSQL uses connection pooling (max 20 connections)
- Better for multiple simultaneous users
- More scalable than SQLite

### Async Operations
- All database queries are now asynchronous with `await`
- Better performance for concurrent requests

## Troubleshooting

### "Connection refused" error
```bash
# Check if PostgreSQL is running
brew services list  # macOS
sudo systemctl status postgresql  # Linux
```

### "Database does not exist"
```bash
createdb biomark_db
```

### "Role does not exist"
```bash
# Create PostgreSQL user (if needed)
createuser -s your_username
```

### "Permission denied"
Check your `.env` file has the correct `DB_USER` and `DB_PASSWORD`

### Port already in use
```bash
# Check what's using port 3001
lsof -i :3001

# Kill the process if needed
kill -9 <PID>
```

## Migration Notes

### What Changed?
1. **Database**: SQLite → PostgreSQL
2. **Session IDs**: UUID strings → Auto-increment integers
3. **All queries**: Synchronous → Asynchronous (async/await)
4. **Connection**: Single file → Connection pool
5. **Schema**: Automatic initialization on startup

### What Stayed the Same?
- All API endpoints work identically
- Client code unchanged (except date formatting)
- Analysis workflow unchanged
- File upload process unchanged
- Python analysis scripts unchanged

## Future Management

### When Adding New Features
1. Update schema in `server/db/database.js` → `initializeDatabase()`
2. Add indexes for foreign keys
3. Use parameterized queries: `db.query('SELECT * FROM table WHERE id = $1', [id])`
4. Always use async/await for database operations

### For Production Deployment
1. Change `JWT_SECRET` to a strong random value
2. Set proper `DB_PASSWORD`
3. Consider connection pool limits based on server resources
4. Set up PostgreSQL backups
5. Never commit `.env` file to git

### Environment Variables Priority
When your friend gets the code:
1. They copy `.env.example` → `.env`
2. They edit `.env` with their local settings
3. `.env` is in `.gitignore` so their credentials stay private
4. When they push code, only `.env.example` goes to git
5. You pull their code, your `.env` stays unchanged with your settings

This way everyone has their own local configuration!
