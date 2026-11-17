import express from 'express';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';
import { generateChatResponse, getGroqReadiness } from './server/groqAssistant.js';

dotenv.config();
dotenv.config({ path: '.env.local', override: true });

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const PORT = parseInt(process.env.PORT || '3000', 10);
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

app.get('/api/health', (req, res) => {
  res.json({
    status: 'online',
    assistant: 'Sales Representative AI Assistant',
    ...getGroqReadiness()
  });
});

app.post('/api/chat', async (req, res) => {
  const result = await generateChatResponse(req.body);
  return res.status(result.status).json(result.body);
});

async function setupVite() {
  if (process.env.NODE_ENV === 'production') {
    app.use(express.static(path.join(__dirname, 'dist')));
    app.get('*', (req, res) => {
      res.sendFile(path.join(__dirname, 'dist', 'index.html'));
    });
  } else {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa'
    });
    app.use(vite.middlewares);
  }

  const listen = (port: number) => {
    const server = app.listen(port, '0.0.0.0', () => {
      console.log(`Sales Representative AI Assistant running at http://localhost:${port}`);
      console.log(`Configured Groq model: ${getGroqReadiness().model}`);
    });

    server.on('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'EADDRINUSE') {
        console.warn(`Port ${port} is in use. Retrying on port ${port + 1}...`);
        listen(port + 1);
        return;
      }

      console.error('[Server Error]:', error);
      process.exitCode = 1;
    });
  };

  listen(PORT);
}

setupVite().catch((error) => {
  console.error('Failed to start server:', error);
  process.exitCode = 1;
});
