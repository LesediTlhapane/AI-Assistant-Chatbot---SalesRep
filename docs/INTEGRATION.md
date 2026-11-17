# CrossKnowledge LMS Integration

The Sales Representative AI Assistant can run as a standalone page or be embedded in a CrossKnowledge page. LMS integration is optional; the assistant itself is a general-purpose Groq-powered chatbot.

## Floating widget

Add the widget script to the host page:

```html
<script
  src="https://estudy-chatbot-salesrep.vercel.app/widget.js"
  data-chatbot-url="https://estudy-chatbot-salesrep.vercel.app/embed"
  defer>
</script>
```

The host page must permit custom JavaScript. The widget opens the assistant in a side panel.

## Direct iframe

```html
<iframe
  id="salesrep-ai-iframe"
  src="https://estudy-chatbot-salesrep.vercel.app/embed"
  title="Sales Representative AI Assistant"
  style="width: 100%; height: 650px; border: 0; border-radius: 12px;"
  allow="microphone">
</iframe>
```

## Optional host context

The host may provide metadata to personalize the conversation. Updates are applied when the host sends a new message; the assistant does not detect LMS navigation on its own. Only send fields that are available and accurate.

```javascript
const iframeWindow = document.getElementById('salesrep-ai-iframe').contentWindow;

iframeWindow.postMessage({
  type: 'ESTUDY_CONTEXT',
  payload: {
    courseName: 'Sales onboarding',
    lessonTitle: 'Consultative selling',
    learnerRole: 'Sales representative'
  }
}, 'https://estudy-chatbot-salesrep.vercel.app');
```

For the floating widget, the host may also call:

```javascript
window.eStudyAiWidget.updateContext({
  courseName: 'Sales onboarding',
  lessonTitle: 'Consultative selling',
  learnerRole: 'Sales representative'
});
```

Context is optional metadata that helps frame the conversation. It is not treated as verified evidence.

## Server configuration

Set `GROQ_API_KEY` on the server or in the Vercel project's **Settings → Environment Variables**. `GROQ_MODEL` is optional and defaults to `openai/gpt-oss-20b`. Do not put credentials in the host page, iframe URL, `postMessage` payload, or frontend environment variables.

After deployment, check `/api/health` for the configured model and `groqConfigured` / `apiReady` status. This reports environment configuration only; it does not make a test request to Groq.

## Security notes

- Serve the assistant over HTTPS.
- Restrict local Express CORS with `ALLOWED_ORIGINS` when needed.
- The iframe `postMessage` sender should use the deployed assistant's exact origin rather than `*`.
- Never include secrets or sensitive learner information in context metadata.
