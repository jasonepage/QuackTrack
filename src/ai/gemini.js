'use strict';
// src/ai/gemini.js: one Gemini API call (SDS.md section 4, FAQ rule 3; D10).
// The key comes only from config and goes only into the request header.
// It is never logged, returned, or written anywhere.

const config = require('../config');

// D10: the env var list is locked, so the model is this one constant.
// If T8 test 2 gets a model error, change it to 'gemini-3.5-flash-lite'.
const GEMINI_MODEL = 'gemini-3.8-flash';
const TIMEOUT_MS = 15000;

// complete(systemText, question) -> the model's raw text, or throws.
async function complete(systemText, question) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': config.GEMINI_API_KEY },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemText }] },
      contents: [{ role: 'user', parts: [{ text: question }] }],
      generationConfig: { temperature: 0, responseMimeType: 'application/json' },
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  // The status is safe to report; the body could echo request details.
  if (res.status !== 200) throw new Error(`Gemini answered HTTP ${res.status}`);
  const data = await res.json();
  const text = data && data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts && data.candidates[0].content.parts[0] && data.candidates[0].content.parts[0].text;
  if (typeof text !== 'string') throw new Error('Gemini reply had no text');
  return text;
}

module.exports = { complete, GEMINI_MODEL };
