/**
 * API Client — handles all backend communication
 */
const API = {
  BASE: '',

  async get(path) {
    const res = await fetch(`${this.BASE}${path}`);
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  },

  async post(path, body) {
    const res = await fetch(`${this.BASE}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  },

  async getSettings() {
    return this.get('/api/settings');
  },

  async saveSettings(settings) {
    return this.post('/api/settings', settings);
  },

  async testConnection(baseUrl) {
    return this.post('/api/test-connection', { baseUrl });
  },

  async getModels() {
    return this.get('/api/models');
  },

  async getFiles() {
    return this.get('/api/files');
  },

  async scanFolders(folderPaths) {
    return this.post('/api/files/scan', { folderPaths });
  },

  async browseFolders(dirPath) {
    const query = dirPath ? `?path=${encodeURIComponent(dirPath)}` : '';
    return this.get(`/api/browse${query}`);
  },

  async getFileContent(filename) {
    return this.get(`/api/files/${encodeURIComponent(filename)}`);
  },

  /**
   * Stream a chat message via SSE.
   * @param {string} message
   * @param {Array} history
   * @param {function} onChunk - called with each text chunk
   * @param {function} onDone - called when stream ends
   * @param {function} onError - called on error
   * @returns {AbortController} to cancel the stream
   */
  streamChat(message, history, onChunk, onDone, onError) {
    const controller = new AbortController();

    fetch(`${this.BASE}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, history }),
      signal: controller.signal
    }).then(res => {
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      function read() {
        reader.read().then(({ done, value }) => {
          if (done) { onDone(); return; }

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith('data:')) continue;
            const data = trimmed.slice(5).trim();
            if (data === '[DONE]') { onDone(); return; }
            try {
              const parsed = JSON.parse(data);
              if (parsed.error) { onError(parsed.error); return; }
              if (parsed.content) onChunk(parsed.content);
            } catch (e) {}
          }
          read();
        }).catch(err => {
          if (err.name !== 'AbortError') onError(err.message);
        });
      }
      read();
    }).catch(err => {
      if (err.name !== 'AbortError') onError(err.message);
    });

    return controller;
  },

  /**
   * Stream report generation via SSE.
   */
  streamReport(onChunk, onDone, onError) {
    const controller = new AbortController();

    fetch(`${this.BASE}/api/report`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
      signal: controller.signal
    }).then(res => {
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      function read() {
        reader.read().then(({ done, value }) => {
          if (done) { onDone(); return; }
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith('data:')) continue;
            const data = trimmed.slice(5).trim();
            if (data === '[DONE]') { onDone(); return; }
            try {
              const parsed = JSON.parse(data);
              if (parsed.error) { onError(parsed.error); return; }
              if (parsed.content) onChunk(parsed.content);
            } catch (e) {}
          }
          read();
        }).catch(err => {
          if (err.name !== 'AbortError') onError(err.message);
        });
      }
      read();
    }).catch(err => {
      if (err.name !== 'AbortError') onError(err.message);
    });

    return controller;
  }
};
