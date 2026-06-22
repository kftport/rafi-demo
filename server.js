require('dotenv').config();
const express = require('express');
const path = require('path');
const cors = require('cors');
const scanHandler = require('./api/scan');

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: false }));

app.use(express.static(path.join(__dirname)));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.post('/api/scan', (req, res, next) => {
  Promise.resolve(scanHandler(req, res)).catch(next);
});

app.use((req, res) => {
  res.status(404).json({ error: 'not_found', message: 'Resource not found' });
});

app.use((err, req, res, next) => {
  console.error(err);
  if (!res.headersSent) {
    res.status(500).json({ error: 'server_error', message: err.message });
  }
});

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
