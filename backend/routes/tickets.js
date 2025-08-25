const express = require('express');
const router = express.Router();
const Ticket = require('../models/ticket');
const { initDatabase } = require('../models/database');
const notificationService = require('../services/notifications');

// Initialize database on first request
let dbInitialized = false;
router.use(async (req, res, next) => {
  if (!dbInitialized) {
    try {
      await initDatabase();
      dbInitialized = true;
    } catch (err) {
      return res.status(500).json({ error: 'Errore inizializzazione database' });
    }
  }
  next();
});

// Create new ticket (called by chatbot when no answer found)
router.post('/', async (req, res) => {
  try {
    const { user_id, user_email, user_phone, question, priority, category, metadata } = req.body;
    
    if (!question) {
      return res.status(400).json({ error: 'Domanda richiesta' });
    }

    const ticket = await Ticket.create({
      user_id,
      user_email,
      user_phone,
      question,
      priority,
      category,
      metadata
    });

    // Send notification to admin
    try {
      await notificationService.notifyNewTicket(ticket);
    } catch (notifErr) {
      console.error('Errore invio notifica:', notifErr);
      // Don't fail the request if notification fails
    }

    res.status(201).json({
      success: true,
      ticket: {
        id: ticket.id,
        status: ticket.status,
        created_at: ticket.created_at
      }
    });
  } catch (err) {
    console.error('Errore creazione ticket:', err);
    res.status(500).json({ error: 'Errore interno del server' });
  }
});

// Get all tickets (for admin panel)
router.get('/', async (req, res) => {
  try {
    const { status, page = 1, limit = 20, sort = 'created_at', order = 'desc' } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);
    
    const result = await Ticket.findAll({
      status,
      limit: parseInt(limit),
      offset,
      orderBy: sort,
      order: order.toUpperCase()
    });

    res.json({
      success: true,
      data: result.tickets,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: result.total,
        pages: Math.ceil(result.total / parseInt(limit)),
        hasMore: result.hasMore
      }
    });
  } catch (err) {
    console.error('Errore recupero tickets:', err);
    res.status(500).json({ error: 'Errore interno del server' });
  }
});

// Get single ticket
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const ticket = await Ticket.findById(id);
    
    if (!ticket) {
      return res.status(404).json({ error: 'Ticket non trovato' });
    }

    res.json({ success: true, data: ticket });
  } catch (err) {
    console.error('Errore recupero ticket:', err);
    res.status(500).json({ error: 'Errore interno del server' });
  }
});

// Respond to ticket
router.put('/:id/respond', async (req, res) => {
  try {
    const { id } = req.params;
    const { response, admin_id = 'admin' } = req.body;
    
    if (!response) {
      return res.status(400).json({ error: 'Risposta richiesta' });
    }

    const ticket = await Ticket.findById(id);
    if (!ticket) {
      return res.status(404).json({ error: 'Ticket non trovato' });
    }

    const updatedTicket = await Ticket.updateResponse(id, response, admin_id);

    // Send response to customer
    try {
      await notificationService.sendResponse(updatedTicket);
    } catch (notifErr) {
      console.error('Errore invio risposta:', notifErr);
      // Don't fail the request if notification fails
    }

    res.json({ 
      success: true, 
      message: 'Risposta inviata con successo',
      data: updatedTicket 
    });
  } catch (err) {
    console.error('Errore risposta ticket:', err);
    res.status(500).json({ error: 'Errore interno del server' });
  }
});

// Update ticket status
router.put('/:id/status', async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    
    const validStatuses = ['open', 'in_progress', 'resolved', 'closed'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: 'Status non valido' });
    }

    const ticket = await Ticket.updateStatus(id, status);
    if (!ticket) {
      return res.status(404).json({ error: 'Ticket non trovato' });
    }

    res.json({ success: true, data: ticket });
  } catch (err) {
    console.error('Errore aggiornamento status:', err);
    res.status(500).json({ error: 'Errore interno del server' });
  }
});

// Delete ticket
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const ticket = await Ticket.delete(id);
    
    if (!ticket) {
      return res.status(404).json({ error: 'Ticket non trovato' });
    }

    res.json({ success: true, message: 'Ticket eliminato' });
  } catch (err) {
    console.error('Errore eliminazione ticket:', err);
    res.status(500).json({ error: 'Errore interno del server' });
  }
});

// Get tickets statistics
router.get('/admin/stats', async (req, res) => {
  try {
    const stats = await Ticket.getStats();
    res.json({ success: true, data: stats });
  } catch (err) {
    console.error('Errore statistiche:', err);
    res.status(500).json({ error: 'Errore interno del server' });
  }
});

module.exports = router;