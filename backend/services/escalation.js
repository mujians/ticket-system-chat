const QueueManager = require('../models/queue');
const Operator = require('../models/operator');
const notificationService = require('./notifications');

class EscalationService {
  constructor() {
    this.timeoutIntervals = new Map();
    this.config = {
      // Tempi di timeout in minuti
      operatorResponseTimeout: 5,     // Tempo massimo per risposta operatore
      queueTimeout: 15,               // Tempo massimo in coda prima di escalation
      chatInactivityTimeout: 10,      // Inattività in chat prima di avviso
      operatorInactivityTimeout: 30,  // Inattività operatore prima di logout
      
      // Priorità e logiche
      maxConcurrentChats: 3,          // Chat massime per operatore
      priorityQueueEnabled: true,     // Abilita coda con priorità
      
      // Notifiche
      notifyOnTimeout: true,
      notifyOnEscalation: true,
      sendReminderAfter: 2            // Minuti dopo cui inviare reminder
    };
  }

  // Avvia il sistema di escalation automatica
  startEscalationSystem() {
    console.log('🚀 Sistema di escalation avviato');
    
    // Controllo timeout ogni 30 secondi
    this.timeoutInterval = setInterval(async () => {
      try {
        await this.checkAllTimeouts();
      } catch (err) {
        console.error('Errore controllo timeout:', err);
      }
    }, 30000);

    // Controllo inattività operatori ogni 5 minuti
    this.inactivityInterval = setInterval(async () => {
      try {
        await Operator.checkInactivity(this.config.operatorInactivityTimeout);
      } catch (err) {
        console.error('Errore controllo inattività operatori:', err);
      }
    }, 300000);

    // Pulizia sessioni obsolete ogni ora
    this.cleanupInterval = setInterval(async () => {
      try {
        await this.cleanupOldSessions();
      } catch (err) {
        console.error('Errore pulizia sessioni:', err);
      }
    }, 3600000);
  }

  stopEscalationSystem() {
    console.log('⏹️ Sistema di escalation fermato');
    
    if (this.timeoutInterval) {
      clearInterval(this.timeoutInterval);
    }
    if (this.inactivityInterval) {
      clearInterval(this.inactivityInterval);
    }
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
  }

  async checkAllTimeouts() {
    await QueueManager.checkTimeouts();
  }

  async requestHumanOperator(userRequest) {
    try {
      const { user_id, user_email, user_phone, question, priority = 'medium', metadata = {} } = userRequest;
      
      // Verifica disponibilità operatori
      const availableOperators = await Operator.getAvailable();
      const systemStats = await QueueManager.getSystemStats();
      
      console.log(`📞 Richiesta operatore: ${availableOperators.length} disponibili, ${systemStats.in_queue} in coda`);

      if (availableOperators.length === 0) {
        // Nessun operatore disponibile
        if (parseInt(systemStats.in_queue) >= 5) {
          // Coda troppo lunga, crea direttamente ticket
          console.log('⚠️ Coda troppo lunga, creazione ticket diretto');
          return await this.createDirectTicket(userRequest, 'queue_full');
        } else {
          // Metti in coda
          const session = await QueueManager.createChatSession({
            user_id, user_email, user_phone, 
            initial_question: question, 
            priority, 
            metadata: { ...metadata, escalation_requested: true }
          });

          const position = await QueueManager.getQueuePosition(session.id);
          
          return {
            type: 'queue',
            session_id: session.id,
            position: position.queue_position,
            estimated_wait: Math.ceil((position.ahead_count || 0) * 3), // 3 min per chat stimata
            message: `Sei in posizione ${position.queue_position} nella coda. Tempo stimato: ${Math.ceil((position.ahead_count || 0) * 3)} minuti.`
          };
        }
      }

      // Operatore disponibile, assegna direttamente
      const session = await QueueManager.createChatSession({
        user_id, user_email, user_phone, 
        initial_question: question, 
        priority, 
        metadata: { ...metadata, direct_assignment: true }
      });

      return {
        type: 'operator_assigned',
        session_id: session.id,
        message: 'Un operatore ti sta contattando...'
      };

    } catch (err) {
      console.error('Errore richiesta operatore:', err);
      
      // In caso di errore, fallback a ticket
      return await this.createDirectTicket(userRequest, 'system_error');
    }
  }

  async createDirectTicket(userRequest, reason) {
    try {
      const { user_id, user_email, user_phone, question, priority = 'medium', metadata = {} } = userRequest;
      
      // Crea ticket direttamente (usando il sistema esistente)
      const ticketResponse = await fetch('http://localhost:3001/api/tickets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id,
          user_email,
          user_phone,
          question,
          priority,
          category: 'escalated',
          metadata: { ...metadata, escalation_reason: reason }
        })
      });

      const ticket = await ticketResponse.json();
      
      return {
        type: 'ticket_created',
        ticket_id: ticket.ticket.id,
        message: `Non riesco a metterti in contatto con un operatore ora. Ho creato il ticket #${ticket.ticket.id}. Riceverai una risposta via email/WhatsApp entro 24h.`
      };

    } catch (err) {
      console.error('Errore creazione ticket diretto:', err);
      return {
        type: 'error',
        message: 'Servizio temporaneamente non disponibile. Riprova più tardi.'
      };
    }
  }

  async handleOperatorTimeout(sessionId, operatorId) {
    try {
      console.log(`⏰ Timeout operatore ${operatorId} per sessione ${sessionId}`);
      
      // Invia notifica di timeout
      if (this.config.notifyOnTimeout) {
        await notificationService.notifyOperatorTimeout(operatorId, sessionId);
      }

      // Escalation automatica
      const ticket = await QueueManager.escalateToTicket(sessionId, 'operator_timeout');
      
      if (this.config.notifyOnEscalation) {
        await notificationService.notifyEscalation(ticket, 'operator_timeout');
      }

      return ticket;

    } catch (err) {
      console.error('Errore gestione timeout operatore:', err);
      throw err;
    }
  }

  async handleQueueTimeout(sessionId) {
    try {
      console.log(`⏰ Timeout coda per sessione ${sessionId}`);
      
      const ticket = await QueueManager.escalateToTicket(sessionId, 'queue_timeout');
      
      if (this.config.notifyOnEscalation) {
        await notificationService.notifyEscalation(ticket, 'queue_timeout');
      }

      return ticket;

    } catch (err) {
      console.error('Errore gestione timeout coda:', err);
      throw err;
    }
  }

  async checkChatActivity(sessionId) {
    try {
      const { pool } = require('../models/database');
      
      // Controlla ultima attività nella chat
      const result = await pool.query(`
        SELECT 
          cs.id,
          cs.operator_id,
          cs.status,
          EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - COALESCE(
            (SELECT MAX(created_at) FROM chat_messages WHERE session_id = cs.id),
            cs.started_at
          )))/60 as minutes_inactive
        FROM chat_sessions cs
        WHERE cs.id = $1
      `, [sessionId]);

      if (result.rows.length === 0) return;

      const session = result.rows[0];
      
      if (session.status === 'operator_chat' && session.minutes_inactive > this.config.chatInactivityTimeout) {
        console.log(`💤 Chat ${sessionId} inattiva da ${Math.round(session.minutes_inactive)} minuti`);
        
        // Invia reminder all'operatore
        if (session.operator_id) {
          await notificationService.sendInactivityReminder(session.operator_id, sessionId);
        }
      }

    } catch (err) {
      console.error('Errore controllo attività chat:', err);
    }
  }

  async getEscalationRules() {
    return {
      timeout_rules: {
        operator_response: `${this.config.operatorResponseTimeout} minuti`,
        queue_wait: `${this.config.queueTimeout} minuti`,
        chat_inactivity: `${this.config.chatInactivityTimeout} minuti`,
        operator_inactivity: `${this.config.operatorInactivityTimeout} minuti`
      },
      capacity_rules: {
        max_concurrent_chats: this.config.maxConcurrentChats,
        priority_queue: this.config.priorityQueueEnabled,
        auto_escalate_when_queue_full: true
      },
      notification_rules: {
        notify_on_timeout: this.config.notifyOnTimeout,
        notify_on_escalation: this.config.notifyOnEscalation,
        reminder_after_minutes: this.config.sendReminderAfter
      }
    };
  }

  async updateConfig(newConfig) {
    this.config = { ...this.config, ...newConfig };
    console.log('⚙️ Configurazione escalation aggiornata:', this.config);
  }

  async cleanupOldSessions() {
    try {
      const { pool } = require('../models/database');
      
      // Rimuovi sessioni molto vecchie che sono state risolte o escalate
      const result = await pool.query(`
        DELETE FROM chat_sessions 
        WHERE status IN ('resolved', 'escalated_ticket') 
        AND ended_at < CURRENT_TIMESTAMP - INTERVAL '7 days'
      `);

      if (result.rowCount > 0) {
        console.log(`🧹 Pulite ${result.rowCount} sessioni vecchie`);
      }

    } catch (err) {
      console.error('Errore pulizia sessioni:', err);
    }
  }

  async getEscalationStats(days = 7) {
    try {
      const { pool } = require('../models/database');
      
      const result = await pool.query(`
        SELECT 
          DATE(created_at) as date,
          COUNT(*) FILTER (WHERE status = 'escalated_ticket') as escalated_count,
          COUNT(*) FILTER (WHERE escalation_reason = 'operator_timeout') as operator_timeouts,
          COUNT(*) FILTER (WHERE escalation_reason = 'queue_timeout') as queue_timeouts,
          COUNT(*) FILTER (WHERE escalation_reason = 'operator_offline') as operator_offline,
          AVG(EXTRACT(EPOCH FROM (assigned_at - created_at))/60) FILTER (WHERE assigned_at IS NOT NULL) as avg_assignment_minutes,
          COUNT(*) FILTER (WHERE status = 'resolved') as resolved_count,
          COUNT(*) as total_sessions
        FROM chat_sessions 
        WHERE created_at >= CURRENT_DATE - INTERVAL '${days} days'
        GROUP BY DATE(created_at)
        ORDER BY date DESC
      `);

      return result.rows;

    } catch (err) {
      console.error('Errore statistiche escalation:', err);
      throw err;
    }
  }
}

module.exports = new EscalationService();