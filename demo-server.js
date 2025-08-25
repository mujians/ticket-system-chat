// Demo server completo con storage in-memory per test
const express = require('express');
const cors = require('cors');
const path = require('path');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const PORT = process.env.PORT || 3003;

// In-memory storage
let tickets = [];
let operators = [];
let chatSessions = [];
let chatMessages = [];
let currentTicketId = 1;
let currentOperatorId = 1;
let currentSessionId = 1;
let currentMessageId = 1;

// WebSocket connections
const operatorSockets = new Map();
const customerSockets = new Map();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'backend/admin')));

// === WEBSOCKET HANDLERS ===
io.on('connection', (socket) => {
  console.log(`🔗 Connessione WebSocket: ${socket.id}`);

  socket.on('operator:connect', (data) => {
    const { operatorId, name } = data;
    
    // Find or create operator
    let operator = operators.find(o => o.id == operatorId);
    if (!operator) {
      operator = {
        id: operatorId,
        name: name || `Operatore ${operatorId}`,
        email: `operator${operatorId}@demo.com`,
        status: 'available',
        isOnline: true,
        socketId: socket.id
      };
      operators.push(operator);
    } else {
      operator.status = 'available';
      operator.isOnline = true;
      operator.socketId = socket.id;
    }

    operatorSockets.set(operatorId, socket);
    socket.operatorId = operatorId;
    socket.userType = 'operator';
    socket.join('operators');

    socket.emit('operator:connected', { operator });
    socket.to('operators').emit('operator:status_change', {
      operatorId,
      name: operator.name,
      status: 'available',
      isOnline: true
    });

    // Send initial stats
    const stats = getSystemStats();
    socket.emit('system:stats', stats);

    console.log(`✅ Operatore ${name} (${operatorId}) connesso`);
  });

  socket.on('customer:join_session', (data) => {
    const { sessionId, userId } = data;
    
    const session = chatSessions.find(s => s.id == sessionId);
    if (!session) {
      socket.emit('error', { message: 'Sessione non trovata' });
      return;
    }

    customerSockets.set(sessionId, socket);
    socket.sessionId = sessionId;
    socket.userId = userId;
    socket.userType = 'customer';
    socket.join(`session:${sessionId}`);

    // Send session status
    socket.emit('session:joined', {
      sessionId,
      status: session.status,
      position: session.queuePosition
    });

    // Send message history
    const messages = chatMessages.filter(m => m.sessionId == sessionId);
    if (messages.length > 0) {
      socket.emit('chat:history', messages);
    }

    console.log(`👤 Cliente ${userId} connesso alla sessione ${sessionId}`);
  });

  socket.on('chat:message', (data) => {
    const { sessionId, message } = data;
    const senderType = socket.userType;
    const senderId = senderType === 'operator' ? socket.operatorId : socket.userId;

    const newMessage = {
      id: currentMessageId++,
      sessionId,
      senderType,
      senderId,
      message,
      createdAt: new Date().toISOString()
    };

    chatMessages.push(newMessage);
    io.to(`session:${sessionId}`).emit('chat:new_message', newMessage);

    console.log(`💬 Messaggio in sessione ${sessionId} da ${senderType} ${senderId}`);
  });

  socket.on('operator:accept_chat', (data) => {
    const { sessionId } = data;
    const operatorId = socket.operatorId;

    const session = chatSessions.find(s => s.id == sessionId);
    if (session && session.status === 'queue_waiting') {
      session.status = 'operator_chat';
      session.operatorId = operatorId;
      session.startedAt = new Date().toISOString();

      // Update operator status
      const operator = operators.find(o => o.id == operatorId);
      if (operator) {
        operator.status = 'busy';
      }

      socket.join(`session:${sessionId}`);
      socket.to(`session:${sessionId}`).emit('chat:operator_joined', {
        operatorId,
        operatorName: operator?.name || 'Operatore'
      });

      // Add system message
      const systemMessage = {
        id: currentMessageId++,
        sessionId,
        senderType: 'system',
        senderId: 'system',
        message: 'Operatore connesso alla chat',
        createdAt: new Date().toISOString()
      };
      chatMessages.push(systemMessage);
      io.to(`session:${sessionId}`).emit('chat:new_message', systemMessage);

      socket.emit('chat:accepted', { sessionId });
      console.log(`✅ Operatore ${operatorId} ha accettato la chat ${sessionId}`);
    }
  });

  socket.on('operator:end_chat', (data) => {
    const { sessionId } = data;
    const operatorId = socket.operatorId;

    const session = chatSessions.find(s => s.id == sessionId);
    if (session) {
      session.status = 'resolved';
      session.endedAt = new Date().toISOString();

      // Free operator
      const operator = operators.find(o => o.id == operatorId);
      if (operator) {
        operator.status = 'available';
      }

      socket.to(`session:${sessionId}`).emit('chat:ended', {
        reason: 'operator_ended',
        message: 'La chat è stata terminata dall\'operatore'
      });

      socket.leave(`session:${sessionId}`);
      socket.emit('chat:ended', { sessionId });

      console.log(`🔚 Operatore ${operatorId} ha terminato la chat ${sessionId}`);
    }
  });

  socket.on('chat:typing', (data) => {
    const { sessionId, isTyping } = data;
    socket.to(`session:${sessionId}`).emit('chat:typing', {
      senderType: socket.userType,
      senderId: socket.userType === 'operator' ? socket.operatorId : socket.userId,
      isTyping
    });
  });

  socket.on('disconnect', () => {
    if (socket.userType === 'operator' && socket.operatorId) {
      const operator = operators.find(o => o.id == socket.operatorId);
      if (operator) {
        operator.isOnline = false;
        operator.status = 'offline';
      }
      operatorSockets.delete(socket.operatorId);

      socket.to('operators').emit('operator:status_change', {
        operatorId: socket.operatorId,
        status: 'offline',
        isOnline: false
      });

      console.log(`❌ Operatore ${socket.operatorId} disconnesso`);
    }

    if (socket.userType === 'customer' && socket.sessionId) {
      customerSockets.delete(socket.sessionId);
    }
  });
});

// === API ROUTES ===

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'OK',
    timestamp: new Date().toISOString(),
    environment: 'demo',
    database: 'in-memory'
  });
});

// Chat health
app.get('/api/chat/health', (req, res) => {
  const stats = getSystemStats();
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    database: 'in-memory',
    escalationSystem: 'demo',
    activeChats: stats.activeChats,
    queueLength: stats.inQueue,
    operatorsOnline: stats.operatorsOnline
  });
});

// Request operator
app.post('/api/chat/request-operator', (req, res) => {
  const { user_id, user_email, user_phone, question, priority = 'medium' } = req.body;

  // Check available operators
  const availableOperators = operators.filter(o => o.isOnline && o.status === 'available');
  
  if (availableOperators.length === 0) {
    // No operators available - create ticket
    const ticket = {
      id: currentTicketId++,
      userId: user_id,
      userEmail: user_email,
      userPhone: user_phone,
      question,
      priority,
      status: 'open',
      createdAt: new Date().toISOString()
    };
    
    tickets.push(ticket);
    
    console.log(`🎫 Nessun operatore disponibile - Ticket #${ticket.id} creato`);
    
    return res.json({
      success: true,
      type: 'ticket_created',
      ticket_id: ticket.id,
      message: `Non ci sono operatori disponibili. Ho creato il ticket #${ticket.id}. Riceverai risposta via email entro 24h.`
    });
  }

  // Create chat session
  const session = {
    id: currentSessionId++,
    userId: user_id,
    userEmail: user_email,
    userPhone: user_phone,
    initialQuestion: question,
    status: 'queue_waiting',
    priority,
    queuePosition: getQueueLength() + 1,
    createdAt: new Date().toISOString()
  };

  chatSessions.push(session);

  // Auto-assign to available operator
  const operator = availableOperators[0];
  session.status = 'operator_assigned';
  session.operatorId = operator.id;
  session.assignedAt = new Date().toISOString();

  // Notify operator
  const operatorSocket = operatorSockets.get(operator.id);
  if (operatorSocket) {
    operatorSocket.emit('queue:new_session', { sessionId: session.id });
  }

  console.log(`💬 Chat ${session.id} assegnata a operatore ${operator.id}`);

  res.json({
    success: true,
    type: 'operator_assigned',
    session_id: session.id,
    message: 'Un operatore ti sta contattando...'
  });
});

// Get system stats
app.get('/api/chat/stats', (req, res) => {
  const stats = getSystemStats();
  res.json({ success: true, data: stats });
});

// Create operator
app.post('/api/chat/operators', (req, res) => {
  const { name, email, phone } = req.body;
  
  const operator = {
    id: currentOperatorId++,
    name,
    email,
    phone,
    status: 'offline',
    isOnline: false,
    createdAt: new Date().toISOString()
  };
  
  operators.push(operator);
  
  res.status(201).json({ success: true, data: operator });
});

// Get operators
app.get('/api/chat/operators', (req, res) => {
  res.json({ success: true, data: operators });
});

// Get sessions
app.get('/api/chat/sessions', (req, res) => {
  const { status, page = 1, limit = 20 } = req.query;
  let filteredSessions = chatSessions;

  if (status) {
    filteredSessions = chatSessions.filter(s => s.status === status);
  }

  const offset = (parseInt(page) - 1) * parseInt(limit);
  const paginatedSessions = filteredSessions
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(offset, offset + parseInt(limit));

  res.json({
    success: true,
    data: paginatedSessions,
    pagination: {
      page: parseInt(page),
      limit: parseInt(limit),
      total: filteredSessions.length,
      pages: Math.ceil(filteredSessions.length / parseInt(limit))
    }
  });
});

// Ticket routes (original system)
app.post('/api/tickets', (req, res) => {
  const { user_id, user_email, user_phone, question, priority = 'medium', category = 'general' } = req.body;
  
  if (!question) {
    return res.status(400).json({ error: 'Domanda richiesta' });
  }

  const ticket = {
    id: currentTicketId++,
    userId: user_id,
    userEmail: user_email,
    userPhone: user_phone,
    question,
    response: null,
    status: 'open',
    priority,
    category,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    respondedAt: null
  };

  tickets.push(ticket);
  console.log(`✅ Ticket #${ticket.id} creato`);

  res.status(201).json({
    success: true,
    ticket: {
      id: ticket.id,
      status: ticket.status,
      created_at: ticket.createdAt
    }
  });
});

app.get('/api/tickets', (req, res) => {
  const { status, page = 1, limit = 20 } = req.query;
  let filteredTickets = tickets;

  if (status) {
    filteredTickets = tickets.filter(t => t.status === status);
  }

  const offset = (parseInt(page) - 1) * parseInt(limit);
  const paginatedTickets = filteredTickets
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(offset, offset + parseInt(limit));

  res.json({
    success: true,
    data: paginatedTickets,
    pagination: {
      page: parseInt(page),
      limit: parseInt(limit),
      total: filteredTickets.length,
      pages: Math.ceil(filteredTickets.length / parseInt(limit)),
      hasMore: offset + parseInt(limit) < filteredTickets.length
    }
  });
});

app.put('/api/tickets/:id/respond', (req, res) => {
  const { id } = req.params;
  const { response } = req.body;
  
  const ticket = tickets.find(t => t.id == id);
  if (!ticket) {
    return res.status(404).json({ error: 'Ticket non trovato' });
  }

  if (!response) {
    return res.status(400).json({ error: 'Risposta richiesta' });
  }

  ticket.response = response;
  ticket.status = 'resolved';
  ticket.respondedAt = new Date().toISOString();
  ticket.updatedAt = new Date().toISOString();

  console.log(`✅ Risposta inviata per ticket #${ticket.id}`);

  res.json({ 
    success: true, 
    message: 'Risposta inviata con successo',
    data: ticket 
  });
});

app.get('/api/tickets/admin/stats', (req, res) => {
  const total = tickets.length;
  const open = tickets.filter(t => t.status === 'open').length;
  const resolved = tickets.filter(t => t.status === 'resolved').length;
  const closed = tickets.filter(t => t.status === 'closed').length;
  
  const today = new Date().toDateString();
  const todayTickets = tickets.filter(t => {
    const ticketDate = new Date(t.createdAt).toDateString();
    return ticketDate === today;
  }).length;

  res.json({
    success: true,
    data: { total, open, resolved, closed, today: todayTickets, avg_response_time_hours: 1.5 }
  });
});

// Static routes
app.get('/', (req, res) => {
  res.redirect('/admin');
});

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'backend/admin/index.html'));
});

app.get('/admin/operator-dashboard.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'backend/admin/operator-dashboard.html'));
});

app.get('/admin/customer-chat.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'backend/admin/customer-chat.html'));
});

app.get('/chat', (req, res) => {
  res.sendFile(path.join(__dirname, 'backend/admin/customer-chat.html'));
});

app.get('/operator', (req, res) => {
  res.sendFile(path.join(__dirname, 'backend/admin/operator-dashboard.html'));
});

// Helper functions
function getSystemStats() {
  const activeChats = chatSessions.filter(s => s.status === 'operator_chat').length;
  const inQueue = chatSessions.filter(s => s.status === 'queue_waiting').length;
  const operatorsOnline = operators.filter(o => o.isOnline).length;
  const operatorsAvailable = operators.filter(o => o.isOnline && o.status === 'available').length;
  
  const today = new Date().toDateString();
  const todayResolved = chatSessions.filter(s => {
    return s.status === 'resolved' && new Date(s.endedAt).toDateString() === today;
  }).length;

  return {
    active_chats: activeChats,
    in_queue: inQueue,
    today_resolved: todayResolved,
    operators_online: operatorsOnline,
    operators_available: operatorsAvailable,
    today_escalated: 0
  };
}

function getQueueLength() {
  return chatSessions.filter(s => s.status === 'queue_waiting').length;
}

// Auto-escalation simulation (every 2 minutes for demo)
setInterval(() => {
  const oldSessions = chatSessions.filter(s => 
    s.status === 'queue_waiting' && 
    new Date() - new Date(s.createdAt) > 2 * 60 * 1000 // 2 minutes for demo
  );

  oldSessions.forEach(session => {
    // Escalate to ticket
    const ticket = {
      id: currentTicketId++,
      userId: session.userId,
      userEmail: session.userEmail,
      userPhone: session.userPhone,
      question: `[ESCALATED] ${session.initialQuestion}`,
      status: 'open',
      priority: session.priority,
      category: 'escalated',
      createdAt: new Date().toISOString(),
      metadata: {
        escalationReason: 'queue_timeout_demo',
        originalSessionId: session.id
      }
    };

    tickets.push(ticket);
    
    // Update session
    session.status = 'escalated_ticket';
    session.ticketId = ticket.id;
    session.endedAt = new Date().toISOString();

    // Notify customer
    const customerSocket = customerSockets.get(session.id);
    if (customerSocket) {
      customerSocket.emit('session:escalated', {
        ticketId: ticket.id,
        message: `La tua richiesta è stata convertita nel ticket #${ticket.id}. Riceverai una risposta via email.`
      });
    }

    console.log(`⏰ Sessione ${session.id} escalata a ticket #${ticket.id} per timeout demo`);
  });
}, 120000); // Check every 2 minutes

// Start server
server.listen(PORT, () => {
  console.log(`🚀 Demo server completo avviato su porta ${PORT}`);
  console.log(`📊 Admin panel: http://localhost:${PORT}/admin`);
  console.log(`💬 Operator dashboard: http://localhost:${PORT}/admin/operator-dashboard.html`);
  console.log(`👤 Customer chat: http://localhost:${PORT}/admin/customer-chat.html`);
  console.log(`🔗 API base: http://localhost:${PORT}/api`);
  console.log(`🔌 WebSocket server: Running`);
  console.log(`\n⚠️  Questo è un server DEMO con storage in-memory`);
  console.log(`   Per produzione usare il server principale con PostgreSQL`);
  console.log(`   Auto-escalation demo: code > 2 minuti → ticket`);
});

module.exports = { app, server };