import express from 'express';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import Groq from 'groq-sdk';
import { createServer as createViteServer } from 'vite';
import { normalizeResponseStyle } from './server/responseStyle.js';

// Load environment variables
dotenv.config();
dotenv.config({ path: '.env.local', override: true });

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = parseInt(process.env.PORT || '3000', 10);
const GROQ_API_KEY = (process.env.GROQ_API_KEY || '').trim();
const GROQ_MODEL = (process.env.GROQ_MODEL || 'openai/gpt-oss-20b').trim();
const TAVILY_API_KEY = (process.env.TAVILY_API_KEY || '').trim();
const PRIMARY_MODEL = GROQ_MODEL;

const WEB_RESEARCH_SYSTEM_PROMPT = `You are an internet research assistant. The learner-selected topic is the scope of the conversation: stay focused on it and do not introduce a different topic. Answer the learner's question using only the research results below and your best judgment about what is most credible. Synthesize and summarize the evidence, cite the most relevant sources in plain language, and clearly distinguish between confirmed facts and uncertain or weakly supported claims. If the search results do not support a reliable answer, say so clearly and explain what evidence was missing.`;

// Candidate fallback Groq models
const MODEL_FALLBACK_CHAIN = Array.from(new Set([
  PRIMARY_MODEL,
  'openai/gpt-oss-20b',
  'openai/gpt-oss-120b',
  'qwen/qwen3.8-27b',
  'allam-2-7b'
]));

const MAX_RESEARCH_RESULTS = 5;

function normalizeResearchResults(results: any[] = []) {
  const byUrl = new Map<string, any>();
  for (const result of results) {
    const url = typeof result?.url === 'string' ? result.url.trim() : '';
    if (!url) continue;
    if (!byUrl.has(url)) {
      byUrl.set(url, {
        title: result?.title || 'Untitled source',
        url,
        content: String(result?.content || result?.snippet || '').trim(),
        source: result?.source || new URL(url).hostname.replace(/^www\./, ''),
        score: typeof result?.score === 'number' ? result.score : 0,
        publishedDate: result?.published_date || result?.publishedDate || null
      });
    }
  }
  return Array.from(byUrl.values())
    .filter((entry) => entry.content.length > 40)
    .sort((a, b) => (b.score || 0) - (a.score || 0))
    .slice(0, MAX_RESEARCH_RESULTS);
}

async function searchWeb(query: string, limit = MAX_RESEARCH_RESULTS) {
  if (!TAVILY_API_KEY) {
    return { results: [], answer: '', error: 'TAVILY_API_KEY is not configured on the server.' };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    const response = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: TAVILY_API_KEY,
        query,
        search_depth: 'basic',
        max_results: Math.min(limit, MAX_RESEARCH_RESULTS),
        include_answer: true,
        include_raw_content: false
      }),
      signal: controller.signal
    });

    if (!response.ok) {
      const errorText = await response.text();
      return { results: [], answer: '', error: `Tavily request failed (${response.status}): ${errorText}` };
    }

    const data = await response.json();
    const results = normalizeResearchResults(Array.isArray(data?.results) ? data.results : []);
    return {
      results,
      answer: typeof data?.answer === 'string' ? data.answer.trim() : '',
      error: results.length === 0 ? 'No reliable search results were found for this query.' : ''
    };
  } catch (error: any) {
    const message = error?.name === 'AbortError' ? 'Tavily search timed out.' : error?.message || 'Unknown Tavily error.';
    return { results: [], answer: '', error: message };
  } finally {
    clearTimeout(timeout);
  }
}

app.use(express.json({ limit: '2mb' }));

// CORS & Allowed Origins
const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (!origin) {
    res.setHeader('Access-Control-Allow-Origin', '*');
  } else if (allowedOrigins.length === 0 || allowedOrigins.includes(origin) || origin.includes('localhost') || origin.includes('127.0.0.1')) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  } else {
    res.setHeader('Access-Control-Allow-Origin', allowedOrigins[0] || origin);
  }

  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }
  next();
});

// Initialize Groq client
function getGroqClient(): Groq | null {
  if (!GROQ_API_KEY || GROQ_API_KEY === 'MY_GROQ_API_KEY' || GROQ_API_KEY === 'your_groq_api_key_here') {
    return null;
  }
  return new Groq({ apiKey: GROQ_API_KEY });
}

// GET /api/health
app.get('/api/health', (req, res) => {
  const hasGroqKey = Boolean(process.env.GROQ_API_KEY && process.env.GROQ_API_KEY.trim().length > 5);
  res.json({
    status: 'online',
    assistant: 'AI BEE Champ / eStudy Learning Assistant',
    provider: 'Groq + Tavily research',
    primaryModel: PRIMARY_MODEL,
    groqConfigured: hasGroqKey,
    tavilyConfigured: Boolean(TAVILY_API_KEY),
    researchMode: 'live-web-search',
    knowledgeBase: { status: 'separate', activeForResearch: false }
  });
});

// POST /api/chat - Main chat endpoint using real web research + Groq analysis
app.post('/api/chat', async (req, res) => {
  const {
    message,
    actionType = 'general',
    responseStyle: requestedResponseStyle,
    topic: requestedTopic,
    context = {},
    conversationHistory = []
  } = req.body || {};
  const responseStyle = normalizeResponseStyle(requestedResponseStyle);

  if (!message || typeof message !== 'string' || message.trim().length === 0) {
    return res.status(400).json({ success: false, error: 'A valid message string is required.' });
  }

  const sanitizedMessage = message.trim().slice(0, 3000);
  if (requestedTopic !== undefined && typeof requestedTopic !== 'string') {
    return res.status(400).json({ success: false, error: 'Topic must be a string.' });
  }
  const topic = typeof requestedTopic === 'string' ? requestedTopic.trim().slice(0, 200) : '';
  const researchQuery = topic && topic.toLowerCase() !== sanitizedMessage.toLowerCase()
    ? `${topic}: ${sanitizedMessage}`
    : sanitizedMessage;
  const groq = getGroqClient();

  if (!groq) {
    return res.status(503).json({
      success: false,
      error: 'The AI service is not configured. Set GROQ_API_KEY on the server to enable web research answers.',
      groqConfigured: false,
      tavilyConfigured: Boolean(TAVILY_API_KEY)
    });
  }

  if (!TAVILY_API_KEY) {
    return res.status(503).json({
      success: false,
      error: 'The live web research service is not configured. Set TAVILY_API_KEY on the server to enable internet search.',
      groqConfigured: true,
      tavilyConfigured: false
    });
  }

  const research = await searchWeb(researchQuery, 5);
  if (research.error || research.results.length === 0) {
    return res.status(503).json({
      success: false,
      error: research.error || 'No reliable live web sources were found for this question. Please try a more specific query.',
      sources: [],
      groqConfigured: true,
      tavilyConfigured: true
    });
  }

  const contextPrompt = [
    '=== LEARNER CONTEXT ===',
    context.courseName || context.courseTitle ? `Course: ${context.courseName || context.courseTitle}` : null,
    context.moduleName || context.moduleTitle ? `Module: ${context.moduleName || context.moduleTitle}` : null,
    context.lessonTitle ? `Lesson: ${context.lessonTitle}` : null,
    '====================',
    ''
  ].filter(Boolean).join('\n');

  const recentHistory = Array.isArray(conversationHistory) ? conversationHistory.slice(-4) : [];
  const historyMessages: { role: 'user' | 'assistant'; content: string }[] = [];
  recentHistory.forEach((msg: any) => {
    if (msg?.sender && msg?.content) {
      historyMessages.push({
        role: msg.sender === 'user' || msg.role === 'learner' ? 'user' : 'assistant',
        content: String(msg.content).slice(0, 500)
      });
    }
  });

  const researchContext = research.results.map((result, index) => {
    const sourceText = [
      `[Source ${index + 1}]`,
      `Title: ${result.title}`,
      `Website: ${result.source}`,
      `URL: ${result.url}`,
      `Summary: ${result.content}`
    ].join('\n');
    return sourceText;
  }).join('\n\n');

  const styleInstruction = responseStyle === 'concise'
    ? 'Keep the answer concise, direct, and easy to scan.'
    : 'Provide a detailed but clear explanation with useful structure and practical context.';

  let actionInstruction = '';
  switch (actionType) {
    case 'explain':
      actionInstruction = 'Explain the topic clearly using the research results below. Structure the answer with headings and key points. Never invent facts or claim certainty without support from the sources.';
      break;
    case 'simplify':
      actionInstruction = 'Simplify the topic into plain language using only the research evidence below. Make it easy for a learner to understand without losing the key meaning.';
      break;
    case 'example':
      actionInstruction = 'Give a practical real-world example grounded in the research results below. Label illustrative examples clearly and avoid suggesting unsupported claims as fact.';
      break;
    case 'summarise':
      actionInstruction = 'Summarise the research results in concise bullet points. Focus on the strongest evidence and key takeaways.';
      break;
    case 'quiz':
      actionInstruction = 'Create a 3 to 5 question quiz based only on the research results below. Return valid JSON with this exact structure: {"intro":"brief encouragement","questions":[{"id":"q1","question":"...","options":[{"id":"a","text":"..."},{"id":"b","text":"..."},{"id":"c","text":"..."},{"id":"d","text":"..."}],"correctAnswerId":"a","explanation":"...","tip":"..."}]}. Keep it parseable and grounded in the cited evidence.';
      break;
    case 'challenge':
      actionInstruction = 'Create a practical challenge or prompt that helps the learner apply the research findings in a realistic setting.';
      break;
    default:
      actionInstruction = 'Answer the learner question using the research results below. Synthesize the strongest evidence, cite the relevant sources, and say clearly when the evidence is limited or uncertain.';
  }

  const prompt = [
    contextPrompt,
    '=== LIVE WEB RESEARCH ===',
    researchContext,
    '======================',
    `Learner-selected topic (stay focused on this topic; do not introduce a different topic): ${topic || context.lessonTitle || context.moduleName || context.moduleTitle || sanitizedMessage}`,
    `Instruction: ${actionInstruction}`,
    `Style: ${styleInstruction}`,
    `Learner question: "${sanitizedMessage}"`,
    'Please answer in a way that is grounded in the research, uses the source evidence responsibly, and does not rely on the old module files or eStudy documents.'
  ].join('\n\n');

  let lastError: any = null;
  let replyText: string | null = null;

  for (const targetModel of MODEL_FALLBACK_CHAIN) {
    try {
      console.log(`[Research Request] Attempting chat completion with model: ${targetModel}...`);
      const response = await groq.chat.completions.create({
        model: targetModel,
        messages: [
          { role: 'system', content: WEB_RESEARCH_SYSTEM_PROMPT },
          { role: 'system', content: styleInstruction },
          ...historyMessages,
          { role: 'user', content: prompt }
        ],
        temperature: 0.2,
        max_tokens: actionType === 'quiz' ? 2048 : responseStyle === 'concise' ? 350 : 1800,
        ...(targetModel.startsWith('openai/gpt-oss-') || targetModel.startsWith('qwen/qwen3.')
          ? { reasoning_effort: 'low' }
          : {})
      }, { timeout: 45000 });

      const candidate = response?.choices?.[0]?.message?.content;
      if (candidate && candidate.trim()) {
        replyText = candidate;
        break;
      }
    } catch (err: any) {
      lastError = err;
      console.warn(`[Research Request Warning] Model ${targetModel} error:`, err?.message || err);
    }
  }

  if (!replyText) {
    return res.status(503).json({
      success: false,
      error: `Groq could not produce a research-based answer. ${lastError?.message || 'Please try again.'}`,
      sources: research.results,
      groqConfigured: true,
      tavilyConfigured: true
    });
  }

  let quizData: any = undefined;
  if (actionType === 'quiz') {
    try {
      const jsonText = replyText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
      const parsedQuiz = JSON.parse(jsonText);
      if (Array.isArray(parsedQuiz.questions) && parsedQuiz.questions.length > 0) {
        quizData = { questions: parsedQuiz.questions };
        replyText = parsedQuiz.intro || `Let's test your understanding of ${context.lessonTitle || 'this topic'}.`;
      }
    } catch (err: any) {
      console.warn('[Groq Quiz Warning] Model did not return valid quiz JSON:', err?.message || err);
    }
  }

  const suggestions = [
    'Explain in simple terms',
    'Give a practical example',
    'Summarise the key findings'
  ];

  const sourceList = research.results.map((result) => ({
    title: result.title,
    url: result.url,
    source: result.source,
    snippet: result.content
  }));

  return res.json({
    success: true,
    message: {
      id: `msg-research-${Date.now()}`,
      sender: 'assistant',
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      content: replyText,
      actionType,
      contextLessonId: context.lessonId,
      contextLessonTitle: context.lessonTitle,
      suggestions,
      sources: sourceList,
      webResearch: {
        used: true,
        sourceCount: sourceList.length,
        searchQuery: researchQuery,
        answer: research.answer || undefined
      },
      ...(quizData ? { quizData } : {})
    },
    ...(quizData ? { quizData } : {})
  });
});

// Setup Vite middleware or static serving
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
      console.log(`=================================================`);
      console.log(` AI BEE Champ & eStudy AI Assistant Running`);
      console.log(` Powered by Groq (${PRIMARY_MODEL})`);
      console.log(` Port: http://localhost:${port}`);
      console.log(` API Endpoint: http://localhost:${port}/api/chat`);
      console.log(`=================================================`);
    });

    server.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        console.warn(`[Port ${port} is in use. Retrying on port ${port + 1}...]`);
        listen(port + 1);
        return;
      }

      console.error('[Server Error]:', err);
      process.exitCode = 1;
    });
  };

  listen(PORT);
}

setupVite().catch((err) => {
  console.error('Failed to start server:', err);
  process.exitCode = 1;
});
