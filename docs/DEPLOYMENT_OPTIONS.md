# Chatbot Deployment Options

Hosted chatbot: [https://estudy-chatbot-salesrep.vercel.app/](https://estudy-chatbot-salesrep.vercel.app/)

The `/embed` URL is routed to the chatbot page by `vercel.json`. Redeploy the
project after applying that routing change before using the iframe or widget URLs below.

## 1. Webchat — Floating Bubble

Add the widget script to the LMS page or site template where the floating
**Ask AI** button should appear:

```html
<script
  src="https://estudy-chatbot-salesrep.vercel.app/widget.js"
  data-chatbot-url="https://estudy-chatbot-salesrep.vercel.app/embed"
  defer>
</script>
```

The widget opens the chatbot in a slide-out panel. The hosting LMS must allow
custom JavaScript on the page.

## 2. Full Page Chatbot

Link directly to the chatbot for a standalone, full-page experience:

```html
<a href="https://estudy-chatbot-salesrep.vercel.app/embed" target="_blank" rel="noopener">
  Open the AI chatbot
</a>
```

You can also use `https://estudy-chatbot-salesrep.vercel.app/embed` as the destination for an
LMS button or menu item.

## 3. Embedded Chatbot

Place the chatbot inside an LMS page, lesson, or content block:

```html
<iframe
  src="https://estudy-chatbot-salesrep.vercel.app/embed"
  title="AI learning assistant"
  width="100%"
  height="650"
  style="border: 0; border-radius: 12px;"
  allow="microphone">
</iframe>
```

The LMS and chatbot must both allow the iframe to load. For lesson-aware
responses, the LMS can send course and lesson context to the chatbot using the
`ESTUDY_CONTEXT` `postMessage` interface described in
[INTEGRATION.md](./INTEGRATION.md).

## Before Deployment

- Serve the chatbot over HTTPS.
- Confirm the LMS permits the chosen script or iframe integration.
- Configure the deployed chatbot server's allowed origins for the LMS domain.
- Configure `GROQ_API_KEY` and, optionally, `GROQ_MODEL` in the Vercel
  project's server-side environment variables. Never place API keys in LMS
  page code.
