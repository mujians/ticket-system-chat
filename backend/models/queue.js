const { pool } = require('./database');

class QueueManager {
  static async createChatSession({ user_id, user_email, user_phone, initial_question, priority = 'medium', metadata = {} }) {
    try {
      const result = await pool.query(
        `INSERT INTO chat_sessions (user_id, user_email, user_phone, initial_question, status, priority, metadata, queue_position, created_at) 
         VALUES ($1, $2, $3, $4, 'queue_waiting', $5, $6, (SELECT COALESCE(MAX(queue_position), 0) + 1 FROM chat_sessions WHERE status = 'queue_waiting'), CURRENT_TIMESTAMP) 
         RETURNING *`,
        [user_id, user_email, user_phone, initial_question, priority, JSON.stringify(metadata)]
      );
      
      const session = result.rows[0];
      
      // Check for available operators
      await this.checkAndAssignOperator(session.id);
      
      return session;
    } catch (err) {
      console.error('Errore creazione sessione chat:', err);
      throw err;
    }
  }

  static async checkAndAssignOperator(sessionId) {
    try {
      // Find available operator
      const operatorResult = await pool.query(`
        SELECT id FROM operators 
        WHERE status = 'available' AND is_online = true 
        ORDER BY last_activity DESC 
        LIMIT 1
      `);

      if (operatorResult.rows.length > 0) {
        const operatorId = operatorResult.rows[0].id;
        
        // Assign operator to session
        await pool.query(`
          UPDATE chat_sessions 
          SET status = 'operator_assigned', 
              operator_id = $1, 
              assigned_at = CURRENT_TIMESTAMP,
              timeout_at = CURRENT_TIMESTAMP + INTERVAL '5 minutes'
          WHERE id = $2
        `, [operatorId, sessionId]);

        // Update operator status
        await pool.query(`
          UPDATE operators 
          SET status = 'busy', 
              current_session_id = $1,
              last_activity = CURRENT_TIMESTAMP 
          WHERE id = $2
        `, [sessionId, operatorId]);

        console.log(`✅ Operatore ${operatorId} assegnato alla sessione ${sessionId}`);
        return true;
      }
      
      return false;
    } catch (err) {
      console.error('Errore assegnazione operatore:', err);
      throw err;
    }
  }

  static async getQueuePosition(sessionId) {
    try {
      const result = await pool.query(`
        SELECT 
          queue_position,
          (SELECT COUNT(*) FROM chat_sessions WHERE status = 'queue_waiting' AND queue_position < $1) as ahead_count,
          (SELECT AVG(EXTRACT(EPOCH FROM (assigned_at - created_at))/60) FROM chat_sessions WHERE status != 'queue_waiting' AND assigned_at IS NOT NULL) as avg_wait_minutes
        FROM chat_sessions 
        WHERE id = $1
      `, [sessionId]);
      
      return result.rows[0];
    } catch (err) {
      console.error('Errore posizione coda:', err);
      throw err;
    }
  }

  static async acceptChat(operatorId, sessionId) {
    try {
      // Start the chat
      await pool.query(`
        UPDATE chat_sessions 
        SET status = 'operator_chat', 
            started_at = CURRENT_TIMESTAMP,
            timeout_at = NULL
        WHERE id = $1 AND operator_id = $2
      `, [sessionId, operatorId]);

      // Add system message
      await pool.query(`
        INSERT INTO chat_messages (session_id, sender_type, sender_id, message, message_type)
        VALUES ($1, 'system', 'system', 'Operatore connesso alla chat', 'system')
      `, [sessionId]);

      console.log(`✅ Chat ${sessionId} iniziata con operatore ${operatorId}`);
      return true;
    } catch (err) {
      console.error('Errore accettazione chat:', err);
      throw err;
    }
  }

  static async escalateToTicket(sessionId, reason = 'timeout') {
    try {
      const sessionResult = await pool.query(`
        SELECT * FROM chat_sessions WHERE id = $1
      `, [sessionId]);
      
      if (sessionResult.rows.length === 0) {
        throw new Error('Sessione non trovata');
      }

      const session = sessionResult.rows[0];
      
      // Get all messages from the chat
      const messagesResult = await pool.query(`
        SELECT * FROM chat_messages 
        WHERE session_id = $1 
        ORDER BY created_at ASC
      `, [sessionId]);

      // Create comprehensive question including chat history
      let fullQuestion = session.initial_question;
      if (messagesResult.rows.length > 1) {
        const chatHistory = messagesResult.rows
          .filter(msg => msg.sender_type !== 'system')
          .map(msg => `${msg.sender_type === 'user' ? 'Cliente' : 'Operatore'}: ${msg.message}`)
          .join('\n');
        
        fullQuestion = `${session.initial_question}\n\n--- Cronologia Chat ---\n${chatHistory}`;
      }

      // Create ticket
      const ticketResult = await pool.query(`
        INSERT INTO tickets (
          user_id, user_email, user_phone, question, priority, category, 
          metadata, status, created_at
        ) VALUES ($1, $2, $3, $4, $5, 'escalated', $6, 'open', CURRENT_TIMESTAMP)
        RETURNING *
      `, [
        session.user_id,
        session.user_email,
        session.user_phone,
        fullQuestion,
        session.priority,
        JSON.stringify({
          ...session.metadata,
          escalation_reason: reason,
          original_session_id: sessionId,
          escalated_from: 'chat'
        })
      ]);

      // Update session status
      await pool.query(`
        UPDATE chat_sessions 
        SET status = 'escalated_ticket', 
            ticket_id = $1,
            ended_at = CURRENT_TIMESTAMP,
            escalation_reason = $2
        WHERE id = $3
      `, [ticketResult.rows[0].id, reason, sessionId]);

      // Free up operator if assigned
      if (session.operator_id) {
        await pool.query(`
          UPDATE operators 
          SET status = 'available', 
              current_session_id = NULL,
              last_activity = CURRENT_TIMESTAMP 
          WHERE id = $1
        `, [session.operator_id]);
      }

      console.log(`✅ Sessione ${sessionId} escalata a ticket #${ticketResult.rows[0].id} (${reason})`);
      return ticketResult.rows[0];
    } catch (err) {
      console.error('Errore escalation:', err);
      throw err;
    }
  }

  static async checkTimeouts() {
    try {
      // Find expired sessions
      const expiredSessions = await pool.query(`
        SELECT id, operator_id FROM chat_sessions 
        WHERE status IN ('operator_assigned', 'operator_chat') 
        AND timeout_at < CURRENT_TIMESTAMP
      `);

      for (const session of expiredSessions.rows) {
        console.log(`⏰ Timeout sessione ${session.id}`);
        await this.escalateToTicket(session.id, 'operator_timeout');
      }

      // Also check for sessions waiting too long in queue
      const longWaitingSessions = await pool.query(`
        SELECT id FROM chat_sessions 
        WHERE status = 'queue_waiting' 
        AND created_at < CURRENT_TIMESTAMP - INTERVAL '15 minutes'
      `);

      for (const session of longWaitingSessions.rows) {
        console.log(`⏰ Timeout coda sessione ${session.id}`);
        await this.escalateToTicket(session.id, 'queue_timeout');
      }

    } catch (err) {
      console.error('Errore controllo timeout:', err);
    }
  }

  static async getOperatorStats(operatorId) {
    try {
      const result = await pool.query(`
        SELECT 
          COUNT(*) FILTER (WHERE status = 'operator_chat') as active_chats,
          COUNT(*) FILTER (WHERE status = 'resolved' AND DATE(ended_at) = CURRENT_DATE) as today_resolved,
          AVG(EXTRACT(EPOCH FROM (ended_at - started_at))/60) FILTER (WHERE ended_at IS NOT NULL) as avg_chat_duration_minutes,
          COUNT(*) FILTER (WHERE status = 'escalated_ticket') as escalated_count
        FROM chat_sessions 
        WHERE operator_id = $1
      `, [operatorId]);
      
      return result.rows[0];
    } catch (err) {
      console.error('Errore statistiche operatore:', err);
      throw err;
    }
  }

  static async getSystemStats() {
    try {
      const result = await pool.query(`
        SELECT 
          COUNT(*) FILTER (WHERE status = 'queue_waiting') as in_queue,
          COUNT(*) FILTER (WHERE status = 'operator_chat') as active_chats,
          COUNT(*) FILTER (WHERE status = 'resolved' AND DATE(ended_at) = CURRENT_DATE) as today_resolved,
          COUNT(*) FILTER (WHERE status = 'escalated_ticket' AND DATE(created_at) = CURRENT_DATE) as today_escalated,
          (SELECT COUNT(*) FROM operators WHERE is_online = true AND status = 'available') as available_operators,
          AVG(EXTRACT(EPOCH FROM (assigned_at - created_at))/60) FILTER (WHERE assigned_at IS NOT NULL AND DATE(created_at) = CURRENT_DATE) as avg_wait_minutes
        FROM chat_sessions
      `);
      
      return result.rows[0];
    } catch (err) {
      console.error('Errore statistiche sistema:', err);
      throw err;
    }
  }

  static async endChat(sessionId, operatorId) {
    try {
      // Mark chat as resolved
      await pool.query(`
        UPDATE chat_sessions 
        SET status = 'resolved', 
            ended_at = CURRENT_TIMESTAMP
        WHERE id = $1 AND operator_id = $2
      `, [sessionId, operatorId]);

      // Free operator
      await pool.query(`
        UPDATE operators 
        SET status = 'available', 
            current_session_id = NULL,
            last_activity = CURRENT_TIMESTAMP 
        WHERE id = $1
      `, [operatorId]);

      // Try to assign operator to next in queue
      const nextInQueue = await pool.query(`
        SELECT id FROM chat_sessions 
        WHERE status = 'queue_waiting' 
        ORDER BY queue_position ASC 
        LIMIT 1
      `);

      if (nextInQueue.rows.length > 0) {
        await this.checkAndAssignOperator(nextInQueue.rows[0].id);
      }

      console.log(`✅ Chat ${sessionId} terminata dall'operatore ${operatorId}`);
      return true;
    } catch (err) {
      console.error('Errore chiusura chat:', err);
      throw err;
    }
  }
}

module.exports = QueueManager;