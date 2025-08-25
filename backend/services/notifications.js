const { Resend } = require('resend');
const twilio = require('twilio');

class NotificationService {
  constructor() {
    // Email service (Resend)
    this.resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;
    
    // WhatsApp service (Twilio)
    this.twilioClient = (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) 
      ? twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN) 
      : null;
    
    this.adminEmail = process.env.ADMIN_EMAIL || 'admin@example.com';
    this.adminPhone = process.env.ADMIN_PHONE; // +393331234567 format
    this.fromEmail = process.env.FROM_EMAIL || 'tickets@yourdomain.com';
    this.twilioWhatsAppNumber = process.env.TWILIO_WHATSAPP_NUMBER; // whatsapp:+14155238886
  }

  async notifyNewTicket(ticket) {
    const notifications = [];
    
    // Send email notification to admin
    if (this.resend && this.adminEmail) {
      notifications.push(this.sendNewTicketEmail(ticket));
    }
    
    // Send WhatsApp notification to admin
    if (this.twilioClient && this.adminPhone && this.twilioWhatsAppNumber) {
      notifications.push(this.sendNewTicketWhatsApp(ticket));
    }
    
    if (notifications.length === 0) {
      console.warn('Nessun servizio di notifica configurato');
      return;
    }
    
    try {
      await Promise.allSettled(notifications);
      console.log(`✅ Notifiche inviate per ticket #${ticket.id}`);
    } catch (err) {
      console.error('Errore invio notifiche:', err);
    }
  }

  async sendResponse(ticket) {
    const notifications = [];
    
    // Send email response to customer
    if (this.resend && ticket.user_email) {
      notifications.push(this.sendResponseEmail(ticket));
    }
    
    // Send WhatsApp response to customer
    if (this.twilioClient && ticket.user_phone && this.twilioWhatsAppNumber) {
      notifications.push(this.sendResponseWhatsApp(ticket));
    }
    
    if (notifications.length === 0) {
      console.warn(`Nessun contatto disponibile per il ticket #${ticket.id}`);
      return;
    }
    
    try {
      await Promise.allSettled(notifications);
      console.log(`✅ Risposta inviata per ticket #${ticket.id}`);
    } catch (err) {
      console.error('Errore invio risposta:', err);
    }
  }

  async sendNewTicketEmail(ticket) {
    try {
      const emailData = {
        from: this.fromEmail,
        to: this.adminEmail,
        subject: `🎫 Nuovo Ticket #${ticket.id} - ${ticket.priority?.toUpperCase() || 'MEDIUM'}`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <div style="background: #f8f9fa; padding: 20px; border-radius: 8px; margin-bottom: 20px;">
              <h2 style="color: #333; margin: 0;">🎫 Nuovo Ticket Ricevuto</h2>
              <p style="color: #666; margin: 5px 0 0 0;">Ticket ID: #${ticket.id}</p>
            </div>
            
            <div style="background: white; padding: 20px; border: 1px solid #e9ecef; border-radius: 8px;">
              <h3 style="color: #333;">Dettagli del Ticket:</h3>
              <table style="width: 100%; border-collapse: collapse;">
                <tr>
                  <td style="padding: 8px 0; font-weight: bold; color: #555;">Priorità:</td>
                  <td style="padding: 8px 0;">${this.getPriorityBadge(ticket.priority)}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; font-weight: bold; color: #555;">Categoria:</td>
                  <td style="padding: 8px 0;">${ticket.category || 'Generale'}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; font-weight: bold; color: #555;">User ID:</td>
                  <td style="padding: 8px 0;">${ticket.user_id || 'Anonimo'}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; font-weight: bold; color: #555;">Email:</td>
                  <td style="padding: 8px 0;">${ticket.user_email || 'Non fornita'}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; font-weight: bold; color: #555;">Telefono:</td>
                  <td style="padding: 8px 0;">${ticket.user_phone || 'Non fornito'}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; font-weight: bold; color: #555;">Data:</td>
                  <td style="padding: 8px 0;">${new Date(ticket.created_at).toLocaleString('it-IT')}</td>
                </tr>
              </table>
              
              <h4 style="color: #333; margin-top: 25px;">Domanda del Cliente:</h4>
              <div style="background: #f8f9fa; padding: 15px; border-radius: 6px; border-left: 4px solid #007bff;">
                ${ticket.question}
              </div>
              
              <div style="margin-top: 30px; padding: 20px; background: #e7f3ff; border-radius: 6px; text-align: center;">
                <p style="margin: 0 0 15px 0; color: #333;">Rispondi al ticket dal pannello admin:</p>
                <a href="${process.env.ADMIN_URL || 'http://localhost:3000/admin'}" 
                   style="display: inline-block; background: #007bff; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold;">
                  Apri Pannello Admin
                </a>
              </div>
            </div>
          </div>
        `
      };
      
      await this.resend.emails.send(emailData);
      console.log('✅ Email notifica inviata all\'admin');
    } catch (err) {
      console.error('❌ Errore invio email admin:', err);
      throw err;
    }
  }

  async sendNewTicketWhatsApp(ticket) {
    try {
      const message = `🎫 *Nuovo Ticket #${ticket.id}*

📝 *Domanda:* ${ticket.question}

👤 *Cliente:* ${ticket.user_id || 'Anonimo'}
📧 *Email:* ${ticket.user_email || 'Non fornita'}
📞 *Tel:* ${ticket.user_phone || 'Non fornito'}
⏰ *Ricevuto:* ${new Date(ticket.created_at).toLocaleString('it-IT')}
🔥 *Priorità:* ${ticket.priority?.toUpperCase() || 'MEDIUM'}

Rispondi dal pannello admin: ${process.env.ADMIN_URL || 'http://localhost:3000/admin'}`;

      await this.twilioClient.messages.create({
        from: this.twilioWhatsAppNumber,
        to: `whatsapp:${this.adminPhone}`,
        body: message
      });
      
      console.log('✅ WhatsApp notifica inviata all\'admin');
    } catch (err) {
      console.error('❌ Errore invio WhatsApp admin:', err);
      throw err;
    }
  }

  async sendResponseEmail(ticket) {
    try {
      const emailData = {
        from: this.fromEmail,
        to: ticket.user_email,
        subject: `✅ Risposta al tuo Ticket #${ticket.id}`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <div style="background: #28a745; color: white; padding: 20px; border-radius: 8px 8px 0 0;">
              <h2 style="margin: 0;">✅ Abbiamo risposto alla tua domanda!</h2>
              <p style="margin: 5px 0 0 0; opacity: 0.9;">Ticket #${ticket.id}</p>
            </div>
            
            <div style="background: white; padding: 20px; border: 1px solid #e9ecef; border-top: none; border-radius: 0 0 8px 8px;">
              <h4 style="color: #333; margin-top: 0;">La tua domanda era:</h4>
              <div style="background: #f8f9fa; padding: 15px; border-radius: 6px; margin-bottom: 20px;">
                ${ticket.question}
              </div>
              
              <h4 style="color: #333;">La nostra risposta:</h4>
              <div style="background: #e7f3ff; padding: 15px; border-radius: 6px; border-left: 4px solid #007bff;">
                ${ticket.response}
              </div>
              
              <div style="margin-top: 25px; padding: 15px; background: #f8f9fa; border-radius: 6px; text-align: center; color: #666;">
                <p style="margin: 0;">Questa risposta è stata utile? Rispondi a questa email per ulteriori chiarimenti.</p>
              </div>
            </div>
          </div>
        `
      };
      
      await this.resend.emails.send(emailData);
      console.log('✅ Email risposta inviata al cliente');
    } catch (err) {
      console.error('❌ Errore invio email cliente:', err);
      throw err;
    }
  }

  async sendResponseWhatsApp(ticket) {
    try {
      const message = `✅ *Risposta al tuo Ticket #${ticket.id}*

❓ *La tua domanda era:*
${ticket.question}

💬 *La nostra risposta:*
${ticket.response}

---
Questa risposta è stata utile? Rispondi a questo messaggio per ulteriori chiarimenti.`;

      await this.twilioClient.messages.create({
        from: this.twilioWhatsAppNumber,
        to: `whatsapp:${ticket.user_phone}`,
        body: message
      });
      
      console.log('✅ WhatsApp risposta inviata al cliente');
    } catch (err) {
      console.error('❌ Errore invio WhatsApp cliente:', err);
      throw err;
    }
  }

  getPriorityBadge(priority) {
    const badges = {
      low: '<span style="background: #28a745; color: white; padding: 4px 8px; border-radius: 4px; font-size: 12px;">BASSA</span>',
      medium: '<span style="background: #ffc107; color: #333; padding: 4px 8px; border-radius: 4px; font-size: 12px;">MEDIA</span>',
      high: '<span style="background: #fd7e14; color: white; padding: 4px 8px; border-radius: 4px; font-size: 12px;">ALTA</span>',
      urgent: '<span style="background: #dc3545; color: white; padding: 4px 8px; border-radius: 4px; font-size: 12px;">URGENTE</span>'
    };
    return badges[priority] || badges.medium;
  }

  // Test connection methods
  async testEmailConnection() {
    if (!this.resend) return { success: false, error: 'Resend non configurato' };
    
    try {
      // Test sending a simple email
      await this.resend.emails.send({
        from: this.fromEmail,
        to: this.adminEmail,
        subject: '🧪 Test Connessione Email',
        html: '<p>Email di test inviata con successo!</p>'
      });
      return { success: true, message: 'Email inviata con successo' };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  async testWhatsAppConnection() {
    if (!this.twilioClient) return { success: false, error: 'Twilio non configurato' };
    
    try {
      await this.twilioClient.messages.create({
        from: this.twilioWhatsAppNumber,
        to: `whatsapp:${this.adminPhone}`,
        body: '🧪 Test connessione WhatsApp - Sistema funzionante!'
      });
      return { success: true, message: 'WhatsApp inviato con successo' };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  // Operator-specific notifications for chat system
  async notifyOperatorTimeout(operatorId, sessionId) {
    try {
      const operator = await this.getOperatorDetails(operatorId);
      const session = await this.getSessionDetails(sessionId);
      
      if (this.resend && operator.email) {
        await this.sendOperatorTimeoutEmail(operator, session);
      }
      
      if (this.twilioClient && operator.phone && this.twilioWhatsAppNumber) {
        await this.sendOperatorTimeoutWhatsApp(operator, session);
      }
      
      console.log(`⚠️ Notifica timeout inviata a operatore ${operatorId}`);
    } catch (err) {
      console.error('Errore notifica timeout operatore:', err);
    }
  }

  async notifyEscalation(ticket, reason) {
    try {
      if (this.resend && this.adminEmail) {
        await this.sendEscalationEmail(ticket, reason);
      }
      
      if (this.twilioClient && this.adminPhone && this.twilioWhatsAppNumber) {
        await this.sendEscalationWhatsApp(ticket, reason);
      }
      
      // Notify customer if contact info available
      if (ticket.user_email || ticket.user_phone) {
        await this.notifyCustomerEscalation(ticket, reason);
      }
      
      console.log(`📤 Notifica escalation inviata per ticket #${ticket.id}`);
    } catch (err) {
      console.error('Errore notifica escalation:', err);
    }
  }

  async sendInactivityReminder(operatorId, sessionId) {
    try {
      const operator = await this.getOperatorDetails(operatorId);
      
      if (this.twilioClient && operator.phone && this.twilioWhatsAppNumber) {
        await this.twilioClient.messages.create({
          from: this.twilioWhatsAppNumber,
          to: `whatsapp:${operator.phone}`,
          body: `💤 *Promemoria Chat Inattiva*\n\nLa chat #${sessionId} è inattiva da più di 10 minuti.\nRispondi al cliente o la chat verrà escalata automaticamente.`
        });
      }
      
    } catch (err) {
      console.error('Errore invio reminder inattività:', err);
    }
  }

  async notifyNewChatToOperators(sessionId) {
    try {
      // Get available operators
      const operators = await this.getAvailableOperators();
      
      for (const operator of operators) {
        if (this.twilioClient && operator.phone && this.twilioWhatsAppNumber) {
          await this.twilioClient.messages.create({
            from: this.twilioWhatsAppNumber,
            to: `whatsapp:${operator.phone}`,
            body: `🔔 *Nuova Chat Disponibile*\n\nChat #${sessionId} in coda.\nAccedi alla dashboard per rispondere.`
          });
        }
      }
      
      console.log(`📢 Notifica nuova chat inviata a ${operators.length} operatori`);
    } catch (err) {
      console.error('Errore notifica nuova chat:', err);
    }
  }

  async sendOperatorTimeoutEmail(operator, session) {
    try {
      const emailData = {
        from: this.fromEmail,
        to: operator.email,
        subject: `⚠️ Timeout Chat #${session.id}`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <div style="background: #fff3cd; padding: 20px; border-radius: 8px; margin-bottom: 20px;">
              <h2 style="color: #856404; margin: 0;">⚠️ Timeout Chat</h2>
              <p style="color: #856404; margin: 5px 0 0 0;">Chat #${session.id}</p>
            </div>
            
            <div style="background: white; padding: 20px; border: 1px solid #e9ecef; border-radius: 8px;">
              <p>Ciao ${operator.name},</p>
              <p>La chat #${session.id} è scaduta per timeout. Il cliente è stato trasferito al sistema di ticket.</p>
              
              <h4>Dettagli Cliente:</h4>
              <ul>
                <li><strong>ID:</strong> ${session.user_id}</li>
                <li><strong>Email:</strong> ${session.user_email || 'Non fornita'}</li>
                <li><strong>Domanda:</strong> ${session.initial_question}</li>
              </ul>
              
              <p style="color: #666; margin-top: 20px;">Per evitare timeout futuri, rispondi entro 5 minuti dall'assegnazione.</p>
            </div>
          </div>
        `
      };
      
      await this.resend.emails.send(emailData);
    } catch (err) {
      console.error('Errore email timeout operatore:', err);
    }
  }

  async sendOperatorTimeoutWhatsApp(operator, session) {
    try {
      const message = `⚠️ *Timeout Chat #${session.id}*\n\nLa chat è scaduta per timeout.\nCliente: ${session.user_id}\nDomanda: ${session.initial_question}\n\n*Ricorda:* Rispondi entro 5 minuti per evitare timeout.`;

      await this.twilioClient.messages.create({
        from: this.twilioWhatsAppNumber,
        to: `whatsapp:${operator.phone}`,
        body: message
      });
    } catch (err) {
      console.error('Errore WhatsApp timeout operatore:', err);
    }
  }

  async sendEscalationEmail(ticket, reason) {
    try {
      const reasonTexts = {
        'operator_timeout': 'Timeout operatore (5 minuti)',
        'queue_timeout': 'Timeout coda (15 minuti)',
        'operator_offline': 'Operatore disconnesso',
        'queue_full': 'Coda troppo piena',
        'system_error': 'Errore di sistema',
        'manual_escalation': 'Escalation manuale'
      };

      const emailData = {
        from: this.fromEmail,
        to: this.adminEmail,
        subject: `🚨 Chat Escalata - Ticket #${ticket.id}`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <div style="background: #f8d7da; padding: 20px; border-radius: 8px; margin-bottom: 20px;">
              <h2 style="color: #721c24; margin: 0;">🚨 Chat Escalata</h2>
              <p style="color: #721c24; margin: 5px 0 0 0;">Ticket #${ticket.id} creato</p>
            </div>
            
            <div style="background: white; padding: 20px; border: 1px solid #e9ecef; border-radius: 8px;">
              <h3>Motivo Escalation:</h3>
              <p style="background: #e7f3ff; padding: 10px; border-radius: 6px; border-left: 4px solid #007bff;">
                ${reasonTexts[reason] || reason}
              </p>
              
              <h4>Dettagli Ticket:</h4>
              <table style="width: 100%; border-collapse: collapse;">
                <tr><td style="padding: 8px 0; font-weight: bold;">Cliente:</td><td>${ticket.user_id || 'Anonimo'}</td></tr>
                <tr><td style="padding: 8px 0; font-weight: bold;">Email:</td><td>${ticket.user_email || 'Non fornita'}</td></tr>
                <tr><td style="padding: 8px 0; font-weight: bold;">Telefono:</td><td>${ticket.user_phone || 'Non fornito'}</td></tr>
                <tr><td style="padding: 8px 0; font-weight: bold;">Priorità:</td><td>${ticket.priority}</td></tr>
              </table>
              
              <h4>Domanda/Chat History:</h4>
              <div style="background: #f8f9fa; padding: 15px; border-radius: 6px; border-left: 4px solid #dc3545;">
                ${ticket.question}
              </div>
              
              <div style="margin-top: 30px; text-align: center;">
                <a href="${process.env.ADMIN_URL || 'http://localhost:3000/admin'}" 
                   style="background: #dc3545; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold;">
                  Gestisci Ticket
                </a>
              </div>
            </div>
          </div>
        `
      };
      
      await this.resend.emails.send(emailData);
    } catch (err) {
      console.error('Errore email escalation:', err);
    }
  }

  async sendEscalationWhatsApp(ticket, reason) {
    try {
      const reasonTexts = {
        'operator_timeout': '⏰ Timeout operatore',
        'queue_timeout': '⏰ Timeout coda',
        'operator_offline': '❌ Operatore offline',
        'queue_full': '👥 Coda piena',
        'system_error': '⚠️ Errore sistema',
        'manual_escalation': '👨‍💼 Escalation manuale'
      };

      const message = `🚨 *Chat Escalata - Ticket #${ticket.id}*\n\n*Motivo:* ${reasonTexts[reason] || reason}\n\n*Cliente:* ${ticket.user_id || 'Anonimo'}\n*Email:* ${ticket.user_email || 'Non fornita'}\n*Tel:* ${ticket.user_phone || 'Non fornito'}\n\n*Domanda:*\n${ticket.question.substring(0, 200)}${ticket.question.length > 200 ? '...' : ''}\n\nGestisci: ${process.env.ADMIN_URL || 'http://localhost:3000/admin'}`;

      await this.twilioClient.messages.create({
        from: this.twilioWhatsAppNumber,
        to: `whatsapp:${this.adminPhone}`,
        body: message
      });
    } catch (err) {
      console.error('Errore WhatsApp escalation:', err);
    }
  }

  async notifyCustomerEscalation(ticket, reason) {
    try {
      const customerMessage = `La tua richiesta è stata convertita nel ticket #${ticket.id}.\n\nRiceverai una risposta dettagliata via email entro 24 ore.\n\nGrazie per la pazienza!`;
      
      // Email al cliente
      if (this.resend && ticket.user_email) {
        await this.resend.emails.send({
          from: this.fromEmail,
          to: ticket.user_email,
          subject: `🎫 Ticket #${ticket.id} Creato - La tua richiesta`,
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
              <div style="background: #007bff; color: white; padding: 20px; border-radius: 8px 8px 0 0;">
                <h2 style="margin: 0;">🎫 Ticket Creato</h2>
                <p style="margin: 5px 0 0 0; opacity: 0.9;">Ticket #${ticket.id}</p>
              </div>
              
              <div style="background: white; padding: 20px; border: 1px solid #e9ecef; border-top: none; border-radius: 0 0 8px 8px;">
                <p>Ciao,</p>
                <p>Non siamo riusciti a metterti in contatto con un operatore in tempo reale, ma abbiamo creato un ticket per la tua richiesta.</p>
                
                <h4>La tua domanda:</h4>
                <div style="background: #f8f9fa; padding: 15px; border-radius: 6px; margin: 15px 0;">
                  ${ticket.question}
                </div>
                
                <p><strong>Cosa succede ora:</strong></p>
                <ul>
                  <li>Un esperto analizzerà la tua richiesta</li>
                  <li>Riceverai una risposta dettagliata entro 24 ore</li>
                  <li>Ti contatteremo via email${ticket.user_phone ? ' o WhatsApp' : ''}</li>
                </ul>
                
                <p style="color: #666; margin-top: 25px;">Grazie per la pazienza!</p>
              </div>
            </div>
          `
        });
      }
      
      // WhatsApp al cliente
      if (this.twilioClient && ticket.user_phone && this.twilioWhatsAppNumber) {
        await this.twilioClient.messages.create({
          from: this.twilioWhatsAppNumber,
          to: `whatsapp:${ticket.user_phone}`,
          body: `🎫 *Ticket #${ticket.id} Creato*\n\n${customerMessage}`
        });
      }
      
    } catch (err) {
      console.error('Errore notifica escalation cliente:', err);
    }
  }

  // Helper methods
  async getOperatorDetails(operatorId) {
    const { pool } = require('../models/database');
    const result = await pool.query('SELECT * FROM operators WHERE id = $1', [operatorId]);
    return result.rows[0] || {};
  }

  async getSessionDetails(sessionId) {
    const { pool } = require('../models/database');
    const result = await pool.query('SELECT * FROM chat_sessions WHERE id = $1', [sessionId]);
    return result.rows[0] || {};
  }

  async getAvailableOperators() {
    const { pool } = require('../models/database');
    const result = await pool.query('SELECT * FROM operators WHERE is_online = true AND status = \'available\'');
    return result.rows || [];
  }
}

module.exports = new NotificationService();