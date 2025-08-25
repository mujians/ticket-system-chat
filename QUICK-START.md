# ⚡ QUICK START - Deploy in 3 comandi

## 🚀 Deploy immediato su Render:

### 1. Git Setup
```bash
cd /Users/brnobtt/ticket-system
git init && git add . && git commit -m "Deploy ready"
```

### 2. GitHub Push
```bash
# Crea repo su: https://github.com/new (nome: ticket-system-chat)
git remote add origin https://github.com/TUOUSERNAME/ticket-system-chat.git
git branch -M main && git push -u origin main
```

### 3. Render Deploy
```
https://dashboard.render.com
→ New + → Web Service → Connect repo → Deploy
```

## 🔗 URL Risultanti:
- **Chat**: `https://tuo-app.onrender.com/chat`
- **Operatori**: `https://tuo-app.onrender.com/operator` 
- **Admin**: `https://tuo-app.onrender.com/admin`

## 🤖 Integrazione Chatbot:
```javascript
const response = await fetch('https://tuo-app.onrender.com/api/chat/request-operator', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    user_id: userId,
    question: userMessage
  })
});
```

**Done! Sistema online in 5 minuti** ✅