# 🚀 Rafi-Demo Deployment Guide v2.0

## ⚡ QUICK START

### 1. Setup Environment
```bash
# Copy the template
cp .env.example .env

# Edit and add your API key
nano .env
# ANTHROPIC_API_KEY=sk-ant-xxxxx...
```

### 2. Install Dependencies
```bash
npm install
# Required: https, dotenv, express (if using full server)
```

### 3. Start Development Server
```bash
# If using Vercel (recommended for Serverless)
vercel dev

# If using Node.js locally
node server.js
```

### 4. Deploy
```bash
# Vercel (recommended)
vercel --prod

# Or Docker
docker build -t rafi-demo .
docker run -e ANTHROPIC_API_KEY=sk-ant-xxxxx -p 3000:3000 rafi-demo
```

---

## 🔧 SETUP VARIATIONS

### Option A: Vercel Serverless (RECOMMENDED)
**Advantages:** Free tier, no server maintenance, auto-scaling
```bash
npm i -g vercel
vercel login
vercel
```

**vercel.json:**
```json
{
  "functions": {
    "api/scan.js": {
      "memory": 1024,
      "maxDuration": 30
    }
  }
}
```

### Option B: Node.js Express Server
**Advantages:** Full control, local testing
```bash
npm install express cors dotenv
node server.js
```

See `server.js` example at the end of this guide.

### Option C: Docker
**Advantages:** Portable, production-grade
```bash
docker build -t rafi-demo .
docker run -e ANTHROPIC_API_KEY=sk-ant-xxxxx -p 3000:3000 rafi-demo
```

---

## 🐛 TROUBLESHOOTING

### ❌ Error: "ANTHROPIC_API_KEY is not set"
**Problem:** Environment variable not loaded  
**Solution:**
```bash
# 1. Check .env file exists
ls -la .env

# 2. Verify it has the key
cat .env | grep ANTHROPIC_API_KEY

# 3. Reload environment
source .env

# 4. Test
echo $ANTHROPIC_API_KEY
```

### ❌ Error: "Unauthorized access" (403)
**Problem:** Invalid token  
**Solution:**
```bash
# Check if k=demo123 is in the URL
# OR set custom tokens in .env
API_TOKENS=demo123,my_custom_token
```

### ❌ Error: "API Error 401" from Anthropic
**Problem:** API key is invalid or expired  
**Solution:**
```bash
# 1. Check key format (should start with sk-ant-)
# 2. Go to https://console.anthropic.com
# 3. Create a new API key
# 4. Update .env
# 5. Restart server
```

### ❌ Error: "Image too large (max 5MB)"
**Problem:** User uploaded huge image  
**Solution:** This is correct behavior - images > 5MB are rejected

### ❌ Error: "Failed to parse Claude response"
**Problem:** Claude returned invalid JSON  
**Solution:**
```bash
# 1. Check if image is a valid invoice (not a photo of a cat)
# 2. Try a cleaner, well-lit invoice photo
# 3. Check API logs for full response:
NODE_ENV=development npm start
```

### ❌ Error: "Timeout" on `/api/scan`
**Problem:** Anthropic API is slow or not responding  
**Solution:**
```bash
# Increase timeout in scan.js
timeout: 60000 // 60 seconds instead of 30

# OR check Anthropic status:
curl https://api.anthropic.com/
```

### ❌ Frontend shows "network error"
**Problem:** CORS issue  
**Solution:**
```bash
# Check if API response has correct headers
# In server.js, add:
app.use(cors({
    origin: process.env.CORS_ORIGIN || '*',
    methods: ['GET', 'POST', 'OPTIONS']
}));
```

### ❌ localStorage not persisting
**Problem:** Private browsing or localStorage disabled  
**Solution:** This is expected - no server-side persistence yet

---

## 📊 MONITORING & LOGGING

### Enable Debug Logs
```bash
# In .env
NODE_ENV=development

# Server will log:
# - API requests/responses
# - Parse errors
# - Line item mismatches
```

### Check API Rate Limits
```bash
# Anthropic API: Check headers
curl -i https://api.anthropic.com/v1/messages \
  -H "X-API-Key: sk-ant-xxxxx" \
  -H "Content-Type: application/json"
```

### Monitor Storage (if using SQLite later)
```bash
# View database
sqlite3 rafi.db ".schema"
sqlite3 rafi.db "SELECT COUNT(*) FROM demos;"
```

---

## 🔐 SECURITY CHECKLIST

- [ ] API key is NOT committed to git
- [ ] .env is in .gitignore
- [ ] Using environment variables, not hardcoded values
- [ ] API tokens validated on every request
- [ ] Image size limited to 5MB
- [ ] Input validation on all fields
- [ ] CORS configured for your domain only
- [ ] HTTPS enabled on production
- [ ] Rate limiting enabled
- [ ] No sensitive data logged

---

## 📈 PERFORMANCE OPTIMIZATION

### Image Optimization
```javascript
// Current: 2400px max width, JPEG quality 0.92
// Tweak for faster processing:
const MAX_WIDTH = 1600;  // Faster, still readable
const JPEG_QUALITY = 0.85; // Faster, minimal quality loss
```

### API Model Selection
```javascript
// Current: Haiku for speed, Opus for retries
// Options:
- Haiku 4.5: Fastest, good for simple invoices
- Sonnet 4.5: Balanced, better accuracy
- Opus 4.1: Slowest, best accuracy (use only for retries)
```

### Caching
```javascript
// Add Redis caching for repeated requests:
const cache = new Map();
const cacheKey = md5(imageBase64);
if (cache.has(cacheKey)) return cache.get(cacheKey);
```

---

## 📝 EXAMPLE: Full Express Server

Save as `server.js`:

```javascript
const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const scanHandler = require('./api/scan');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors({ origin: process.env.CORS_ORIGIN || '*' }));
app.use(express.json({ limit: '10mb' }));
app.use(express.static('public'));

// Routes
app.post('/api/scan', (req, res) => scanHandler(req, res));

app.get('/', (req, res) => {
    res.sendFile(__dirname + '/index.html');
});

app.get('/health', (req, res) => {
    res.json({ status: 'ok', apiKey: process.env.ANTHROPIC_API_KEY ? 'set' : 'missing' });
});

// Error handler
app.use((err, req, res, next) => {
    console.error('Server error:', err);
    res.status(500).json({ error: 'internal_server_error', message: err.message });
});

app.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
    if (!process.env.ANTHROPIC_API_KEY) {
        console.error('❌ ANTHROPIC_API_KEY not set!');
        process.exit(1);
    }
});
```

---

## 🐳 Example: Dockerfile

Save as `Dockerfile`:

```dockerfile
FROM node:18-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY . .

ENV NODE_ENV=production
EXPOSE 3000

CMD ["node", "server.js"]
```

Build and run:
```bash
docker build -t rafi-demo .
docker run -e ANTHROPIC_API_KEY=sk-ant-xxxxx -p 3000:3000 rafi-demo
```

---

## 🧪 TESTING

### Manual Test
```bash
# 1. Start server
npm start

# 2. Go to http://localhost:3000

# 3. Upload a test invoice image

# 4. Check console for logs
```

### API Test with curl
```bash
# Get a base64 image first
base64 invoice.jpg | tr -d '\n' > image_base64.txt

# Send to API
curl -X POST http://localhost:3000/api/scan?k=demo123 \
  -H "Content-Type: application/json" \
  -d @- << EOF
{
  "imageBase64": "$(cat image_base64.txt)",
  "mediaType": "image/jpeg"
}
EOF
```

---

## 📞 SUPPORT

If something doesn't work:

1. Check error message in browser console (F12)
2. Check server logs: `NODE_ENV=development npm start`
3. Verify API key: `echo $ANTHROPIC_API_KEY`
4. Check network tab in DevTools
5. Try different invoice image
6. Open issue on GitHub with logs

---

## 🔄 UPDATES

To update to the latest version:

```bash
git pull origin main
npm install
# Update your .env if needed
npm start
```

