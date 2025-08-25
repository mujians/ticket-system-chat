const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
require('dotenv').config();

const ticketRoutes = require('./routes/tickets');
const chatRoutes = require('./routes/chat');
const WebSocketService = require('./services/websocket');
const http = require('http');

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 3000;

// Initialize WebSocket service
const wsService = new WebSocketService(server);

// Security middleware
app.use(helmet());
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:3000'],
  credentials: true
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: 'Troppi tentativi, riprova più tardi'
});
app.use('/api/', limiter);

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Serve static files for admin panel
app.use('/admin', express.static(path.join(__dirname, 'admin')));

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development'
  });
});

// API routes
app.use('/api/tickets', ticketRoutes);
app.use('/api/chat', chatRoutes);

// Admin panel route
app.get('/', (req, res) => {
  res.redirect('/admin');
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({ error: 'Endpoint non trovato' });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(err.status || 500).json({ 
    error: process.env.NODE_ENV === 'production' 
      ? 'Errore interno del server' 
      : err.message 
  });
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('Server shutting down gracefully...');
  process.exit(0);
});

server.listen(PORT, () => {
  console.log(`🚀 Server avviato su porta ${PORT}`);
  console.log(`📊 Admin panel: http://localhost:${PORT}/admin`);
  console.log(`💬 Operator dashboard: http://localhost:${PORT}/admin/operator-dashboard.html`);
  console.log(`👤 Customer chat: http://localhost:${PORT}/admin/customer-chat.html`);
  console.log(`🔗 API base: http://localhost:${PORT}/api`);
  console.log(`🔌 WebSocket server: Running`);
});

module.exports = app;