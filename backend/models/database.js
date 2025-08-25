const { Pool } = require('pg');

// Database connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

// Test connection
pool.on('connect', () => {
  console.log('✅ Connesso al database PostgreSQL');
});

pool.on('error', (err) => {
  console.error('❌ Errore connessione database:', err);
  process.exit(-1);
});

// Initialize database tables
const initDatabase = async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS tickets (
        id SERIAL PRIMARY KEY,
        user_id VARCHAR(255),
        user_email VARCHAR(255),
        user_phone VARCHAR(20),
        question TEXT NOT NULL,
        response TEXT,
        status VARCHAR(20) DEFAULT 'open',
        priority VARCHAR(10) DEFAULT 'medium',
        category VARCHAR(50) DEFAULT 'general',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        responded_at TIMESTAMP,
        metadata JSONB DEFAULT '{}'
      );
    `);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_tickets_status ON tickets(status);
    `);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_tickets_created_at ON tickets(created_at);
    `);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_tickets_user_id ON tickets(user_id);
    `);

    console.log('✅ Tabelle database inizializzate');
  } catch (err) {
    console.error('❌ Errore inizializzazione database:', err);
    throw err;
  }
};

module.exports = {
  pool,
  initDatabase
};