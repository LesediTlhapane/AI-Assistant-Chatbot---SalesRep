import { getGroqReadiness } from '../server/groqAssistant.js';

export default function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({
      status: 'error',
      error: 'Only GET requests are supported.'
    });
  }

  return res.status(200).json({
    status: 'online',
    assistant: 'Sales Representative AI Assistant',
    ...getGroqReadiness()
  });
}
