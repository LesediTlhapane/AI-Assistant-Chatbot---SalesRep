# eStudy South Africa AI Learning Assistant

An enterprise LMS-ready AI Learning Assistant built for **eStudy South Africa**, powered by **Google Gemini 2.5 Flash** and designed for seamless embedding into **CrossKnowledge LMS**.

---

## 🎯 Purpose & Overview

The eStudy AI Assistant helps approximately 1,800 enrolled learners master their course material by providing:
- Structured, clear explanations of complex lesson topics.
- Simplified language with relatable South African workplace analogies.
- Practical business and workplace application examples.
- Executive summaries of lessons and modules.
- Academic integrity guidance for self-assessments and quizzes.
- Real-time lesson context awareness provided directly by CrossKnowledge LMS.

---

## 🏗️ System Architecture

```
                 CrossKnowledge LMS
                         │
                  eStudy AI Widget (public/widget.js)
                         │
                  Floating "Ask AI" Button
                         │
                  Right-side Slide Drawer
                         │
                    Chatbot Iframe (/embed)
                         │
                         ▼
             React Chatbot Frontend (Vite + TS)
                         │
                         ▼
                 Node.js / Express Backend (server.js)
                         │
                 Context Builder & Safety Checks
                         │
                 Rate Limiter (30 req/min/IP)
                         │
                         ▼
                Google Gemini 2.5 Flash API
```

---

## 🛠️ Technology Stack

- **Frontend:** React 19, TypeScript, Vite, Tailwind CSS v4, Motion (Framer), Lucide Icons.
- **Backend:** Node.js, Express, `@google/genai` (SDK v2.4.0), `dotenv`.
- **AI Model:** Google Gemini 2.5 Flash (`gemini-2.5-flash`).
- **Integration:** Embeddable iframe (`/embed`), JavaScript widget (`public/widget.js`), `postMessage` event listener.

---

## Environment Variables

Configure these manually on the server or in your local environment before starting the app. None of these values should be hard-coded into frontend code or committed to the repository.

Required for the application to run:

```env
# Server-side only. Replace placeholders with your real values.
GROQ_API_KEY=your_groq_api_key_here
GROQ_MODEL=openai/gpt-oss-20b
TAVILY_API_KEY=your_tavily_api_key_here
PORT=3000
```

Optional but commonly used for local/browser access:

```env
ALLOWED_ORIGINS=http://localhost:3000,http://localhost:3001,http://localhost:5173
```

Notes:
- Copy `.env.example` to `.env.local` or `.env` locally and fill in your own values.
- Do not commit actual credentials.
- The repository's `.gitignore` excludes real environment files.
- On Vercel, configure the same variables in **Project Settings → Environment Variables** for each deployment environment and redeploy.

Keep the course DOCX files in `assets/knowledge base` tracked in Git; see [docs/INTEGRATION.md](./docs/INTEGRATION.md#deploying-on-vercel) for deployment checks.

---

## 🚀 Local Development Setup

### 1. Install Dependencies

```bash
npm install
```

### 2. Start the Application

```bash
npm run dev
```
*Starts the Express API and Vite frontend together. If the configured port is already in use, the server retries on the next port and prints the URL to use.*

Open the URL printed in the terminal (normally `http://localhost:3000`) to use the AI chatbot. Lesson context is supplied by the host LMS when embedded; otherwise, the chatbot starts without mock course or learner data.

---

## 🔌 CrossKnowledge LMS Integration

Detailed integration instructions are available in [docs/INTEGRATION.md](file:///c:/Users/LesediTlhapane/OneDrive%20-%20BEE%20Analyst%20%28Pty%29%20Ltd/Desktop/AI-Assistant-Chatbot/docs/INTEGRATION.md).

### Quick Summary:
1. **JavaScript Widget Integration**:
   ```html
   <script src="https://your-chatbot-domain.com/widget.js" data-chatbot-url="https://your-chatbot-domain.com/embed" defer></script>
   ```
2. **Direct Iframe Embedding**:
   ```html
   <iframe src="https://your-chatbot-domain.com/embed" style="width: 100%; height: 600px; border: none;"></iframe>
   ```
3. **Dynamic Context via `postMessage`**:
   ```js
   iframeWindow.postMessage({
     type: 'ESTUDY_CONTEXT',
     payload: {
       courseId: 'CK-101',
       courseName: 'Leadership & Management',
       moduleId: 'MOD-01',
       moduleName: 'Strategic Planning',
       lessonId: 'LESSON-01',
       lessonTitle: 'Swot Analysis in SA Business',
       lessonContent: '...',
       learnerId: 'STUDENT-123'
     }
   }, '*');
   ```

---

## 🔒 Security Features

- **Key Isolation**: Server-side API invocation prevents secret leakage.
- **CORS Protection**: Origin validation restricts request origins.
- **Rate Limiting**: In-memory sliding window rate limiting prevents API abuse (30 requests/minute per client IP).
- **Origin Check**: `postMessage` event listener validates origin domains against `ALLOWED_ORIGINS`.
- **Token Efficiency**: System context limits lesson content and history size per prompt.

---

## 🧪 Verification & Build Commands

```bash
# Typecheck
npm run lint

# Build production bundle
npm run build

# Start production Express server
npm run start
```
