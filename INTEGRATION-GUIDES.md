# 📋 Guide Integrazione Sistema Chat + Ticket

Guida completa per implementare WhatsApp, deploy su Render e integrazione con chatbot.

---

## 🔧 1. INTEGRAZIONE CHATBOT

### Nel tuo chatbot esistente:

```javascript
// Quando il chatbot non sa rispondere
async function requestHumanOperator(userMessage, userInfo) {
  try {
    const response = await fetch('http://localhost:3001/api/chat/request-operator', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: userInfo.id,
        user_email: userInfo.email,
        user_phone: userInfo.phone,
        question: userMessage,
        priority: 'medium', // low, medium, high, urgent
        metadata: {
          source: 'chatbot',
          session_id: userInfo.session_id,
          timestamp: new Date().toISOString()
        }
      })
    });

    const result = await response.json();
    
    if (result.success) {
      switch (result.type) {
        case 'queue':
          return {
            message: `Sei in posizione ${result.position} nella coda. Tempo stimato: ${result.estimated_wait} minuti.`,
            chat_url: `${process.env.CHAT_URL}/admin/customer-chat.html?session=${result.session_id}`
          };
          
        case 'operator_assigned':
          return {
            message: 'Un operatore ti sta contattando...',
            chat_url: `${process.env.CHAT_URL}/admin/customer-chat.html?session=${result.session_id}`
          };
          
        case 'ticket_created':
          return {
            message: `Ho creato il ticket #${result.ticket_id}. Riceverai risposta via email/WhatsApp entro 24h.`
          };
          
        default:
          return {
            message: result.message || 'Servizio momentaneamente non disponibile.'
          };
      }
    }
  } catch (err) {
    console.error('Errore richiesta operatore:', err);
    return {
      message: 'Errore di connessione. Riprova più tardi.'
    };
  }
}
```

### Esempio integrazione completa:

```javascript
// main-chatbot.js
class MainChatbot {
  constructor() {
    this.knowledgeBase = new KnowledgeBase();
    this.humanEscalation = new HumanEscalation();
  }

  async processMessage(userMessage, userContext) {
    // 1. Prova risposta automatica
    const autoResponse = await this.knowledgeBase.findAnswer(userMessage);
    
    if (autoResponse.confidence > 0.8) {
      return autoResponse;
    }
    
    // 2. Confidence bassa o risposta non trovata
    if (autoResponse.confidence < 0.3) {
      // Escalation immediata
      return await this.humanEscalation.requestHumanOperator(userMessage, userContext);
    }
    
    // 3. Confidence media - offri opzioni
    return {
      message: autoResponse.message,
      actions: [
        {
          type: 'quick_reply',
          label: '✅ Risolto',
          payload: 'resolved'
        },
        {
          type: 'quick_reply', 
          label: '💬 Parla con operatore',
          payload: 'escalate_human'
        }
      ]
    };
  }
}
```

---

## 📱 2. INTEGRAZIONE WHATSAPP

### Configurazione Twilio:

1. **Registrazione Twilio**:
   ```
   https://www.twilio.com/console
   - Crea account
   - Verifica numero di telefono
   - Ottieni Account SID e Auth Token
   ```

2. **Attivazione WhatsApp Business**:
   ```
   https://console.twilio.com/develop/sms/try-it-out/whatsapp-learn
   - Richiedi accesso WhatsApp Business API
   - Configura Webhook URL: https://your-app.onrender.com/webhooks/whatsapp
   - Approva template messages
   ```

3. **Variabili ambiente**:
   ```env
   # WhatsApp Twilio
   TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxx
   TWILIO_AUTH_TOKEN=xxxxxxxxxxxxxxxxx
   TWILIO_WHATSAPP_NUMBER=whatsapp:+14155238886
   ADMIN_PHONE=+393331234567
   ```

### Test WhatsApp:

```javascript
// test-whatsapp.js
const twilio = require('twilio');

const client = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

async function testWhatsApp() {
  try {
    const message = await client.messages.create({
      from: 'whatsapp:+14155238886',
      to: 'whatsapp:+393331234567',
      body: '🧪 Test WhatsApp - Sistema funzionante!'
    });
    
    console.log('✅ WhatsApp inviato:', message.sid);
  } catch (err) {
    console.error('❌ Errore WhatsApp:', err);
  }
}

testWhatsApp();
```

### Webhook WhatsApp (opzionale):

```javascript
// routes/webhooks.js
router.post('/whatsapp', (req, res) => {
  const { Body, From, MessageSid } = req.body;
  
  console.log('WhatsApp ricevuto:', {
    from: From,
    body: Body,
    sid: MessageSid
  });
  
  // Processa messaggio WhatsApp in arrivo
  // Può essere usato per chat bidirezionale
  
  res.status(200).send('OK');
});
```

---

## 🚀 3. DEPLOY SU RENDER

### Preparazione Deploy:

1. **File di configurazione** (`render.yaml`):
   ```yaml
   services:
     - type: web
       name: ticket-system
       env: node
       buildCommand: npm install
       startCommand: npm start
       envVars:
         - key: NODE_ENV
           value: production
         - key: DATABASE_URL
           fromDatabase:
             name: ticket-system-db
             property: connectionString
         # Email (Resend)
         - key: RESEND_API_KEY
           sync: false
         - key: ADMIN_EMAIL
           sync: false
         - key: FROM_EMAIL
           sync: false
         # WhatsApp (Twilio)
         - key: TWILIO_ACCOUNT_SID
           sync: false
         - key: TWILIO_AUTH_TOKEN
           sync: false
         - key: TWILIO_WHATSAPP_NUMBER
           sync: false
         - key: ADMIN_PHONE
           sync: false
         # URLs
         - key: ADMIN_URL
           generateValue: https://${{RENDER_SERVICE_NAME}}.onrender.com/admin
         - key: CHAT_URL
           generateValue: https://${{RENDER_SERVICE_NAME}}.onrender.com
         - key: ALLOWED_ORIGINS
           generateValue: https://${{RENDER_SERVICE_NAME}}.onrender.com

   databases:
     - name: ticket-system-db
       databaseName: tickets
       user: tickets_user
   ```

2. **Commit su Git**:
   ```bash
   git init
   git add .
   git commit -m "Sistema chat + ticket completo"
   git remote add origin https://github.com/yourusername/ticket-system.git
   git push -u origin main
   ```

### Deploy su Render:

1. **Collegamento Repository**:
   ```
   1. Vai su https://dashboard.render.com
   2. New → Web Service
   3. Connect Repository → seleziona il tuo repo
   4. Render leggerà automaticamente render.yaml
   ```

2. **Configurazione Variabili**:
   ```
   Dashboard Render → Service → Environment
   
   Configura:
   - RESEND_API_KEY (da resend.com)
   - ADMIN_EMAIL (tua email)
   - FROM_EMAIL (email mittente)
   - TWILIO_ACCOUNT_SID (da twilio.com)
   - TWILIO_AUTH_TOKEN (da twilio.com)
   - TWILIO_WHATSAPP_NUMBER (whatsapp:+14155238886)
   - ADMIN_PHONE (tuo numero con +39)
   ```

3. **Deploy**:
   ```
   Render deploierà automaticamente:
   ✅ Web Service Node.js
   ✅ Database PostgreSQL
   ✅ SSL Certificate
   ✅ Custom Domain (opzionale)
   ```

### Verifica Deploy:

```bash
# Test endpoint principali
curl https://your-app.onrender.com/health
curl https://your-app.onrender.com/api/tickets/admin/stats
curl https://your-app.onrender.com/api/chat/health
```

---

## 📧 4. CONFIGURAZIONE EMAIL (RESEND)

### Setup Resend:

1. **Registrazione**:
   ```
   https://resend.com
   - Crea account
   - Verifica email
   - Aggiungi dominio (opzionale)
   ```

2. **API Key**:
   ```
   Dashboard → API Keys → Create
   - Copia API key
   - Aggiungi a variabili ambiente
   ```

3. **Test Email**:
   ```javascript
   const { Resend } = require('resend');
   const resend = new Resend('re_123456789');

   await resend.emails.send({
     from: 'tickets@yourdomain.com',
     to: 'admin@yourdomain.com',
     subject: 'Test Email Sistema Ticket',
     html: '<h1>Email funzionante!</h1>'
   });
   ```

### Configurazione Dominio (Opzionale):

```
1. Dashboard Resend → Domains → Add Domain
2. Aggiungi record DNS:
   - MX record per ricezione
   - SPF, DKIM record per autenticazione
3. Verifica configurazione
4. Usa email personalizzata: tickets@tuodominio.com
```

---

## 🧪 5. TEST COMPLETO DEL WORKFLOW

### Test Manuale:

```bash
# 1. Avvia server
npm start

# 2. Crea operatore di test
curl -X POST http://localhost:3001/api/chat/operators \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Test Operator",
    "email": "operator@test.com",
    "phone": "+393331234567",
    "role": "operator"
  }'

# 3. Test richiesta chat
curl -X POST http://localhost:3001/api/chat/request-operator \
  -H "Content-Type: application/json" \
  -d '{
    "user_id": "test_user",
    "user_email": "user@test.com", 
    "user_phone": "+393337654321",
    "question": "Ho bisogno di aiuto con il mio account",
    "priority": "medium"
  }'

# 4. Test notifiche
curl -X POST http://localhost:3001/api/tickets \
  -H "Content-Type: application/json" \
  -d '{
    "user_email": "test@example.com",
    "question": "Test notifica email/WhatsApp"
  }'
```

### Test Automatizzato:

```javascript
// test-workflow.js
const axios = require('axios');

class WorkflowTester {
  constructor(baseUrl = 'http://localhost:3001') {
    this.baseUrl = baseUrl;
  }

  async testCompleteWorkflow() {
    console.log('🧪 Avvio test workflow completo...');
    
    // 1. Test creazione operatore
    const operator = await this.createTestOperator();
    console.log('✅ Operatore creato:', operator.data.id);
    
    // 2. Test richiesta chat (senza operatori online = ticket)
    const chatRequest = await this.requestChat();
    console.log('✅ Richiesta chat:', chatRequest.type);
    
    // 3. Test statistiche
    const stats = await this.getSystemStats();
    console.log('✅ Statistiche sistema:', stats);
    
    // 4. Test health check
    const health = await this.healthCheck();
    console.log('✅ Health check:', health.status);
    
    console.log('🎉 Test workflow completato!');
  }

  async createTestOperator() {
    return await axios.post(`${this.baseUrl}/api/chat/operators`, {
      name: 'Test Operator',
      email: `operator${Date.now()}@test.com`,
      phone: '+393331234567'
    });
  }

  async requestChat() {
    const response = await axios.post(`${this.baseUrl}/api/chat/request-operator`, {
      user_id: 'test_user_' + Date.now(),
      user_email: 'user@test.com',
      question: 'Test domanda workflow'
    });
    return response.data;
  }

  async getSystemStats() {
    const response = await axios.get(`${this.baseUrl}/api/chat/stats`);
    return response.data.data;
  }

  async healthCheck() {
    const response = await axios.get(`${this.baseUrl}/api/chat/health`);
    return response.data;
  }
}

// Esegui test
new WorkflowTester().testCompleteWorkflow();
```

---

## 🔧 6. URL E INTERFACCE

### URL Principali:

```
🏠 Homepage: https://your-app.onrender.com/
📊 Admin Panel: https://your-app.onrender.com/admin/
💬 Operator Dashboard: https://your-app.onrender.com/admin/operator-dashboard.html
👤 Customer Chat: https://your-app.onrender.com/admin/customer-chat.html

🔗 API Endpoints:
- /api/tickets/* (gestione ticket)
- /api/chat/* (gestione chat)
- /health (health check)
```

### Integrazione nel tuo sito:

```html
<!-- Pulsante "Parla con operatore" nel tuo chatbot -->
<button onclick="openLiveChat()">
  💬 Parla con un Operatore
</button>

<script>
function openLiveChat() {
  const chatWindow = window.open(
    'https://your-app.onrender.com/admin/customer-chat.html?email=' + 
    encodeURIComponent(userEmail) + 
    '&question=' + encodeURIComponent(lastMessage),
    'chat',
    'width=400,height=600,scrollbars=no,resizable=no'
  );
}
</script>
```

---

## 📈 7. MONITORAGGIO E MANUTENZIONE

### Monitoring URLs:

```bash
# Health checks
curl https://your-app.onrender.com/health
curl https://your-app.onrender.com/api/chat/health

# Statistiche sistema
curl https://your-app.onrender.com/api/chat/stats
curl https://your-app.onrender.com/api/tickets/admin/stats
```

### Log e Debug:

```javascript
// Nel codice produzione, aggiungi logging
console.log('📊 Sistema Stats:', await getSystemStats());
console.log('⚡ Escalation Rules:', await getEscalationRules());
console.log('👥 Operatori Online:', await getAvailableOperators());
```

### Backup Automatico:

Render fa backup automatici del database PostgreSQL. Per backup custom:

```bash
# Export database (locale)
pg_dump $DATABASE_URL > backup.sql

# Import database
psql $DATABASE_URL < backup.sql
```

---

Il sistema è **completo e production-ready**! Segui queste guide per una implementazione rapida e funzionale. 🚀