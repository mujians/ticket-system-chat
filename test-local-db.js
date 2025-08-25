// Simple script to test the system without PostgreSQL
// Uses in-memory data for demonstration

const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = 3002;

// In-memory storage for demo
let tickets = [];
let currentId = 1;

app.use(cors());
app.use(express.json());
app.use('/admin', express.static(path.join(__dirname, 'backend/admin')));

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Create ticket
app.post('/api/tickets', (req, res) => {
  const { user_id, user_email, user_phone, question, priority = 'medium', category = 'general' } = req.body;
  
  if (!question) {
    return res.status(400).json({ error: 'Domanda richiesta' });
  }

  const ticket = {
    id: currentId++,
    user_id,
    user_email,
    user_phone,
    question,
    response: null,
    status: 'open',
    priority,
    category,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    responded_at: null
  };

  tickets.push(ticket);
  console.log(`✅ Nuovo ticket #${ticket.id} creato`);

  res.status(201).json({
    success: true,
    ticket: {
      id: ticket.id,
      status: ticket.status,
      created_at: ticket.created_at
    }
  });
});

// Get all tickets
app.get('/api/tickets', (req, res) => {
  const { status, page = 1, limit = 20 } = req.query;
  let filteredTickets = tickets;

  if (status) {
    filteredTickets = tickets.filter(t => t.status === status);
  }

  const offset = (parseInt(page) - 1) * parseInt(limit);
  const paginatedTickets = filteredTickets
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
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

// Get single ticket
app.get('/api/tickets/:id', (req, res) => {
  const ticket = tickets.find(t => t.id === parseInt(req.params.id));
  if (!ticket) {
    return res.status(404).json({ error: 'Ticket non trovato' });
  }
  res.json({ success: true, data: ticket });
});

// Respond to ticket
app.put('/api/tickets/:id/respond', (req, res) => {
  const { response } = req.body;
  const ticket = tickets.find(t => t.id === parseInt(req.params.id));
  
  if (!ticket) {
    return res.status(404).json({ error: 'Ticket non trovato' });
  }

  if (!response) {
    return res.status(400).json({ error: 'Risposta richiesta' });
  }

  ticket.response = response;
  ticket.status = 'resolved';
  ticket.responded_at = new Date().toISOString();
  ticket.updated_at = new Date().toISOString();

  console.log(`✅ Risposta inviata per ticket #${ticket.id}`);

  res.json({ 
    success: true, 
    message: 'Risposta inviata con successo',
    data: ticket 
  });
});

// Update status
app.put('/api/tickets/:id/status', (req, res) => {
  const { status } = req.body;
  const ticket = tickets.find(t => t.id === parseInt(req.params.id));
  
  if (!ticket) {
    return res.status(404).json({ error: 'Ticket non trovato' });
  }

  const validStatuses = ['open', 'in_progress', 'resolved', 'closed'];
  if (!validStatuses.includes(status)) {
    return res.status(400).json({ error: 'Status non valido' });
  }

  ticket.status = status;
  ticket.updated_at = new Date().toISOString();

  res.json({ success: true, data: ticket });
});

// Delete ticket
app.delete('/api/tickets/:id', (req, res) => {
  const index = tickets.findIndex(t => t.id === parseInt(req.params.id));
  if (index === -1) {
    return res.status(404).json({ error: 'Ticket non trovato' });
  }

  tickets.splice(index, 1);
  res.json({ success: true, message: 'Ticket eliminato' });
});

// Get stats
app.get('/api/tickets/admin/stats', (req, res) => {
  const total = tickets.length;
  const open = tickets.filter(t => t.status === 'open').length;
  const resolved = tickets.filter(t => t.status === 'resolved').length;
  const closed = tickets.filter(t => t.status === 'closed').length;
  const today = tickets.filter(t => {
    const ticketDate = new Date(t.created_at);
    const todayDate = new Date();
    return ticketDate.toDateString() === todayDate.toDateString();
  }).length;

  res.json({
    success: true,
    data: { total, open, resolved, closed, today, avg_response_time_hours: 1.5 }
  });
});

// Redirect root to admin
app.get('/', (req, res) => {
  res.redirect('/admin');
});

app.listen(PORT, () => {
  console.log(`🚀 Demo server avviato su porta ${PORT}`);
  console.log(`📊 Admin panel: http://localhost:${PORT}/admin`);
  console.log(`🔗 API base: http://localhost:${PORT}/api`);
  console.log(`\n⚠️  Questo è un server demo con storage in-memory`);
  console.log(`   Per produzione usare il server principale con PostgreSQL`);
});