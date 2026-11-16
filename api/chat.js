import Groq from 'groq-sdk';
import { normalizeResponseStyle } from '../server/responseStyle.js';

const GROQ_API_KEY = (process.env.GROQ_API_KEY || '').trim();
const TAVILY_API_KEY = (process.env.TAVILY_API_KEY || '').trim();
const PRIMARY_MODEL = (process.env.GROQ_MODEL || 'openai/gpt-oss-20b').trim();
const MODELS = Array.from(new Set([
  PRIMARY_MODEL,
  'openai/gpt-oss-20b',
  'openai/gpt-oss-120b',
  'qwen/qwen3.8-27b',
  'allam-2-7b'
]));

const WEB_RESEARCH_SYSTEM_PROMPT = `You are an internet research assistant. Answer the learner's question using only the research results below and your best judgment about what is most credible. Synthesize and summarize the evidence, cite the most relevant sources in plain language, and clearly distinguish between confirmed facts and uncertain or weakly supported claims. If the search results do not support a reliable answer, say so clearly and explain what evidence was missing.`;

function normalizeSearchResults(results = []) {
  const byUrl = new Map();
  for (const result of results) {
    const url = typeof result?.url === 'string' ? result.url.trim() : '';
    if (!url) continue;
    if (!byUrl.has(url)) {
      byUrl.set(url, {
        title: result?.title || 'Untitled source',
        url,
        source: result?.source || new URL(url).hostname.replace(/^www\./, ''),
        content: String(result?.content || result?.snippet || '').trim(),
        score: typeof result?.score === 'number' ? result.score : 0,
      });
    }
  }

  return Array.from(byUrl.values())
    .filter((entry) => entry.content.length > 40)
    .sort((a, b) => (b.score || 0) - (a.score || 0))
    .slice(0, 5);
}

async function searchWeb(query, limit = 5) {
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
        max_results: Math.min(limit, 5),
        include_answer: true,
        include_raw_content: false
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorText = await response.text();
      return { results: [], answer: '', error: `Tavily request failed (${response.status}): ${errorText}` };
    }

    const data = await response.json();
    const results = normalizeSearchResults(Array.isArray(data?.results) ? data.results : []);
    return {
      results,
      answer: typeof data?.answer === 'string' ? data.answer.trim() : '',
      error: results.length === 0 ? 'No reliable search results were found for this query.' : '',
    };
  } catch (error) {
    const message = error?.name === 'AbortError' ? 'Tavily search timed out.' : error?.message || 'Unknown Tavily error.';
    return { results: [], answer: '', error: message };
  } finally {
    clearTimeout(timeout);
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({
      success: false,
      error: 'Only POST requests are supported.',
    });
  }

  const apiKey = GROQ_API_KEY;
  const {
    message,
    actionType = 'general',
    responseStyle: requestedResponseStyle,
    context = {},
    conversationHistory = [],
  } = req.body || {};

  if (typeof message !== 'string' || !message.trim()) {
    return res.status(400).json({
      success: false,
      error: 'Please enter a question.',
    });
  }

  if (!apiKey || apiKey === 'your_groq_api_key_here' || apiKey.trim() === '') {
    return res.status(503).json({
      success: false,
      error: 'The AI service is not configured. Set GROQ_API_KEY on the server to enable web research answers.',
      groqConfigured: false,
      tavilyConfigured: Boolean(TAVILY_API_KEY),
    });
  }

  if (!TAVILY_API_KEY) {
    return res.status(503).json({
      success: false,
      error: 'The live web research service is not configured. Set TAVILY_API_KEY on the server to enable internet search.',
      groqConfigured: true,
      tavilyConfigured: false,
    });
  }

  try {
    const responseStyle = normalizeResponseStyle(requestedResponseStyle);
    const sanitizedMessage = message.trim().slice(0, 3000);
    const research = await searchWeb(sanitizedMessage, 5);

    if (research.error || research.results.length === 0) {
      return res.status(503).json({
        success: false,
        error: research.error || 'No reliable live web sources were found for this question. Please try a more specific query.',
        sources: [],
        groqConfigured: true,
        tavilyConfigured: true,
      });
    }

    const safeContext = {
      courseName: context.courseName || context.courseTitle,
      moduleName: context.moduleName || context.moduleTitle,
      lessonTitle: context.lessonTitle,
    };

    const recentHistory = Array.isArray(conversationHistory) ? conversationHistory.slice(-4) : [];
    const historyMessages = recentHistory.map((item) => ({
      role: item.sender === 'user' || item.role === 'learner' ? 'user' : 'assistant',
      content: String(item.content || '').slice(0, 500)
    }));

    const styleInstruction = responseStyle === 'concise'
      ? 'Keep the answer concise, direct, and easy to scan.'
      : 'Provide a detailed but clear explanation with useful structure and practical context.';

    const researchContext = research.results.map((result, index) => [
      `[Source ${index + 1}]`,
      `Title: ${result.title}`,
      `Website: ${result.source}`,
      `URL: ${result.url}`,
      `Summary: ${result.content}`,
    ].join('\n')).join('\n\n');

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
      '=== LEARNER CONTEXT ===',
      safeContext.courseName ? `Course: ${safeContext.courseName}` : null,
      safeContext.moduleName ? `Module: ${safeContext.moduleName}` : null,
      safeContext.lessonTitle ? `Lesson: ${safeContext.lessonTitle}` : null,
      '====================',
      '=== LIVE WEB RESEARCH ===',
      researchContext,
      '======================',
      `Instruction: ${actionInstruction}`,
      `Style: ${styleInstruction}`,
      `Learner question: "${sanitizedMessage}"`,
      'Please answer in a way that is grounded in the research, uses the source evidence responsibly, and does not rely on the old module files or eStudy documents.'
    ].filter(Boolean).join('\n\n');

    const groq = new Groq({ apiKey: apiKey.trim() });
    let answer = '';
    let lastError;

    for (const model of MODELS) {
      try {
        const result = await groq.chat.completions.create({
          model,
          messages: [
            { role: 'system', content: WEB_RESEARCH_SYSTEM_PROMPT },
            { role: 'system', content: styleInstruction },
            ...historyMessages,
            { role: 'user', content: prompt }
          ],
          temperature: 0.2,
          max_tokens: actionType === 'quiz' ? 2048 : responseStyle === 'concise' ? 350 : 1800,
          ...(model.startsWith('openai/gpt-oss-') || model.startsWith('qwen/qwen3.')
            ? { reasoning_effort: 'low' }
            : {}),
        }, { timeout: 45000 });

        answer = result.choices[0]?.message?.content || '';
        if (answer.trim()) break;
      } catch (error) {
        lastError = error;
      }
    }

    if (!answer.trim()) {
      return res.status(502).json({
        success: false,
        error: `Groq service error: ${lastError?.message || 'Please try again.'}`,
      });
    }

    let quizData;
    if (actionType === 'quiz') {
      try {
        const jsonText = answer.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
        const parsedQuiz = JSON.parse(jsonText);
        if (Array.isArray(parsedQuiz.questions) && parsedQuiz.questions.length > 0) {
          quizData = { questions: parsedQuiz.questions };
          answer = parsedQuiz.intro || `Let's test your understanding of ${safeContext.lessonTitle || 'this topic'}.`;
        }
      } catch (err) {
        console.warn('Quiz parsing error:', err?.message || err);
      }
    }

    const sourceList = research.results.map((result) => ({
      title: result.title,
      url: result.url,
      source: result.source,
      snippet: result.content
    }));

    return res.status(200).json({
      success: true,
      message: {
        id: `msg-research-${Date.now()}`,
        sender: 'assistant',
        timestamp: new Date().toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit',
        }),
        content: answer,
        actionType,
        contextLessonId: context.lessonId,
        contextLessonTitle: context.lessonTitle,
        suggestions: ['Simplify this', 'Give me an example', 'Summarise the key findings'],
        sources: sourceList,
        webResearch: {
          used: true,
          sourceCount: sourceList.length,
          searchQuery: sanitizedMessage,
          answer: research.answer || undefined,
        },
        ...(quizData ? { quizData } : {})
      },
      ...(quizData ? { quizData } : {})
    });
  } catch (error) {
    console.error('Chat API error:', error?.message || error);
    return res.status(500).json({
      success: false,
      error: 'Something went wrong. Please try again.',
    });
  }
}
