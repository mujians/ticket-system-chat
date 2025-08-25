const express = require('express');
const router = express.Router();
const QueueManager = require('../models/queue');
const Operator = require('../models/operator');
const escalationService = require('../services/escalation');
const { initChatDatabase } = require('../models/database-extended');

// Initialize chat database on first request
let chatDbInitialized = false;
router.use(async (req, res, next) => {
  if (!chatDbInitialized) {
    try {
      await initChatDatabase();
      chatDbInitialized = true;
      
      // Start escalation system
      escalationService.startEscalationSystem();
      console.log('✅ Sistema di escalation avviato');
    } catch (err) {
      console.error('❌ Errore inizializzazione chat:', err);
      return res.status(500).json({ error: 'Errore inizializzazione sistema chat' });
    }
  }
  next();
});

// Request human operator (called by chatbot)
router.post('/request-operator', async (req, res) => {
  try {
    const result = await escalationService.requestHumanOperator(req.body);
    
    res.json({
      success: true,
      ...result
    });

  } catch (err) {
    console.error('Errore richiesta operatore:', err);
    res.status(500).json({ 
      success: false,
      error: 'Errore interno del server',
      type: 'error',
      message: 'Servizio temporaneamente non disponibile'
    });
  }
});

// Get chat session details
router.get('/session/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const { pool } = require('../models/database');
    const sessionResult = await pool.query(
      'SELECT * FROM chat_sessions WHERE id = $1',
      [id]
    );

    if (sessionResult.rows.length === 0) {
      return res.status(404).json({ error: 'Sessione non trovata' });
    }

    const session = sessionResult.rows[0];

    // Get messages
    const messagesResult = await pool.query(
      'SELECT * FROM chat_messages WHERE session_id = $1 ORDER BY created_at ASC',
      [id]
    );

    // Get queue position if waiting
    let queueInfo = null;
    if (session.status === 'queue_waiting') {
      queueInfo = await QueueManager.getQueuePosition(id);
    }

    res.json({
      success: true,
      session,
      messages: messagesResult.rows,
      queueInfo
    });

  } catch (err) {
    console.error('Errore recupero sessione:', err);
    res.status(500).json({ error: 'Errore interno del server' });
  }
});

// Get queue status
router.get('/queue/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const position = await QueueManager.getQueuePosition(sessionId);
    
    res.json({
      success: true,
      position: position.queue_position,
      ahead: position.ahead_count,
      estimatedWait: Math.ceil((position.ahead_count || 0) * 3)
    });

  } catch (err) {
    console.error('Errore status coda:', err);
    res.status(500).json({ error: 'Errore interno del server' });
  }
});

// Operator endpoints

// Create operator
router.post('/operators', async (req, res) => {
  try {
    const { name, email, phone, role, permissions } = req.body;
    
    if (!name || !email) {
      return res.status(400).json({ error: 'Nome e email richiesti' });
    }

    const operator = await Operator.create({
      name, email, phone, role, permissions
    });

    res.status(201).json({ success: true, data: operator });

  } catch (err) {
    console.error('Errore creazione operatore:', err);
    if (err.constraint === 'operators_email_key') {
      res.status(400).json({ error: 'Email già in uso' });
    } else {
      res.status(500).json({ error: 'Errore interno del server' });
    }
  }
});

// Get all operators
router.get('/operators', async (req, res) => {
  try {
    const { includeOffline } = req.query;
    const operators = await Operator.getAll({ 
      includeOffline: includeOffline !== 'false' 
    });

    res.json({ success: true, data: operators });

  } catch (err) {
    console.error('Errore lista operatori:', err);
    res.status(500).json({ error: 'Errore interno del server' });
  }
});

// Get operator workload
router.get('/operators/workload', async (req, res) => {
  try {
    const workload = await Operator.getWorkload();
    res.json({ success: true, data: workload });

  } catch (err) {
    console.error('Errore carico lavoro:', err);
    res.status(500).json({ error: 'Errore interno del server' });
  }
});

// Set operator online/offline
router.put('/operators/:id/status', async (req, res) => {
  try {
    const { id } = req.params;
    const { isOnline, socketId } = req.body;

    let operator;
    if (isOnline) {
      operator = await Operator.setOnline(id, socketId);
    } else {
      operator = await Operator.setOffline(id);
    }

    if (!operator) {
      return res.status(404).json({ error: 'Operatore non trovato' });
    }

    res.json({ success: true, data: operator });

  } catch (err) {
    console.error('Errore aggiornamento status operatore:', err);
    res.status(500).json({ error: 'Errore interno del server' });
  }
});

// Get operator stats
router.get('/operators/:id/stats', async (req, res) => {
  try {
    const { id } = req.params;
    const { date } = req.query;

    const stats = await Operator.getDailyStats(id, date);
    res.json({ success: true, data: stats });

  } catch (err) {
    console.error('Errore statistiche operatore:', err);
    res.status(500).json({ error: 'Errore interno del server' });
  }
});

// Chat session management

// Get all chat sessions (for admin)
router.get('/sessions', async (req, res) => {
  try {
    const { status, operatorId, page = 1, limit = 20 } = req.query;
    const { pool } = require('../models/database');
    
    let query = `
      SELECT cs.*, o.name as operator_name,
             EXTRACT(EPOCH FROM (NOW() - cs.created_at))/60 as age_minutes
      FROM chat_sessions cs
      LEFT JOIN operators o ON cs.operator_id = o.id
      WHERE 1=1
    `;
    
    const params = [];
    let paramCount = 0;

    if (status) {
      paramCount++;
      query += ` AND cs.status = $${paramCount}`;
      params.push(status);
    }

    if (operatorId) {
      paramCount++;
      query += ` AND cs.operator_id = $${paramCount}`;
      params.push(operatorId);
    }

    query += ` ORDER BY cs.created_at DESC`;
    
    // Add pagination
    const offset = (parseInt(page) - 1) * parseInt(limit);
    paramCount++;
    query += ` LIMIT $${paramCount}`;
    params.push(parseInt(limit));
    
    paramCount++;
    query += ` OFFSET $${paramCount}`;
    params.push(offset);

    const result = await pool.query(query, params);

    // Get total count
    let countQuery = 'SELECT COUNT(*) FROM chat_sessions cs WHERE 1=1';
    const countParams = [];
    let countParamCount = 0;

    if (status) {
      countParamCount++;
      countQuery += ` AND cs.status = $${countParamCount}`;
      countParams.push(status);
    }

    if (operatorId) {
      countParamCount++;
      countQuery += ` AND cs.operator_id = $${countParamCount}`;
      countParams.push(operatorId);
    }

    const countResult = await pool.query(countQuery, countParams);
    const total = parseInt(countResult.rows[0].count);

    res.json({
      success: true,
      data: result.rows,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit))
      }
    });

  } catch (err) {
    console.error('Errore lista sessioni:', err);
    res.status(500).json({ error: 'Errore interno del server' });
  }
});

// End chat session
router.put('/sessions/:id/end', async (req, res) => {
  try {
    const { id } = req.params;
    const { operatorId, reason = 'operator_ended' } = req.body;

    if (!operatorId) {
      return res.status(400).json({ error: 'ID operatore richiesto' });
    }

    const success = await QueueManager.endChat(id, operatorId);
    
    if (success) {
      res.json({ success: true, message: 'Chat terminata con successo' });
    } else {
      res.status(400).json({ error: 'Impossibile terminare la chat' });
    }

  } catch (err) {
    console.error('Errore terminazione chat:', err);
    res.status(500).json({ error: 'Errore interno del server' });
  }
});

// Force escalate session to ticket
router.put('/sessions/:id/escalate', async (req, res) => {
  try {
    const { id } = req.params;
    const { reason = 'manual_escalation' } = req.body;

    const ticket = await QueueManager.escalateToTicket(id, reason);
    
    res.json({ 
      success: true, 
      message: 'Sessione escalata con successo',
      ticketId: ticket.id 
    });

  } catch (err) {
    console.error('Errore escalation manuale:', err);
    res.status(500).json({ error: 'Errore interno del server' });
  }
});

// System stats and monitoring

// Get comprehensive system stats
router.get('/stats', async (req, res) => {
  try {
    const { getSystemStats } = require('../models/database-extended');
    const stats = await getSystemStats();
    
    res.json({ success: true, data: stats });

  } catch (err) {
    console.error('Errore statistiche sistema:', err);
    res.status(500).json({ error: 'Errore interno del server' });
  }
});

// Get escalation statistics
router.get('/escalation/stats', async (req, res) => {
  try {
    const { days = 7 } = req.query;
    const stats = await escalationService.getEscalationStats(parseInt(days));
    
    res.json({ success: true, data: stats });

  } catch (err) {
    console.error('Errore statistiche escalation:', err);
    res.status(500).json({ error: 'Errore interno del server' });
  }
});

// Get current escalation rules
router.get('/escalation/rules', async (req, res) => {
  try {
    const rules = await escalationService.getEscalationRules();
    res.json({ success: true, data: rules });

  } catch (err) {
    console.error('Errore regole escalation:', err);
    res.status(500).json({ error: 'Errore interno del server' });
  }
});

// Update escalation config
router.put('/escalation/config', async (req, res) => {
  try {
    const newConfig = req.body;
    await escalationService.updateConfig(newConfig);
    
    res.json({ success: true, message: 'Configurazione aggiornata' });

  } catch (err) {
    console.error('Errore aggiornamento config:', err);
    res.status(500).json({ error: 'Errore interno del server' });
  }
});

// Cleanup old sessions (manual trigger)
router.post('/cleanup', async (req, res) => {
  try {
    const { days = 7 } = req.body;
    const { cleanupSessions } = require('../models/database-extended');
    
    const cleaned = await cleanupSessions(days);
    
    res.json({ 
      success: true, 
      message: `Pulite ${cleaned} sessioni vecchie` 
    });

  } catch (err) {
    console.error('Errore pulizia:', err);
    res.status(500).json({ error: 'Errore interno del server' });
  }
});

// Health check for chat system
router.get('/health', async (req, res) => {
  try {
    const { pool } = require('../models/database');
    
    // Test database connection
    await pool.query('SELECT 1');
    
    // Get basic stats
    const stats = await QueueManager.getSystemStats();
    
    res.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      database: 'connected',
      escalationSystem: escalationService ? 'running' : 'stopped',
      activeChats: stats.active_chats || 0,
      queueLength: stats.in_queue || 0,
      operatorsOnline: stats.available_operators || 0
    });

  } catch (err) {
    console.error('Health check failed:', err);
    res.status(503).json({
      status: 'unhealthy',
      error: err.message
    });
  }
});

module.exports = router;