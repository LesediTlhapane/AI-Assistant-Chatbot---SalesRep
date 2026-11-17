import express from 'express';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { generateChatResponse, getGroqReadiness } from './server/groqAssistant.js';

dotenv.config();
dotenv.config({ path: '.env.local', override: true });

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const DEFAULT_PORT = parseInt(process.env.PORT || '3001', 10);
const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use(express.json({ limit: '1mb' }));

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (!origin) {
    res.setHeader('Access-Control-Allow-Origin', '*');
  } else if (
    allowedOrigins.length === 0
    || allowedOrigins.includes(origin)
    || origin.includes('localhost')
    || origin.includes('127.0.0.1')
  ) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  } else {
    res.setHeader('Access-Control-Allow-Origin', allowedOrigins[0] || origin);
  }

  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

const requestCounts = new Map();
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const MAX_REQUESTS_PER_WINDOW = 60;

function checkRateLimit(ip) {
  const now = Date.now();
  const record = requestCounts.get(ip) || { count: 0, resetTime: now + RATE_LIMIT_WINDOW_MS };
  if (now > record.resetTime) {
    requestCounts.set(ip, { count: 1, resetTime: now + RATE_LIMIT_WINDOW_MS });
    return true;
  }
  if (record.count >= MAX_REQUESTS_PER_WINDOW) return false;
  record.count += 1;
  requestCounts.set(ip, record);
  return true;
}

app.get('/api/health', (req, res) => {
  res.json({
    status: 'online',
    assistant: 'Sales Representative AI Assistant',
    ...getGroqReadiness()
  });
});

app.post('/api/chat', async (req, res) => {
  const clientIp = req.ip || req.headers['x-forwarded-for'] || 'anonymous';
  if (!checkRateLimit(String(clientIp))) {
    return res.status(429).json({
      success: false,
      error: "You're sending requests too quickly. Please wait a moment and try again."
    });
  }

  const result = await generateChatResponse(req.body);
  return res.status(result.status).json(result.body);
});

app.use(express.static(path.join(__dirname, 'dist')));

app.get('*', (req, res) => {
  const indexPath = path.join(__dirname, 'dist', 'index.html');
  if (req.accepts('html')) return res.sendFile(indexPath);
  return res.status(404).json({ error: 'Not found' });
});

function startServer(port) {
  const server = app.listen(port, () => {
    console.log(`Sales Representative AI Assistant running at http://localhost:${port}`);
    console.log(`Configured Groq model: ${getGroqReadiness().model}`);
  });

  server.on('error', (error) => {
    if (error.code === 'EADDRINUSE') {
      console.warn(`Port ${port} is in use. Retrying on port ${port + 1}...`);
      startServer(port + 1);
      return;
    }

    console.error('[Server Error]:', error);
    process.exitCode = 1;
  });
}

startServer(DEFAULT_PORT);
