# 🎫 Sistema di Gestione Tickets

Sistema di ticketing integrato con chatbot per la gestione automatica di richieste clienti con notifiche email e WhatsApp.

## ✨ Caratteristiche

- **API REST** per la gestione dei tickets
- **Pannello Admin** web-based per rispondere ai tickets
- **Notifiche Email** automatiche tramite Resend
- **Notifiche WhatsApp** tramite Twilio
- **Database PostgreSQL** per persistenza dati
- **Deploy facile** su Render.com
- **Interfaccia responsive** ottimizzata per mobile

## 🚀 Quick Start

### 1. Installazione locale

```bash
# Clona il repository
git clone <your-repo-url>
cd ticket-system

# Installa le dipendenze
npm install

# Copia e configura le variabili d'ambiente
cp .env.example .env
# Modifica .env con le tue configurazioni

# Avvia il server
npm run dev
```

### 2. Configurazione servizi

#### Resend (Email)
1. Registrati su [resend.com](https://resend.com)
2. Ottieni la tua API key
3. Configura il dominio per l'invio email
4. Aggiungi `RESEND_API_KEY` al file .env

#### Twilio (WhatsApp)
1. Registrati su [twilio.com](https://twilio.com)
2. Attiva WhatsApp Business API
3. Ottieni Account SID e Auth Token
4. Configura il numero WhatsApp
5. Aggiungi le credenziali al file .env

### 3. Deploy su Render

1. Fai commit del codice su Git
2. Connetti il repository a [render.com](https://render.com)
3. Il file `render.yaml` configurerà automaticamente:
   - Web Service Node.js
   - Database PostgreSQL
   - Variabili d'ambiente

## 📚 API Endpoints

### Tickets

```
POST   /api/tickets              # Crea nuovo ticket
GET    /api/tickets              # Lista tickets con filtri
GET    /api/tickets/:id          # Dettagli ticket
PUT    /api/tickets/:id/respond  # Rispondi al ticket
PUT    /api/tickets/:id/status   # Aggiorna status
DELETE /api/tickets/:id          # Elimina ticket
GET    /api/tickets/admin/stats  # Statistiche
```

### Esempio creazione ticket dal chatbot

```javascript
// Quando il chatbot non sa rispondere
const createTicket = async (userQuestion, userInfo) => {
  const response = await fetch('/api/tickets', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      user_id: userInfo.id,
      user_email: userInfo.email,
      user_phone: userInfo.phone,
      question: userQuestion,
      priority: 'medium',
      category: 'chatbot'
    })
  });
  
  return response.json();
};
```

## 🎛️ Pannello Admin

Accedi al pannello admin su `/admin` per:

- ✅ Visualizzare tutti i tickets
- 📊 Vedere statistiche in tempo reale
- 🔍 Filtrare per status, priorità, data
- 💬 Rispondere ai tickets
- 📧 Invio automatico notifiche ai clienti
- 🗑️ Gestire il ciclo di vita dei tickets

## 🔧 Integrazione con Chatbot

Nel tuo chatbot, quando non trovi una risposta:

```javascript
// Esempio di integrazione
if (!botResponse) {
  // Crea ticket
  const ticket = await createTicket(userMessage, userInfo);
  
  // Rispondi all'utente
  return {
    message: `Non ho trovato una risposta immediata. Ho creato un ticket #${ticket.data.id} per te. Riceverai una risposta via email/WhatsApp entro 24h.`,
    ticketId: ticket.data.id
  };
}
```

## 🔐 Variabili d'Ambiente

### Database
- `DATABASE_URL`: URL connessione PostgreSQL

### Email (Resend)
- `RESEND_API_KEY`: API key Resend
- `ADMIN_EMAIL`: Email admin per notifiche
- `FROM_EMAIL`: Email mittente

### WhatsApp (Twilio)
- `TWILIO_ACCOUNT_SID`: Account SID Twilio
- `TWILIO_AUTH_TOKEN`: Auth Token Twilio
- `TWILIO_WHATSAPP_NUMBER`: Numero WhatsApp (es: whatsapp:+14155238886)
- `ADMIN_PHONE`: Telefono admin (es: +393331234567)

### Applicazione
- `NODE_ENV`: production/development
- `PORT`: Porta server (default: 3000)
- `ADMIN_URL`: URL pannello admin
- `ALLOWED_ORIGINS`: Domini consentiti CORS

## 📱 Flusso di Lavoro

1. **Cliente fa domanda** → Chatbot non sa rispondere
2. **Sistema crea ticket** → Salva nel database
3. **Admin riceve notifica** → Via email e WhatsApp
4. **Admin risponde** → Tramite pannello web
5. **Cliente riceve risposta** → Via email e/o WhatsApp
6. **Ticket chiuso** → Sistema aggiorna statistiche

## 🧪 Test

```bash
# Test locale
npm run dev
# Vai su http://localhost:3000/admin
# Usa il pulsante "Test Notifiche" per verificare

# Test API
curl -X POST http://localhost:3000/api/tickets \
  -H "Content-Type: application/json" \
  -d '{"question":"Test domanda","user_email":"test@example.com"}'
```

## 📊 Monitoraggio

Il sistema traccia automaticamente:
- ⏱️ Tempi di risposta medi
- 📈 Numero di tickets per giorno
- 🏷️ Categorie più frequenti
- 👥 Utenti più attivi

## 🔒 Sicurezza

- Rate limiting sulle API
- Helmet.js per sicurezza headers
- Validazione input
- CORS configurabile
- Variabili d'ambiente protette

## 🛠️ Personalizzazioni

- Modifica `backend/admin/index.html` per il design
- Estendi il modello `Ticket` per nuovi campi
- Aggiungi nuovi canali di notifica
- Personalizza i template email/WhatsApp

## 📞 Supporto

Per supporto e domande:
- 📧 Email: [tua-email]
- 💬 WhatsApp: [tuo-numero]
- 🐛 Issues: [repository-issues-url]