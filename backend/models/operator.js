const { pool } = require('./database');

class Operator {
  static async create({ name, email, phone, role = 'operator', permissions = {} }) {
    try {
      const result = await pool.query(
        `INSERT INTO operators (name, email, phone, role, permissions, status, is_online, created_at) 
         VALUES ($1, $2, $3, $4, $5, 'offline', false, CURRENT_TIMESTAMP) 
         RETURNING *`,
        [name, email, phone, role, JSON.stringify(permissions)]
      );
      return result.rows[0];
    } catch (err) {
      console.error('Errore creazione operatore:', err);
      throw err;
    }
  }

  static async setOnline(operatorId, socketId = null) {
    try {
      const result = await pool.query(`
        UPDATE operators 
        SET is_online = true, 
            status = 'available', 
            socket_id = $2,
            last_activity = CURRENT_TIMESTAMP,
            online_since = CURRENT_TIMESTAMP
        WHERE id = $1 
        RETURNING *
      `, [operatorId, socketId]);

      if (result.rows.length > 0) {
        console.log(`✅ Operatore ${operatorId} è online`);
        
        // Check if there are sessions waiting in queue
        await this.assignWaitingChats(operatorId);
      }
      
      return result.rows[0];
    } catch (err) {
      console.error('Errore set online operatore:', err);
      throw err;
    }
  }

  static async setOffline(operatorId) {
    try {
      // First, escalate any active chats to tickets
      const activeSessions = await pool.query(`
        SELECT id FROM chat_sessions 
        WHERE operator_id = $1 AND status IN ('operator_assigned', 'operator_chat')
      `, [operatorId]);

      const QueueManager = require('./queue');
      for (const session of activeSessions.rows) {
        await QueueManager.escalateToTicket(session.id, 'operator_offline');
      }

      // Set operator offline
      const result = await pool.query(`
        UPDATE operators 
        SET is_online = false, 
            status = 'offline', 
            socket_id = NULL,
            current_session_id = NULL,
            last_activity = CURRENT_TIMESTAMP
        WHERE id = $1 
        RETURNING *
      `, [operatorId]);

      console.log(`❌ Operatore ${operatorId} è offline`);
      return result.rows[0];
    } catch (err) {
      console.error('Errore set offline operatore:', err);
      throw err;
    }
  }

  static async updateActivity(operatorId) {
    try {
      await pool.query(`
        UPDATE operators 
        SET last_activity = CURRENT_TIMESTAMP 
        WHERE id = $1
      `, [operatorId]);
    } catch (err) {
      console.error('Errore aggiornamento attività:', err);
    }
  }

  static async setBusy(operatorId, sessionId) {
    try {
      const result = await pool.query(`
        UPDATE operators 
        SET status = 'busy', 
            current_session_id = $2,
            last_activity = CURRENT_TIMESTAMP 
        WHERE id = $1 
        RETURNING *
      `, [operatorId, sessionId]);

      return result.rows[0];
    } catch (err) {
      console.error('Errore set busy operatore:', err);
      throw err;
    }
  }

  static async setAvailable(operatorId) {
    try {
      const result = await pool.query(`
        UPDATE operators 
        SET status = 'available', 
            current_session_id = NULL,
            last_activity = CURRENT_TIMESTAMP 
        WHERE id = $1 AND is_online = true
        RETURNING *
      `, [operatorId]);

      if (result.rows.length > 0) {
        // Check for waiting chats
        await this.assignWaitingChats(operatorId);
      }

      return result.rows[0];
    } catch (err) {
      console.error('Errore set available operatore:', err);
      throw err;
    }
  }

  static async assignWaitingChats(operatorId) {
    try {
      const QueueManager = require('./queue');
      
      // Get next session in queue
      const nextSession = await pool.query(`
        SELECT id FROM chat_sessions 
        WHERE status = 'queue_waiting' 
        ORDER BY priority DESC, queue_position ASC 
        LIMIT 1
      `);

      if (nextSession.rows.length > 0) {
        await QueueManager.checkAndAssignOperator(nextSession.rows[0].id);
      }
    } catch (err) {
      console.error('Errore assegnazione chat in attesa:', err);
    }
  }

  static async findById(id) {
    try {
      const result = await pool.query('SELECT * FROM operators WHERE id = $1', [id]);
      return result.rows[0];
    } catch (err) {
      console.error('Errore ricerca operatore:', err);
      throw err;
    }
  }

  static async findByEmail(email) {
    try {
      const result = await pool.query('SELECT * FROM operators WHERE email = $1', [email]);
      return result.rows[0];
    } catch (err) {
      console.error('Errore ricerca operatore per email:', err);
      throw err;
    }
  }

  static async getAll({ includeOffline = true } = {}) {
    try {
      let query = `
        SELECT 
          o.*,
          cs.id as current_session_id,
          cs.user_id as current_user_id,
          EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - o.last_activity))/60 as minutes_inactive
        FROM operators o
        LEFT JOIN chat_sessions cs ON o.current_session_id = cs.id
      `;
      
      if (!includeOffline) {
        query += ' WHERE o.is_online = true';
      }
      
      query += ' ORDER BY o.is_online DESC, o.last_activity DESC';
      
      const result = await pool.query(query);
      return result.rows;
    } catch (err) {
      console.error('Errore lista operatori:', err);
      throw err;
    }
  }

  static async getAvailable() {
    try {
      const result = await pool.query(`
        SELECT * FROM operators 
        WHERE is_online = true AND status = 'available' 
        ORDER BY last_activity DESC
      `);
      return result.rows;
    } catch (err) {
      console.error('Errore operatori disponibili:', err);
      throw err;
    }
  }

  static async getWorkload() {
    try {
      const result = await pool.query(`
        SELECT 
          o.id,
          o.name,
          o.status,
          o.is_online,
          COUNT(cs.id) FILTER (WHERE cs.status IN ('operator_assigned', 'operator_chat')) as active_chats,
          COUNT(cs.id) FILTER (WHERE cs.status = 'resolved' AND DATE(cs.ended_at) = CURRENT_DATE) as today_resolved,
          AVG(EXTRACT(EPOCH FROM (cs.ended_at - cs.started_at))/60) FILTER (WHERE cs.ended_at IS NOT NULL AND DATE(cs.ended_at) = CURRENT_DATE) as avg_duration_today
        FROM operators o
        LEFT JOIN chat_sessions cs ON o.id = cs.operator_id
        WHERE o.is_online = true
        GROUP BY o.id, o.name, o.status, o.is_online
        ORDER BY active_chats ASC, today_resolved DESC
      `);
      return result.rows;
    } catch (err) {
      console.error('Errore carico di lavoro:', err);
      throw err;
    }
  }

  static async checkInactivity(maxInactiveMinutes = 30) {
    try {
      // Find operators that have been inactive for too long
      const inactiveOperators = await pool.query(`
        SELECT id, name FROM operators 
        WHERE is_online = true 
        AND last_activity < CURRENT_TIMESTAMP - INTERVAL '${maxInactiveMinutes} minutes'
      `);

      for (const operator of inactiveOperators.rows) {
        console.log(`⚠️ Operatore ${operator.name} (${operator.id}) inattivo da più di ${maxInactiveMinutes} minuti`);
        await this.setOffline(operator.id);
      }

      return inactiveOperators.rows.length;
    } catch (err) {
      console.error('Errore controllo inattività:', err);
      return 0;
    }
  }

  static async getDailyStats(operatorId, date = null) {
    try {
      const targetDate = date || new Date().toISOString().split('T')[0];
      
      const result = await pool.query(`
        SELECT 
          DATE($2) as date,
          COUNT(*) FILTER (WHERE status = 'resolved') as chats_resolved,
          COUNT(*) FILTER (WHERE status = 'escalated_ticket') as chats_escalated,
          AVG(EXTRACT(EPOCH FROM (ended_at - started_at))/60) FILTER (WHERE ended_at IS NOT NULL) as avg_duration_minutes,
          AVG(EXTRACT(EPOCH FROM (assigned_at - created_at))/60) FILTER (WHERE assigned_at IS NOT NULL) as avg_response_minutes,
          SUM(EXTRACT(EPOCH FROM (ended_at - started_at))/60) FILTER (WHERE ended_at IS NOT NULL) as total_chat_minutes
        FROM chat_sessions 
        WHERE operator_id = $1 
        AND DATE(created_at) = $2
      `, [operatorId, targetDate]);

      return result.rows[0];
    } catch (err) {
      console.error('Errore statistiche giornaliere operatore:', err);
      throw err;
    }
  }

  static async updatePermissions(operatorId, permissions) {
    try {
      const result = await pool.query(`
        UPDATE operators 
        SET permissions = $2, updated_at = CURRENT_TIMESTAMP 
        WHERE id = $1 
        RETURNING *
      `, [operatorId, JSON.stringify(permissions)]);
      
      return result.rows[0];
    } catch (err) {
      console.error('Errore aggiornamento permessi:', err);
      throw err;
    }
  }

  static async delete(operatorId) {
    try {
      // First set offline and escalate any active chats
      await this.setOffline(operatorId);
      
      // Then delete the operator
      const result = await pool.query('DELETE FROM operators WHERE id = $1 RETURNING *', [operatorId]);
      return result.rows[0];
    } catch (err) {
      console.error('Errore eliminazione operatore:', err);
      throw err;
    }
  }
}

module.exports = Operator;