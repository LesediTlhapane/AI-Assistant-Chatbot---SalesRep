import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import {
  createConversation,
  loadConversationState,
  saveConversationState
} from '../src/services/conversationStorage.ts';

const originalWindow = globalThis.window;
const storedValues = new Map();
const localStorage = {
  getItem(key) {
    return storedValues.get(key) ?? null;
  },
  setItem(key, value) {
    storedValues.set(key, String(value));
  }
};

beforeEach(() => {
  storedValues.clear();
  globalThis.window = { localStorage };
});

afterEach(() => {
  if (originalWindow === undefined) delete globalThis.window;
  else globalThis.window = originalWindow;
});

test('restores complete conversation history and activity progress after reload', () => {
  const first = createConversation({ lessonTitle: 'Sales conversations' });
  first.messages = Array.from({ length: 70 }, (_, index) => ({
    id: `message-${index}`,
    sender: index % 2 === 0 ? 'user' : 'assistant',
    timestamp: '10:00',
    content: `Conversation entry ${index}`
  }));
  first.messages.push({
    id: 'quiz',
    sender: 'assistant',
    timestamp: '10:01',
    content: 'Quiz in progress',
    quizData: {
      questions: [{ id: 'q1', question: 'Question?', options: [], correctAnswerId: 'b', explanation: '' }],
      currentQuestionIndex: 0,
      userAnswers: { '0': 'a' },
      isSubmitted: false
    }
  });
  first.messages.push({
    id: 'challenge',
    sender: 'assistant',
    timestamp: '10:02',
    content: 'Challenge in progress',
    challengeData: {
      scenario: {
        id: 'scenario',
        title: 'Customer objection',
        scenario: 'A customer has an objection.',
        promptQuestion: 'How would you respond?',
        keyConsiderations: []
      },
      userSubmission: 'I would ask a clarifying question.'
    }
  });

  const previous = createConversation();
  previous.messages = [{
    id: 'mistake',
    sender: 'assistant',
    timestamp: '09:00',
    content: 'The request failed; please try again.',
    isError: true
  }];
  const state = {
    conversations: [first, previous],
    activeConversationId: first.id
  };

  saveConversationState(state);

  assert.deepEqual(loadConversationState(), state);
  assert.equal(loadConversationState().conversations[0].messages.length, 72);
  assert.equal(loadConversationState().conversations[0].messages[70].quizData.userAnswers['0'], 'a');
  assert.equal(loadConversationState().conversations[0].messages[71].challengeData.userSubmission, 'I would ask a clarifying question.');
  assert.equal(loadConversationState().conversations[1].messages[0].isError, true);
});

test('creates a fresh conversation when storage has no prior state', () => {
  const state = loadConversationState();
  assert.equal(state.conversations.length, 1);
  assert.equal(state.conversations[0].id, state.activeConversationId);
  assert.deepEqual(state.conversations[0].messages, []);
});

test('reports malformed saved state instead of overwriting it', () => {
  storedValues.set('estudy-assistant-conversations-v1', '{not valid json');
  assert.throws(() => loadConversationState(), SyntaxError);
  assert.equal(storedValues.get('estudy-assistant-conversations-v1'), '{not valid json');
});
