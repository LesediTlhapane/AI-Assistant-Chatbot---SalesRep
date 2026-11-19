# Sales Representative AI Assistant

A general-purpose AI assistant for sales representatives, powered by Groq. It can answer general and sales-related questions, explain concepts, provide examples, summarise information, create quizzes and practical challenges, and handle follow-up questions using the conversation history.

The assistant uses Groq's pretrained model knowledge and context supplied in the conversation; no uploads are needed. It does not search the internet. For current market conditions, prices, or recent developments, it explains that it cannot independently verify live information.

## Conversation history

Conversation history is saved in this browser's local storage, including quiz answers and challenge drafts/results. It is restored when the chatbot is reopened on the same browser and origin. Use the conversation selector to return to an earlier conversation. **New conversation** starts a separate history; **Clear Current Conversation** only clears the selected conversation. Browser storage is not synced to other devices and can be removed by clearing site data.

## Architecture

```text
CrossKnowledge host page (optional)
       │ postMessage context
       ▼
React + TypeScript chat interface
       │ POST /api/chat
       ▼
Shared server-side Groq handler
       │
       ▼
Groq Chat Completions API
```

Both local Express servers and the Vercel `/api/chat` function use the same Groq handler in `server/groqAssistant.js`.

## Environment variables

Configure these values manually in your local server environment or in the Vercel project settings:

- `GROQ_API_KEY` — required; server-side Groq API key.
- `GROQ_MODEL` — optional; defaults to `openai/gpt-oss-20b`.
- `PORT` — optional for local server startup.
- `ALLOWED_ORIGINS` — optional comma-separated origins for local Express CORS.

For local development, copy `.env.example` to `.env.local` and add your own values. Do not commit credentials or expose them through frontend variables. On Vercel, set `GROQ_API_KEY` and, if desired, `GROQ_MODEL` under **Project Settings → Environment Variables**.

`GET /api/health` reports the configured provider, model, and whether server-side Groq credentials are configured. This is a configuration check, not a live Groq connectivity test.

## CrossKnowledge context

CrossKnowledge embedding remains optional. The widget and iframe can receive course, lesson, or learner metadata through the `ESTUDY_CONTEXT` `postMessage` interface. This metadata can help frame a conversation but is not treated as verified evidence.

See [docs/INTEGRATION.md](./docs/INTEGRATION.md) for widget, iframe, and context examples. Deployment examples are in [docs/DEPLOYMENT_OPTIONS.md](./docs/DEPLOYMENT_OPTIONS.md).

## Local development

```bash
npm install
npm run dev
```

The development server starts Express and Vite together. If the configured port is in use, it retries on the next port.

## Validation

```bash
npm test
npm run lint
npm run build
```
