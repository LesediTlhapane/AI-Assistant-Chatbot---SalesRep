export function normalizeResponseStyle(value) {
  return value === 'detailed' ? 'detailed' : 'concise';
}

export function getResponseStyleInstruction(responseStyle, actionType = 'general') {
  if (responseStyle === 'concise') {
    return actionType === 'quiz'
      ? 'Use an executive, concise style. Keep the quiz introduction, explanations, and tips brief while preserving the required JSON format and every required question.'
      : 'Use an executive, concise style. Lead with the direct answer, then give only the essential supporting points. Keep it under 100 words unless the question requires a little more detail. Avoid unnecessary examples, background, or conclusions.';
  }

  return actionType === 'quiz'
    ? 'Use a clear, educational style. Give learners useful explanations and tips for each answer while preserving the required JSON format and every required question.'
    : 'Use a thorough but relevant style. Explain the core concept, define important terms, and develop key supporting points in clear sections or steps. Match the depth to the question; do not invent facts or repeat points just to add length.';
}
