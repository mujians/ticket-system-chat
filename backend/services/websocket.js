const { Server } = require('socket.io');
const Operator = require('../models/operator');
const QueueManager = require('../models/queue');
const escalationService = require('./escalation');

class WebSocketService {
  constructor(server) {
    this.io = new Server(server, {
      cors: {
        origin: process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:3000'],
        methods: ['GET', 'POST']
      },
      transports: ['websocket', 'polling']
    });

    this.operatorSockets = new Map(); // operatorId -> socket
    this.customerSockets = new Map(); // sessionId -> socket
    this.sessionRooms = new Map();    // sessionId -> [operatorSocket, customerSocket]

    this.setupSocketHandlers();
    console.log('🔌 WebSocket service inizializzato');
  }

  setupSocketHandlers() {
    this.io.on('connection', (socket) => {
      console.log(`🔗 Nuova connessione WebSocket: ${socket.id}`);

      // Gestione disconnessione
      socket.on('disconnect', () => {
        this.handleDisconnection(socket);
      });

      // Operatore si connette
      socket.on('operator:connect', async (data) => {
        await this.handleOperatorConnect(socket, data);
      });

      // Operatore si disconnette
      socket.on('operator:disconnect', async (data) => {
        await this.handleOperatorDisconnect(socket, data);
      });

      // Cliente si connette a una sessione
      socket.on('customer:join_session', async (data) => {
        await this.handleCustomerJoinSession(socket, data);
      });

      // Invio messaggio in chat
      socket.on('chat:message', async (data) => {
        await this.handleChatMessage(socket, data);
      });

      // Operatore accetta una chat
      socket.on('operator:accept_chat', async (data) => {
        await this.handleOperatorAcceptChat(socket, data);
      });

      // Operatore termina una chat
      socket.on('operator:end_chat', async (data) => {
        await this.handleOperatorEndChat(socket, data);
      });

      // Richiesta status coda
      socket.on('queue:status', async (data) => {
        await this.handleQueueStatus(socket, data);
      });

      // Typing indicators
      socket.on('chat:typing', (data) => {
        this.handleTyping(socket, data);
      });

      // Heartbeat per mantenere la connessione attiva
      socket.on('heartbeat', async (data) => {
        if (data.operatorId) {
          await Operator.updateActivity(data.operatorId);
        }
        socket.emit('heartbeat_ack');
      });
    });
  }

  async handleOperatorConnect(socket, data) {
    try {
      const { operatorId, name } = data;
      
      if (!operatorId) {
        socket.emit('error', { message: 'ID operatore richiesto' });
        return;
      }

      // Registra operatore come online
      const operator = await Operator.setOnline(operatorId, socket.id);
      if (!operator) {
        socket.emit('error', { message: 'Operatore non trovato' });
        return;
      }

      // Salva mapping socket
      this.operatorSockets.set(operatorId, socket);
      socket.operatorId = operatorId;
      socket.userType = 'operator';

      // Unisciti alla room degli operatori
      socket.join('operators');
      socket.join(`operator:${operatorId}`);

      console.log(`✅ Operatore ${operator.name} (${operatorId}) connesso`);

      // Invia conferma di connessione
      socket.emit('operator:connected', {
        operator: {
          id: operator.id,
          name: operator.name,
          status: operator.status
        }
      });

      // Notifica altri operatori
      socket.to('operators').emit('operator:status_change', {
        operatorId,
        name: operator.name,
        status: 'available',
        isOnline: true
      });

      // Invia statistiche iniziali
      const stats = await QueueManager.getSystemStats();
      socket.emit('system:stats', stats);

    } catch (err) {
      console.error('Errore connessione operatore:', err);
      socket.emit('error', { message: 'Errore connessione' });
    }
  }

  async handleOperatorDisconnect(socket, data) {
    const operatorId = data?.operatorId || socket.operatorId;
    if (operatorId) {
      await this.setOperatorOffline(operatorId);
    }
  }

  async handleCustomerJoinSession(socket, data) {
    try {
      const { sessionId, userId } = data;
      
      if (!sessionId) {
        socket.emit('error', { message: 'ID sessione richiesto' });
        return;
      }

      // Verifica che la sessione esista
      const { pool } = require('../models/database');
      const sessionResult = await pool.query(
        'SELECT * FROM chat_sessions WHERE id = $1',
        [sessionId]
      );

      if (sessionResult.rows.length === 0) {
        socket.emit('error', { message: 'Sessione non trovata' });
        return;
      }

      const session = sessionResult.rows[0];

      // Salva mapping
      this.customerSockets.set(sessionId, socket);
      socket.sessionId = sessionId;
      socket.userId = userId;
      socket.userType = 'customer';

      // Unisciti alla room della sessione
      socket.join(`session:${sessionId}`);

      console.log(`👤 Cliente ${userId} connesso alla sessione ${sessionId}`);

      // Invia stato sessione
      const position = session.status === 'queue_waiting' ? 
        await QueueManager.getQueuePosition(sessionId) : null;

      socket.emit('session:joined', {
        sessionId,
        status: session.status,
        position: position?.queue_position,
        estimatedWait: position ? Math.ceil((position.ahead_count || 0) * 3) : null
      });

      // Carica messaggi esistenti
      const messagesResult = await pool.query(
        'SELECT * FROM chat_messages WHERE session_id = $1 ORDER BY created_at ASC',
        [sessionId]
      );

      if (messagesResult.rows.length > 0) {
        socket.emit('chat:history', messagesResult.rows);
      }

      // Notifica operatore se assegnato
      if (session.operator_id) {
        const operatorSocket = this.operatorSockets.get(session.operator_id);
        if (operatorSocket) {
          operatorSocket.emit('customer:connected', { sessionId, userId });
        }
      }

    } catch (err) {
      console.error('Errore join sessione cliente:', err);
      socket.emit('error', { message: 'Errore connessione sessione' });
    }
  }

  async handleChatMessage(socket, data) {
    try {
      const { sessionId, message, messageType = 'text' } = data;
      const senderType = socket.userType;
      const senderId = senderType === 'operator' ? socket.operatorId : socket.userId;

      if (!sessionId || !message) {
        socket.emit('error', { message: 'Dati messaggio mancanti' });
        return;
      }

      // Salva messaggio nel database
      const { pool } = require('../models/database');
      const result = await pool.query(`
        INSERT INTO chat_messages (session_id, sender_type, sender_id, message, message_type)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING *
      `, [sessionId, senderType, senderId, message, messageType]);

      const savedMessage = result.rows[0];

      // Invia messaggio a tutti nella room della sessione
      this.io.to(`session:${sessionId}`).emit('chat:new_message', savedMessage);

      // Aggiorna attività operatore se è lui che ha inviato il messaggio
      if (senderType === 'operator') {
        await Operator.updateActivity(socket.operatorId);
      }

      console.log(`💬 Messaggio in sessione ${sessionId} da ${senderType} ${senderId}`);

    } catch (err) {
      console.error('Errore invio messaggio:', err);
      socket.emit('error', { message: 'Errore invio messaggio' });
    }
  }

  async handleOperatorAcceptChat(socket, data) {
    try {
      const { sessionId } = data;
      const operatorId = socket.operatorId;

      if (!sessionId || !operatorId) {
        socket.emit('error', { message: 'Dati mancanti' });
        return;
      }

      // Accetta la chat
      const success = await QueueManager.acceptChat(operatorId, sessionId);
      
      if (success) {
        // Unisciti alla room della sessione
        socket.join(`session:${sessionId}`);
        
        // Notifica il cliente
        socket.to(`session:${sessionId}`).emit('chat:operator_joined', {
          operatorId,
          operatorName: socket.operatorName || 'Operatore'
        });

        // Conferma all'operatore
        socket.emit('chat:accepted', { sessionId });

        console.log(`✅ Operatore ${operatorId} ha accettato la chat ${sessionId}`);
      } else {
        socket.emit('error', { message: 'Impossibile accettare la chat' });
      }

    } catch (err) {
      console.error('Errore accettazione chat:', err);
      socket.emit('error', { message: 'Errore accettazione chat' });
    }
  }

  async handleOperatorEndChat(socket, data) {
    try {
      const { sessionId } = data;
      const operatorId = socket.operatorId;

      if (!sessionId || !operatorId) {
        socket.emit('error', { message: 'Dati mancanti' });
        return;
      }

      // Termina la chat
      const success = await QueueManager.endChat(sessionId, operatorId);
      
      if (success) {
        // Notifica il cliente
        socket.to(`session:${sessionId}`).emit('chat:ended', {
          reason: 'operator_ended',
          message: 'La chat è stata terminata dall\'operatore'
        });

        // Lascia la room
        socket.leave(`session:${sessionId}`);
        
        // Conferma all'operatore
        socket.emit('chat:ended', { sessionId });

        console.log(`🔚 Operatore ${operatorId} ha terminato la chat ${sessionId}`);
      } else {
        socket.emit('error', { message: 'Impossibile terminare la chat' });
      }

    } catch (err) {
      console.error('Errore terminazione chat:', err);
      socket.emit('error', { message: 'Errore terminazione chat' });
    }
  }

  async handleQueueStatus(socket, data) {
    try {
      const { sessionId } = data;
      
      if (sessionId) {
        const position = await QueueManager.getQueuePosition(sessionId);
        socket.emit('queue:position', {
          sessionId,
          position: position.queue_position,
          ahead: position.ahead_count,
          estimatedWait: Math.ceil((position.ahead_count || 0) * 3)
        });
      }

      // Invia anche statistiche generali se è un operatore
      if (socket.userType === 'operator') {
        const stats = await QueueManager.getSystemStats();
        socket.emit('system:stats', stats);
      }

    } catch (err) {
      console.error('Errore status coda:', err);
      socket.emit('error', { message: 'Errore recupero status' });
    }
  }

  handleTyping(socket, data) {
    const { sessionId, isTyping } = data;
    
    if (sessionId) {
      socket.to(`session:${sessionId}`).emit('chat:typing', {
        senderType: socket.userType,
        senderId: socket.userType === 'operator' ? socket.operatorId : socket.userId,
        isTyping
      });
    }
  }

  async handleDisconnection(socket) {
    const { operatorId, sessionId, userType } = socket;
    
    console.log(`🔗❌ Disconnessione ${userType || 'unknown'}: ${socket.id}`);

    if (userType === 'operator' && operatorId) {
      await this.setOperatorOffline(operatorId);
    } else if (userType === 'customer' && sessionId) {
      this.customerSockets.delete(sessionId);
      
      // Notifica operatore della disconnessione cliente
      const { pool } = require('../models/database');
      const sessionResult = await pool.query(
        'SELECT operator_id FROM chat_sessions WHERE id = $1',
        [sessionId]
      );
      
      if (sessionResult.rows.length > 0 && sessionResult.rows[0].operator_id) {
        const operatorSocket = this.operatorSockets.get(sessionResult.rows[0].operator_id);
        if (operatorSocket) {
          operatorSocket.emit('customer:disconnected', { sessionId });
        }
      }
    }
  }

  async setOperatorOffline(operatorId) {
    try {
      await Operator.setOffline(operatorId);
      this.operatorSockets.delete(operatorId);
      
      // Notifica altri operatori
      this.io.to('operators').emit('operator:status_change', {
        operatorId,
        status: 'offline',
        isOnline: false
      });

      console.log(`❌ Operatore ${operatorId} disconnesso`);

    } catch (err) {
      console.error('Errore set operatore offline:', err);
    }
  }

  // Metodi pubblici per inviare notifiche

  notifyOperatorNewSession(sessionId) {
    this.io.to('operators').emit('queue:new_session', { sessionId });
  }

  notifySessionAssigned(sessionId, operatorId) {
    const customerSocket = this.customerSockets.get(sessionId);
    if (customerSocket) {
      customerSocket.emit('session:operator_assigned', { operatorId });
    }
  }

  notifySessionEscalated(sessionId, ticketId) {
    const customerSocket = this.customerSockets.get(sessionId);
    if (customerSocket) {
      customerSocket.emit('session:escalated', { 
        ticketId,
        message: `La tua richiesta è stata convertita nel ticket #${ticketId}. Riceverai una risposta via email.`
      });
    }
  }

  broadcastSystemStats() {
    // Invia statistiche aggiornate a tutti gli operatori
    QueueManager.getSystemStats().then(stats => {
      this.io.to('operators').emit('system:stats', stats);
    });
  }
}

module.exports = WebSocketService;