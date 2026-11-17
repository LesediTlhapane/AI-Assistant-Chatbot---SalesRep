import { generateChatResponse } from '../server/groqAssistant.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({
      success: false,
      error: 'Only POST requests are supported.'
    });
  }

  const result = await generateChatResponse(req.body);
  return res.status(result.status).json(result.body);
}
