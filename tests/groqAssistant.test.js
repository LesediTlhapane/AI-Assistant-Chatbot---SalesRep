import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { generateChatResponse, getGroqReadiness } from '../server/groqAssistant.js';
import chatHandler from '../api/chat.js';
import healthHandler from '../api/health.js';

const originalFetch = globalThis.fetch;
const originalApiKey = process.env.GROQ_API_KEY;
const originalModel = process.env.GROQ_MODEL;
let completionText;
let capturedRequest;

beforeEach(() => {
  process.env.GROQ_API_KEY = 'test-groq-key';
  process.env.GROQ_MODEL = 'test-sales-model';
  completionText = 'A practical, helpful response.';
  capturedRequest = null;
  globalThis.fetch = async (url, options) => {
    capturedRequest = { url: String(url), body: JSON.parse(options.body) };
    return new Response(JSON.stringify({
      choices: [{ message: { content: completionText } }]
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  };
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalApiKey === undefined) delete process.env.GROQ_API_KEY;
  else process.env.GROQ_API_KEY = originalApiKey;
  if (originalModel === undefined) delete process.env.GROQ_MODEL;
  else process.env.GROQ_MODEL = originalModel;
});

test('answers a general question through the configured Groq model', async () => {
  const result = await generateChatResponse({ message: 'How can I plan my day?' });
  assert.equal(result.status, 200);
  assert.equal(result.body.message.content, 'A practical, helpful response.');
  assert.equal(capturedRequest.body.model, 'test-sales-model');
  assert.match(capturedRequest.url, /api\.groq\.com/);
  assert.match(capturedRequest.body.messages[0].content, /sales representatives/);
  assert.match(capturedRequest.body.messages.at(-1).content, /executive, concise style/i);
});

test('answers sales-related questions without requiring external research', async () => {
  const result = await generateChatResponse({
    message: 'How do I respond to a customer who says the price is too high?',
    topic: 'Sales objection handling'
  });
  assert.equal(result.status, 200);
  assert.match(capturedRequest.body.messages.at(-1).content, /Sales objection handling/);
  assert.doesNotMatch(capturedRequest.body.messages.at(-1).content, /Tavily|web search|research results/i);
});

test('answers technical questions using the same Groq workflow', async () => {
  const result = await generateChatResponse({
    message: 'Explain two-factor authentication in simple terms.',
    actionType: 'simplify'
  });
  assert.equal(result.status, 200);
  assert.match(capturedRequest.body.messages.at(-1).content, /plain, simple language/);
});

test('includes conversation history so follow-up questions retain context', async () => {
  const result = await generateChatResponse({
    message: 'What should I say next?',
    topic: 'Sales discovery calls',
    conversationHistory: [
      { sender: 'user', content: 'How do I run a sales discovery call?' },
      { sender: 'assistant', content: 'Start by asking about the customer’s goals.' }
    ]
  });
  assert.equal(result.status, 200);
  assert.ok(capturedRequest.body.messages.some((item) => item.content.includes('sales discovery call')));
  assert.ok(capturedRequest.body.messages.some((item) => item.content.includes('customer’s goals')));
});

test('returns a validated interactive quiz', async () => {
  completionText = JSON.stringify({
    intro: 'A quick sales quiz.',
    questions: [1, 2, 3].map((number) => ({
      id: `q${number}`,
      question: `Question ${number}?`,
      options: [
        { id: 'a', text: 'Option A' },
        { id: 'b', text: 'Option B' },
        { id: 'c', text: 'Option C' },
        { id: 'd', text: 'Option D' }
      ],
      correctAnswerId: 'a',
      explanation: 'Option A is correct.',
      tip: 'Review the key idea.'
    }))
  });

  const result = await generateChatResponse({
    message: 'Quiz me on sales qualification.',
    topic: 'Sales qualification',
    actionType: 'quiz'
  });

  assert.equal(result.status, 200);
  assert.equal(result.body.message.content, 'A quick sales quiz.');
  assert.equal(result.body.message.quizData.questions.length, 3);
  assert.equal(result.body.message.quizData.isSubmitted, false);
});

test('returns a practical challenge and evaluates challenge submissions through Groq', async () => {
  completionText = JSON.stringify({
    intro: 'Try this customer conversation challenge.',
    scenario: {
      id: 'sales-challenge',
      title: 'Addressing a budget concern',
      scenario: 'A prospect likes the solution but is concerned about cost.',
      promptQuestion: 'How would you respond and agree on a next step?',
      keyConsiderations: ['Clarify priorities', 'Explain relevant value'],
      sampleGoodAspects: ['Asks an open question']
    }
  });
  const challenge = await generateChatResponse({
    message: 'Create a challenge about sales objections.',
    topic: 'Sales objections',
    actionType: 'challenge'
  });
  assert.equal(challenge.status, 200);
  assert.equal(challenge.body.message.challengeData.scenario.title, 'Addressing a budget concern');

  completionText = JSON.stringify({
    score: 85,
    strengths: ['Connects the offer to customer priorities.'],
    areasToImprove: ['Ask one more clarifying question.'],
    expertFeedback: 'Good customer-focused response.',
    recommendedNextStep: 'Practise a follow-up question.'
  });
  const evaluation = await generateChatResponse({
    message: 'I would ask what outcomes matter most, explain the relevant value, and book a follow-up.',
    actionType: 'challenge-evaluation',
    challengeSubmission: 'I would ask what outcomes matter most, explain the relevant value, and book a follow-up.',
    challengeScenario: {
      title: 'Addressing a budget concern',
      scenario: 'The prospect is concerned about cost.',
      promptQuestion: 'Respond and agree on a next step.',
      keyConsiderations: ['Clarify priorities']
    }
  });
  assert.equal(evaluation.status, 200);
  assert.equal(evaluation.body.message.challengeEvaluation.score, 85);
});

test('health reports configured model and key readiness without a network request', () => {
  assert.deepEqual(getGroqReadiness(), {
    status: 'ready',
    provider: 'Groq',
    model: 'test-sales-model',
    groqConfigured: true,
    apiReady: true
  });
});

test('Vercel chat and health handlers use the same Groq-only workflow', async () => {
  const res = {
    statusCode: 0,
    headers: {},
    setHeader(name, value) {
      this.headers[name] = value;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    }
  };

  await chatHandler({
    method: 'POST',
    body: { message: 'What is a useful customer follow-up?' }
  }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.message.content, 'A practical, helpful response.');
  assert.equal(res.body.message.sources, undefined);
  assert.equal(capturedRequest.body.model, 'test-sales-model');

  const healthResponse = {
    ...res,
    statusCode: 0,
    body: undefined
  };
  healthHandler({ method: 'GET' }, healthResponse);
  assert.equal(healthResponse.statusCode, 200);
  assert.equal(healthResponse.body.groqConfigured, true);
  assert.equal(healthResponse.body.apiReady, true);
  assert.equal(healthResponse.body.model, 'test-sales-model');
  assert.equal(healthResponse.body.tavilyConfigured, undefined);
  assert.equal(healthResponse.body.knowledgeBase, undefined);
});

test('rejects invalid requests instead of sending them to Groq', async () => {
  const result = await generateChatResponse({ message: '   ' });
  assert.equal(result.status, 400);
  assert.equal(capturedRequest, null);
});
