const fetch = require('node-fetch');

/**
 * LLM Connector — Unified OpenAI-compatible API client for Ollama and LM Studio.
 */

const DEFAULT_PROVIDERS = {
  ollama: {
    name: 'Ollama',
    baseUrl: 'http://localhost:11434',
    defaultModel: 'llama3'
  },
  lmstudio: {
    name: 'LM Studio',
    baseUrl: 'http://localhost:1234',
    defaultModel: 'default'
  }
};

/**
 * Test if the LLM server is reachable and return available models.
 */
async function testConnection(baseUrl) {
  try {
    const url = `${baseUrl}/v1/models`;
    const response = await fetch(url, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
      timeout: 5000
    });

    if (!response.ok) {
      throw new Error(`Server returned ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();
    return {
      connected: true,
      models: (data.data || []).map(m => ({
        id: m.id,
        name: m.id,
        owned_by: m.owned_by || 'local'
      }))
    };
  } catch (err) {
    return {
      connected: false,
      error: err.message,
      models: []
    };
  }
}

/**
 * Fetch available models from the LLM server.
 */
async function listModels(baseUrl) {
  const result = await testConnection(baseUrl);
  return result.models;
}

/**
 * Send a chat completion request and return the full response (non-streaming).
 */
async function chatCompletion(baseUrl, model, messages, options = {}) {
  const url = `${baseUrl}/v1/chat/completions`;
  const body = {
    model,
    messages,
    temperature: options.temperature ?? 0.7,
    max_tokens: options.maxTokens ?? 4096,
    stream: false
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer not-needed'
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`LLM API error (${response.status}): ${errorText}`);
  }

  const data = await response.json();
  return {
    content: data.choices?.[0]?.message?.content || '',
    usage: data.usage || {},
    model: data.model || model
  };
}

/**
 * Send a streaming chat completion request.
 * Returns a ReadableStream that yields SSE-formatted chunks.
 */
async function chatCompletionStream(baseUrl, model, messages, options = {}) {
  const url = `${baseUrl}/v1/chat/completions`;
  const body = {
    model,
    messages,
    temperature: options.temperature ?? 0.7,
    max_tokens: options.maxTokens ?? 4096,
    stream: true
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer not-needed'
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`LLM API error (${response.status}): ${errorText}`);
  }

  return response.body;
}

module.exports = {
  testConnection,
  listModels,
  chatCompletion,
  chatCompletionStream,
  DEFAULT_PROVIDERS
};
