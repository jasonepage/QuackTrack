'use strict';
// src/ai/gemma.js: one call to Gemma through Ollama (SDS.md section 4, FAQ
// rule 4). It calls OLLAMA_URL and no other host, so with AI_PROVIDER=gemma
// nothing leaves the machine (NFR-15).

const config = require('../config');

const TIMEOUT_MS = 15000;

// complete(systemText, question) -> the model's raw text, or throws.
async function complete(systemText, question) {
  const base = config.OLLAMA_URL.replace(/\/+$/, '');
  const res = await fetch(`${base}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: config.OLLAMA_MODEL,
      stream: false,
      format: 'json',
      options: { temperature: 0 },
      messages: [
        { role: 'system', content: systemText },
        { role: 'user', content: question },
      ],
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (res.status !== 200) throw new Error(`Ollama answered HTTP ${res.status}`);
  const data = await res.json();
  const text = data && data.message && data.message.content;
  if (typeof text !== 'string') throw new Error('Ollama reply had no text');
  return text;
}

module.exports = { complete };
