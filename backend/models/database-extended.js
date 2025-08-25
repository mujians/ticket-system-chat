const { pool } = require('./database');

// Extended database initialization for chat system
const initChatDatabase = async () => {
  try {
    // Operators table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS operators (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        email VARCHAR(255) UNIQUE NOT NULL,
        phone VARCHAR(20),
        role VARCHAR(50) DEFAULT 'operator',
        permissions JSONB DEFAULT '{}',
        status VARCHAR(20) DEFAULT 'offline',
        is_online BOOLEAN DEFAULT false,
        socket_id VARCHAR(255),
        current_session_id INTEGER,
        last_activity TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        online_since TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Chat sessions table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS chat_sessions (
        id SERIAL PRIMARY KEY,
        user_id VARCHAR(255),
        user_email VARCHAR(255),
        user_phone VARCHAR(20),
        initial_question TEXT NOT NULL,
        operator_id INTEGER REFERENCES operators(id),
        status VARCHAR(20) DEFAULT 'queue_waiting',
        priority VARCHAR(10) DEFAULT 'medium',
        queue_position INTEGER,
        timeout_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        assigned_at TIMESTAMP,
        started_at TIMESTAMP,
        ended_at TIMESTAMP,
        escalation_reason VARCHAR(50),
        ticket_id INTEGER,
        metadata JSONB DEFAULT '{}'
      );
    `);

    // Chat messages table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS chat_messages (
        id SERIAL PRIMARY KEY,
        session_id INTEGER NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
        sender_type VARCHAR(10) NOT NULL, -- 'user', 'operator', 'system'
        sender_id VARCHAR(255) NOT NULL,
        message TEXT NOT NULL,
        message_type VARCHAR(20) DEFAULT 'text', -- 'text', 'image', 'file', 'system'
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        edited_at TIMESTAMP,
        metadata JSONB DEFAULT '{}'
      );
    `);

    // Indexes for better performance
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_chat_sessions_status ON chat_sessions(status);
    `);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_chat_sessions_operator ON chat_sessions(operator_id);
    `);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_chat_sessions_created ON chat_sessions(created_at);
    `);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_chat_messages_session ON chat_messages(session_id);
    `);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_chat_messages_created ON chat_messages(created_at);
    `);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_operators_status ON operators(status, is_online);
    `);

    // Update triggers
    await pool.query(`
      CREATE OR REPLACE FUNCTION update_updated_at_column()
      RETURNS TRIGGER AS $$
      BEGIN
        NEW.updated_at = CURRENT_TIMESTAMP;
        RETURN NEW;
      END;
      $$ language 'plpgsql';
    `);

    await pool.query(`
      DROP TRIGGER IF EXISTS update_operators_updated_at ON operators;
      CREATE TRIGGER update_operators_updated_at 
        BEFORE UPDATE ON operators 
        FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
    `);

    await pool.query(`
      DROP TRIGGER IF EXISTS update_tickets_updated_at ON tickets;
      CREATE TRIGGER update_tickets_updated_at 
        BEFORE UPDATE ON tickets 
        FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
    `);

    console.log('✅ Tabelle chat system inizializzate');

    // Create default admin operator if not exists
    const adminExists = await pool.query(
      'SELECT id FROM operators WHERE email = $1',
      ['admin@example.com']
    );

    if (adminExists.rows.length === 0) {
      await pool.query(`
        INSERT INTO operators (name, email, phone, role, permissions)
        VALUES ($1, $2, $3, $4, $5)
      `, [
        'Admin',
        'admin@example.com',
        '+393331234567',
        'admin',
        JSON.stringify({
          can_manage_operators: true,
          can_view_all_chats: true,
          can_escalate_tickets: true,
          can_access_admin_panel: true
        })
      ]);

      console.log('✅ Operatore admin creato (admin@example.com)');
    }

  } catch (err) {
    console.error('❌ Errore inizializzazione database chat:', err);
    throw err;
  }
};

// Queue management functions
const updateQueuePositions = async () => {
  try {
    await pool.query(`
      WITH ranked_sessions AS (
        SELECT id, 
               ROW_NUMBER() OVER (ORDER BY priority DESC, created_at ASC) as new_position
        FROM chat_sessions 
        WHERE status = 'queue_waiting'
      )
      UPDATE chat_sessions 
      SET queue_position = rs.new_position
      FROM ranked_sessions rs
      WHERE chat_sessions.id = rs.id
    `);
  } catch (err) {
    console.error('Errore aggiornamento posizioni coda:', err);
  }
};

// Clean up old sessions
const cleanupSessions = async (daysOld = 30) => {
  try {
    const result = await pool.query(`
      DELETE FROM chat_sessions 
      WHERE status IN ('resolved', 'escalated_ticket') 
      AND ended_at < CURRENT_TIMESTAMP - INTERVAL '${daysOld} days'
    `);

    console.log(`🧹 Pulite ${result.rowCount} sessioni vecchie`);
    return result.rowCount;
  } catch (err) {
    console.error('Errore pulizia sessioni:', err);
    return 0;
  }
};

// Get comprehensive system stats
const getSystemStats = async () => {
  try {
    const result = await pool.query(`
      SELECT 
        -- Chat sessions stats
        COUNT(*) FILTER (WHERE cs.status = 'queue_waiting') as sessions_in_queue,
        COUNT(*) FILTER (WHERE cs.status = 'operator_chat') as active_chats,
        COUNT(*) FILTER (WHERE cs.status = 'resolved' AND DATE(cs.ended_at) = CURRENT_DATE) as today_resolved,
        COUNT(*) FILTER (WHERE cs.status = 'escalated_ticket' AND DATE(cs.created_at) = CURRENT_DATE) as today_escalated,
        AVG(EXTRACT(EPOCH FROM (cs.assigned_at - cs.created_at))/60) FILTER (WHERE cs.assigned_at IS NOT NULL AND DATE(cs.created_at) = CURRENT_DATE) as avg_queue_wait_minutes,
        AVG(EXTRACT(EPOCH FROM (cs.ended_at - cs.started_at))/60) FILTER (WHERE cs.ended_at IS NOT NULL AND DATE(cs.ended_at) = CURRENT_DATE) as avg_chat_duration_minutes,
        
        -- Operators stats
        (SELECT COUNT(*) FROM operators WHERE is_online = true) as operators_online,
        (SELECT COUNT(*) FROM operators WHERE is_online = true AND status = 'available') as operators_available,
        (SELECT COUNT(*) FROM operators WHERE is_online = true AND status = 'busy') as operators_busy,
        
        -- Tickets stats
        (SELECT COUNT(*) FROM tickets WHERE status = 'open') as open_tickets,
        (SELECT COUNT(*) FROM tickets WHERE DATE(created_at) = CURRENT_DATE) as today_tickets
        
      FROM chat_sessions cs
      WHERE DATE(cs.created_at) >= CURRENT_DATE - INTERVAL '7 days'
    `);

    return result.rows[0];
  } catch (err) {
    console.error('Errore statistiche sistema:', err);
    return {};
  }
};

module.exports = {
  initChatDatabase,
  updateQueuePositions,
  cleanupSessions,
  getSystemStats
};