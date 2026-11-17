import Groq from 'groq-sdk';
import { getResponseStyleInstruction, normalizeResponseStyle } from './responseStyle.js';

const DEFAULT_MODEL = 'openai/gpt-oss-20b';
const MAX_MESSAGE_LENGTH = 4000;
const MAX_TOPIC_LENGTH = 200;
const MAX_HISTORY_MESSAGES = 8;
const MAX_HISTORY_MESSAGE_LENGTH = 1200;

const ACTION_TYPES = new Set([
  'general',
  'explain',
  'simplify',
  'example',
  'summarise',
  'quiz',
  'challenge',
  'challenge-evaluation'
]);

const SYSTEM_PROMPT = `You are a knowledgeable, professional AI assistant designed to support sales representatives. Help with general questions, sales conversations, product and service concepts, communication, planning, problem-solving, and practical recommendations. Explain clearly, use realistic examples when useful, and adapt answer length to the question and requested response style.

Use the conversation history to understand follow-up questions and avoid repeating information. Treat the learner-selected topic and any supplied LMS context as scope; do not introduce a different topic without a clear reason. Distinguish established facts from assumptions and label uncertainty. Never fabricate statistics, quotations, citations, sources, product details, or customer information. You do not have live internet access and must not imply that you searched the web or verified current information. For questions about live prices, current market conditions, recent developments, or other changing facts, explain that you cannot independently verify them and recommend checking a current authoritative source.

When asked to explain, simplify, give an example, or summarise, respond in the requested form. For quizzes, produce the exact JSON format requested by the user. For practical challenges, create a realistic activity and actionable evaluation criteria. Be concise by default, avoid generic filler and repetition, and use professional, supportive language.`;

const ACTION_INSTRUCTIONS = {
  general: 'Answer directly and helpfully. Use practical sales-representative context only when relevant.',
  explain: 'Explain the requested topic clearly, defining important terms and showing how the ideas connect.',
  simplify: 'Explain the requested topic in plain, simple language without losing its important meaning.',
  example: 'Give a specific, realistic example relevant to the requested topic. Clearly label hypothetical details.',
  summarise: 'Summarise the key points and practical takeaways without repeating the same idea.',
  quiz: 'Create a 3–5 question multiple-choice quiz based on the conversation and your general knowledge. Return only valid JSON with this shape: {"intro":"brief introduction","questions":[{"id":"q1","question":"...","options":[{"id":"a","text":"..."},{"id":"b","text":"..."},{"id":"c","text":"..."},{"id":"d","text":"..."}],"correctAnswerId":"a","explanation":"...","tip":"..."}]}. Do not invent citations or unsupported facts.',
  challenge: 'Create a practical sales-representative learning challenge. Return only valid JSON with this shape: {"intro":"brief introduction","scenario":{"id":"sales-challenge","title":"...","scenario":"...","promptQuestion":"...","keyConsiderations":["..."],"sampleGoodAspects":["..."]}}. Make the scenario specific to the requested topic and suitable for a representative to answer.',
  'challenge-evaluation': 'Evaluate the learner submission against the supplied sales challenge. Be constructive, specific, fair, and avoid made-up facts. Return only valid JSON with this shape: {"score":0,"strengths":["..."],"areasToImprove":["..."],"expertFeedback":"...","recommendedNextStep":"..."}.'
};

function getModel() {
  return String(process.env.GROQ_MODEL || DEFAULT_MODEL).trim() || DEFAULT_MODEL;
}

function getApiKey() {
  const key = String(process.env.GROQ_API_KEY || '').trim();
  return key && key !== 'your_groq_api_key_here' && key !== 'MY_GROQ_API_KEY'
    ? key
    : '';
}

export function getGroqReadiness() {
  const groqConfigured = Boolean(getApiKey());
  const model = getModel();
  return {
    status: groqConfigured ? 'ready' : 'not_configured',
    provider: 'Groq',
    model,
    groqConfigured,
    apiReady: groqConfigured && Boolean(model)
  };
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function cleanHistory(history) {
  return history.slice(-MAX_HISTORY_MESSAGES).flatMap((item) => {
    if (!isRecord(item) || typeof item.content !== 'string') return [];
    const role = item.sender === 'user' || item.role === 'learner' ? 'user' : 'assistant';
    const content = item.content.trim().slice(0, MAX_HISTORY_MESSAGE_LENGTH);
    return content ? [{ role, content }] : [];
  });
}

function parseJsonResponse(text) {
  const jsonText = text
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  return JSON.parse(jsonText);
}

function normalizeQuiz(quiz) {
  if (!isRecord(quiz) || !Array.isArray(quiz.questions) || quiz.questions.length < 3 || quiz.questions.length > 5) {
    return null;
  }

  const questions = quiz.questions.map((question, index) => {
    if (!isRecord(question) || !Array.isArray(question.options) || question.options.length !== 4) return null;
    const options = question.options.map((option, optionIndex) => {
      if (!isRecord(option) || typeof option.text !== 'string') return null;
      return {
        id: typeof option.id === 'string' ? option.id : String.fromCharCode(97 + optionIndex),
        text: option.text
      };
    });
    if (options.some((option) => option === null)) return null;

    return {
      id: typeof question.id === 'string' ? question.id : `q${index + 1}`,
      question: typeof question.question === 'string' ? question.question : '',
      options,
      correctAnswerId: typeof question.correctAnswerId === 'string' ? question.correctAnswerId : '',
      explanation: typeof question.explanation === 'string' ? question.explanation : '',
      ...(typeof question.tip === 'string' ? { tip: question.tip } : {})
    };
  });

  if (questions.some((question) => !question || !question.question || !question.options.some((option) => option.id === question.correctAnswerId))) {
    return null;
  }

  return {
    intro: typeof quiz.intro === 'string' ? quiz.intro : 'Let’s check your understanding.',
    questions
  };
}

function normalizeChallenge(value) {
  if (!isRecord(value) || !isRecord(value.scenario)) return null;
  const scenario = value.scenario;
  if (
    typeof scenario.title !== 'string'
    || typeof scenario.scenario !== 'string'
    || typeof scenario.promptQuestion !== 'string'
    || !Array.isArray(scenario.keyConsiderations)
    || scenario.keyConsiderations.some((item) => typeof item !== 'string')
  ) {
    return null;
  }

  return {
    intro: typeof value.intro === 'string' ? value.intro : 'Try this practical sales challenge.',
    scenario: {
      id: typeof scenario.id === 'string' ? scenario.id : 'sales-challenge',
      title: scenario.title,
      scenario: scenario.scenario,
      promptQuestion: scenario.promptQuestion,
      keyConsiderations: scenario.keyConsiderations,
      ...(Array.isArray(scenario.sampleGoodAspects)
        ? { sampleGoodAspects: scenario.sampleGoodAspects.filter((item) => typeof item === 'string') }
        : {})
    }
  };
}

function normalizeChallengeEvaluation(value) {
  if (
    !isRecord(value)
    || typeof value.score !== 'number'
    || value.score < 0
    || value.score > 100
    || !Array.isArray(value.strengths)
    || !Array.isArray(value.areasToImprove)
    || typeof value.expertFeedback !== 'string'
  ) {
    return null;
  }

  return {
    score: Math.round(value.score),
    strengths: value.strengths.filter((item) => typeof item === 'string'),
    areasToImprove: value.areasToImprove.filter((item) => typeof item === 'string'),
    expertFeedback: value.expertFeedback,
    ...(typeof value.recommendedNextStep === 'string'
      ? { recommendedNextStep: value.recommendedNextStep }
      : {})
  };
}

export async function generateChatResponse(body) {
  if (!isRecord(body)) {
    return { status: 400, body: { success: false, error: 'A JSON request body is required.' } };
  }

  const {
    message,
    actionType = 'general',
    responseStyle: requestedResponseStyle,
    topic: requestedTopic,
    challengeScenario,
    challengeSubmission,
    context = {},
    conversationHistory = []
  } = body;

  if (typeof message !== 'string' || !message.trim()) {
    return { status: 400, body: { success: false, error: 'Please enter a question.' } };
  }
  if (message.trim().length > MAX_MESSAGE_LENGTH) {
    return { status: 400, body: { success: false, error: `Messages must be ${MAX_MESSAGE_LENGTH} characters or fewer.` } };
  }
  if (typeof actionType !== 'string' || !ACTION_TYPES.has(actionType)) {
    return { status: 400, body: { success: false, error: 'The requested assistant action is not supported.' } };
  }
  if (requestedTopic !== undefined && typeof requestedTopic !== 'string') {
    return { status: 400, body: { success: false, error: 'Topic must be a string.' } };
  }
  if (typeof requestedTopic === 'string' && requestedTopic.trim().length > MAX_TOPIC_LENGTH) {
    return { status: 400, body: { success: false, error: `Topics must be ${MAX_TOPIC_LENGTH} characters or fewer.` } };
  }
  if (!isRecord(context) || !Array.isArray(conversationHistory)) {
    return { status: 400, body: { success: false, error: 'Context must be an object and conversation history must be an array.' } };
  }
  if (actionType === 'challenge-evaluation') {
    if (!isRecord(challengeScenario) || typeof challengeSubmission !== 'string' || !challengeSubmission.trim()) {
      return { status: 400, body: { success: false, error: 'A challenge scenario and learner submission are required for evaluation.' } };
    }
  }

  const apiKey = getApiKey();
  if (!apiKey) {
    return {
      status: 503,
      body: { success: false, error: 'The AI service is not configured. Set GROQ_API_KEY on the server.', groqConfigured: false }
    };
  }

  const sanitizedMessage = message.trim();
  const topic = typeof requestedTopic === 'string' ? requestedTopic.trim() : '';
  const safeContext = [
    context.courseName || context.courseTitle ? `Course: ${String(context.courseName || context.courseTitle).slice(0, 200)}` : '',
    context.moduleName || context.moduleTitle ? `Module: ${String(context.moduleName || context.moduleTitle).slice(0, 200)}` : '',
    context.lessonTitle ? `Lesson: ${String(context.lessonTitle).slice(0, 200)}` : '',
    context.learnerRole ? `Sales role: ${String(context.learnerRole).slice(0, 100)}` : ''
  ].filter(Boolean);
  const effectiveTopic = topic
    || context.lessonTitle
    || context.moduleName
    || context.moduleTitle
    || '';
  const challengeReview = actionType === 'challenge-evaluation'
    ? [
      `Challenge title: ${String(challengeScenario.title || 'Sales challenge').slice(0, 300)}`,
      `Scenario: ${String(challengeScenario.scenario || '').slice(0, 2000)}`,
      `Task: ${String(challengeScenario.promptQuestion || '').slice(0, 1000)}`,
      `Key considerations: ${Array.isArray(challengeScenario.keyConsiderations) ? challengeScenario.keyConsiderations.filter((item) => typeof item === 'string').slice(0, 10).join('; ') : ''}`,
      `Learner submission: ${challengeSubmission.trim().slice(0, MAX_MESSAGE_LENGTH)}`
    ].join('\n')
    : '';
  const prompt = [
    effectiveTopic ? `Selected topic: ${effectiveTopic}\nStay focused on this topic unless the learner explicitly changes it.` : '',
    safeContext.length ? `Relevant context:\n${safeContext.join('\n')}` : '',
    `Requested action: ${ACTION_INSTRUCTIONS[actionType]}`,
    `Response style: ${getResponseStyleInstruction(normalizeResponseStyle(requestedResponseStyle), actionType)}`,
    actionType === 'challenge-evaluation' ? challengeReview : `Learner message: ${sanitizedMessage}`
  ].filter(Boolean).join('\n\n');

  try {
    const model = getModel();
    const groq = new Groq({ apiKey });
    const completion = await groq.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        ...cleanHistory(conversationHistory),
        { role: 'user', content: prompt }
      ],
      temperature: 0.4,
      max_tokens: actionType === 'quiz' ? 1800 : 1200,
      ...(model.startsWith('openai/gpt-oss-') ? { reasoning_effort: 'low' } : {})
    }, { timeout: 45000 });

    const answer = completion.choices[0]?.message?.content?.trim();
    if (!answer) {
      return { status: 502, body: { success: false, error: 'Groq returned an empty response.' } };
    }

    let content = answer;
    let quizData;
    let challengeData;
    let challengeEvaluation;
    if (actionType === 'quiz') {
      try {
        const quiz = normalizeQuiz(parseJsonResponse(answer));
        if (quiz) {
          content = quiz.intro;
          quizData = {
            questions: quiz.questions,
            currentQuestionIndex: 0,
            userAnswers: {},
            isSubmitted: false
          };
        } else {
          return { status: 502, body: { success: false, error: 'Groq returned an invalid quiz. Please try again.' } };
        }
      } catch {
        return { status: 502, body: { success: false, error: 'Groq could not format the quiz correctly. Please try again.' } };
      }
    } else if (actionType === 'challenge') {
      try {
        const challenge = normalizeChallenge(parseJsonResponse(answer));
        if (challenge) {
          content = challenge.intro;
          challengeData = { scenario: challenge.scenario };
        } else {
          return { status: 502, body: { success: false, error: 'Groq returned an invalid challenge. Please try again.' } };
        }
      } catch {
        return { status: 502, body: { success: false, error: 'Groq could not format the challenge correctly. Please try again.' } };
      }
    } else if (actionType === 'challenge-evaluation') {
      try {
        challengeEvaluation = normalizeChallengeEvaluation(parseJsonResponse(answer));
        if (!challengeEvaluation) {
          return { status: 502, body: { success: false, error: 'Groq returned an invalid challenge evaluation. Please try again.' } };
        }
        content = challengeEvaluation.expertFeedback;
      } catch {
        return { status: 502, body: { success: false, error: 'Groq could not format the challenge evaluation correctly. Please try again.' } };
      }
    }

    const suggestions = effectiveTopic && actionType !== 'challenge-evaluation'
      ? [`Explain ${effectiveTopic} simply`, `Give an example about ${effectiveTopic}`, `Summarise ${effectiveTopic}`]
      : [];
    const chatMessage = {
      id: `msg-groq-${Date.now()}`,
      sender: 'assistant',
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      content,
      actionType,
      ...(context.lessonId ? { contextLessonId: context.lessonId } : {}),
      ...(context.lessonTitle ? { contextLessonTitle: context.lessonTitle } : {}),
      suggestions,
      ...(quizData ? { quizData } : {}),
      ...(challengeData ? { challengeData } : {}),
      ...(challengeEvaluation ? { challengeEvaluation } : {})
    };

    return { status: 200, body: { success: true, message: chatMessage } };
  } catch (error) {
    console.error('[Groq Chat] Request failed:', error?.message || error);
    const status = error?.name === 'APIConnectionTimeoutError' ? 504 : 502;
    return {
      status,
      body: { success: false, error: status === 504 ? 'Groq request timed out. Please try again.' : 'Groq could not complete the request. Please try again.' }
    };
  }
}
