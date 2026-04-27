require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const { scanFolder } = require('./lib/fileScanner');
const { parseDocument } = require('./lib/documentParser');
const { buildSystemPrompt, buildReportPrompt } = require('./lib/contextBuilder');
const { testConnection, listModels, chatCompletionStream } = require('./lib/llmConnector');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ─── In-Memory State ──────────────────────────────────────────────
let appState = {
  settings: {
    provider: process.env.LLM_PROVIDER || 'ollama',
    baseUrl: process.env.LLM_BASE_URL || 'http://localhost:11434',
    model: process.env.LLM_MODEL || 'llama3',
    folderPaths: process.env.DOCUMENTS_FOLDER ? [process.env.DOCUMENTS_FOLDER] : [],
    maxContextTokens: parseInt(process.env.MAX_CONTEXT_TOKENS) || 8192,
    temperature: 0.7
  },
  files: [],          // Scanned file metadata
  parsedDocs: [],     // Parsed document contents
  chatHistory: []     // Current conversation
};

// ─── Settings Persistence ──────────────────────────────────────────
const SETTINGS_FILE = path.join(__dirname, '.documentor-settings.json');

function loadSettings() {
  try {
    if (fs.existsSync(SETTINGS_FILE)) {
      const saved = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf-8'));
      appState.settings = { ...appState.settings, ...saved };
      console.log('✅ Loaded saved settings');
    }
  } catch (err) {
    console.log('⚠️  Could not load saved settings, using defaults');
  }
}

function saveSettings() {
  try {
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(appState.settings, null, 2));
  } catch (err) {
    console.error('Failed to save settings:', err.message);
  }
}

loadSettings();

// ─── API: Health ───────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

// ─── API: Settings ─────────────────────────────────────────────────
app.get('/api/settings', (req, res) => {
  res.json(appState.settings);
});

app.post('/api/settings', (req, res) => {
  const { provider, baseUrl, model, folderPaths, maxContextTokens, temperature } = req.body;

  if (provider !== undefined) appState.settings.provider = provider;
  if (baseUrl !== undefined) appState.settings.baseUrl = baseUrl.replace(/\/+$/, '');
  if (model !== undefined) appState.settings.model = model;
  if (folderPaths !== undefined) appState.settings.folderPaths = Array.isArray(folderPaths) ? folderPaths : [folderPaths];
  if (maxContextTokens !== undefined) appState.settings.maxContextTokens = parseInt(maxContextTokens);
  if (temperature !== undefined) appState.settings.temperature = parseFloat(temperature);

  saveSettings();
  res.json({ success: true, settings: appState.settings });
});

// ─── API: Models ───────────────────────────────────────────────────
app.get('/api/models', async (req, res) => {
  try {
    const result = await testConnection(appState.settings.baseUrl);
    res.json(result);
  } catch (err) {
    res.status(500).json({ connected: false, error: err.message, models: [] });
  }
});

// ─── API: Test Connection ──────────────────────────────────────────
app.post('/api/test-connection', async (req, res) => {
  const baseUrl = req.body.baseUrl || appState.settings.baseUrl;
  try {
    const result = await testConnection(baseUrl);
    res.json(result);
  } catch (err) {
    res.json({ connected: false, error: err.message });
  }
});

// ─── API: Browse Filesystem ───────────────────────────────────────
app.get('/api/browse', (req, res) => {
  const requestedPath = req.query.path || require('os').homedir();

  try {
    if (!fs.existsSync(requestedPath)) {
      return res.status(400).json({ error: 'Path does not exist' });
    }

    const stat = fs.statSync(requestedPath);
    if (!stat.isDirectory()) {
      return res.status(400).json({ error: 'Path is not a directory' });
    }

    const entries = fs.readdirSync(requestedPath, { withFileTypes: true });
    const dirs = [];

    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue; // Skip hidden
      if (entry.isDirectory()) {
        dirs.push({
          name: entry.name,
          path: path.join(requestedPath, entry.name)
        });
      }
    }

    dirs.sort((a, b) => a.name.localeCompare(b.name));

    res.json({
      current: requestedPath,
      parent: path.dirname(requestedPath),
      directories: dirs
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── API: File Scanning ───────────────────────────────────────────
app.get('/api/files', (req, res) => {
  res.json({
    folderPaths: appState.settings.folderPaths,
    files: appState.files,
    parsedCount: appState.parsedDocs.length
  });
});

app.post('/api/files/scan', async (req, res) => {
  const folderPaths = req.body.folderPaths || appState.settings.folderPaths || [];

  if (!folderPaths.length) {
    return res.status(400).json({ error: 'No folders configured. Add at least one folder.' });
  }

  // Validate all paths exist
  for (const fp of folderPaths) {
    if (!fs.existsSync(fp)) {
      return res.status(400).json({ error: `Folder does not exist: ${fp}` });
    }
  }

  // Update settings
  appState.settings.folderPaths = folderPaths;
  saveSettings();

  // Scan all folders
  appState.files = [];
  for (const fp of folderPaths) {
    console.log(`📂 Scanning folder: ${fp}`);
    const found = scanFolder(fp);
    appState.files.push(...found);
  }
  console.log(`   Found ${appState.files.length} supported files total`);

  // Parse all documents
  appState.parsedDocs = [];
  const errors = [];

  for (const file of appState.files) {
    try {
      console.log(`   📄 Parsing: ${file.name}`);
      const parsed = await parseDocument(file.path);
      file.parsed = true;
      file.wordCount = parsed.wordCount;
      file.charCount = parsed.charCount;

      appState.parsedDocs.push({
        name: file.name,
        path: file.path,
        type: file.type,
        content: parsed.text,
        metadata: parsed.metadata,
        tables: parsed.tables,
        wordCount: parsed.wordCount,
        charCount: parsed.charCount,
        pageCount: parsed.pageCount,
        sheetNames: parsed.sheetNames
      });
    } catch (err) {
      console.error(`   ❌ Error parsing ${file.name}:`, err.message);
      file.parsed = false;
      file.parseError = err.message;
      errors.push({ file: file.name, error: err.message });
    }
  }

  console.log(`✅ Parsed ${appState.parsedDocs.length}/${appState.files.length} documents`);

  res.json({
    success: true,
    folderPaths,
    totalFiles: appState.files.length,
    parsedFiles: appState.parsedDocs.length,
    files: appState.files,
    errors
  });
});

// ─── API: Get single file content ──────────────────────────────────
app.get('/api/files/:filename', (req, res) => {
  const doc = appState.parsedDocs.find(d => d.name === req.params.filename);
  if (!doc) {
    return res.status(404).json({ error: 'Document not found or not yet parsed' });
  }
  res.json(doc);
});

// ─── API: Chat (Streaming SSE) ────────────────────────────────────
app.post('/api/chat', async (req, res) => {
  const { message, history } = req.body;

  if (!message) {
    return res.status(400).json({ error: 'Message is required' });
  }

  // Set SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  try {
    // Build system prompt with document context
    const systemPrompt = buildSystemPrompt(
      appState.parsedDocs,
      appState.settings.maxContextTokens
    );

    // Build messages array
    const messages = [
      { role: 'system', content: systemPrompt }
    ];

    // Add conversation history
    if (history && Array.isArray(history)) {
      for (const msg of history) {
        messages.push({
          role: msg.role,
          content: msg.content
        });
      }
    }

    // Add current message
    messages.push({ role: 'user', content: message });

    // Stream from LLM
    const stream = await chatCompletionStream(
      appState.settings.baseUrl,
      appState.settings.model,
      messages,
      {
        temperature: appState.settings.temperature,
        maxTokens: 4096
      }
    );

    // Parse SSE stream from LLM and forward to client
    let buffer = '';

    stream.on('data', (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data:')) continue;

        const data = trimmed.slice(5).trim();
        if (data === '[DONE]') {
          res.write('data: [DONE]\n\n');
          return;
        }

        try {
          const parsed = JSON.parse(data);
          const content = parsed.choices?.[0]?.delta?.content;
          if (content) {
            res.write(`data: ${JSON.stringify({ content })}\n\n`);
          }
        } catch (e) {
          // Skip unparseable chunks
        }
      }
    });

    stream.on('end', () => {
      // Process any remaining buffer
      if (buffer.trim()) {
        const trimmed = buffer.trim();
        if (trimmed.startsWith('data:')) {
          const data = trimmed.slice(5).trim();
          if (data !== '[DONE]') {
            try {
              const parsed = JSON.parse(data);
              const content = parsed.choices?.[0]?.delta?.content;
              if (content) {
                res.write(`data: ${JSON.stringify({ content })}\n\n`);
              }
            } catch (e) {}
          }
        }
      }
      res.write('data: [DONE]\n\n');
      res.end();
    });

    stream.on('error', (err) => {
      console.error('Stream error:', err.message);
      res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
      res.end();
    });

    // Handle client disconnect
    req.on('close', () => {
      stream.destroy();
    });

  } catch (err) {
    console.error('Chat error:', err.message);
    res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
    res.write('data: [DONE]\n\n');
    res.end();
  }
});

// ─── API: Generate Report ──────────────────────────────────────────
app.post('/api/report', async (req, res) => {
  if (appState.parsedDocs.length === 0) {
    return res.status(400).json({ error: 'No documents loaded. Please scan a folder first.' });
  }

  // Set SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  try {
    const systemPrompt = buildSystemPrompt(
      appState.parsedDocs,
      appState.settings.maxContextTokens
    );

    const reportPrompt = buildReportPrompt(appState.parsedDocs);

    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: reportPrompt }
    ];

    const stream = await chatCompletionStream(
      appState.settings.baseUrl,
      appState.settings.model,
      messages,
      {
        temperature: 0.3,
        maxTokens: 8192
      }
    );

    let buffer = '';

    stream.on('data', (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data:')) continue;
        const data = trimmed.slice(5).trim();
        if (data === '[DONE]') {
          res.write('data: [DONE]\n\n');
          return;
        }
        try {
          const parsed = JSON.parse(data);
          const content = parsed.choices?.[0]?.delta?.content;
          if (content) {
            res.write(`data: ${JSON.stringify({ content })}\n\n`);
          }
        } catch (e) {}
      }
    });

    stream.on('end', () => {
      if (buffer.trim()) {
        const trimmed = buffer.trim();
        if (trimmed.startsWith('data:')) {
          const data = trimmed.slice(5).trim();
          if (data !== '[DONE]') {
            try {
              const parsed = JSON.parse(data);
              const content = parsed.choices?.[0]?.delta?.content;
              if (content) {
                res.write(`data: ${JSON.stringify({ content })}\n\n`);
              }
            } catch (e) {}
          }
        }
      }
      res.write('data: [DONE]\n\n');
      res.end();
    });

    stream.on('error', (err) => {
      res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
      res.end();
    });

    req.on('close', () => {
      stream.destroy();
    });

  } catch (err) {
    res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
    res.write('data: [DONE]\n\n');
    res.end();
  }
});

// ─── API: Clear Chat ──────────────────────────────────────────────
app.post('/api/chat/clear', (req, res) => {
  appState.chatHistory = [];
  res.json({ success: true });
});

// ─── Serve SPA ────────────────────────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ─── Start Server ─────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log('');
  console.log('  ╔══════════════════════════════════════════╗');
  console.log('  ║        📄 DOCUMENTOR is running          ║');
  console.log(`  ║     http://localhost:${PORT}                 ║`);
  console.log('  ╚══════════════════════════════════════════╝');
  console.log('');
  console.log(`  LLM Provider : ${appState.settings.provider}`);
  console.log(`  LLM Base URL : ${appState.settings.baseUrl}`);
  console.log(`  Model        : ${appState.settings.model}`);
  console.log(`  Folders      : ${appState.settings.folderPaths.length ? appState.settings.folderPaths.join(', ') : '(not configured)'}`);
  console.log('');

  // Auto-scan if folders are configured
  const validPaths = (appState.settings.folderPaths || []).filter(fp => fs.existsSync(fp));
  if (validPaths.length > 0) {
    console.log('  Auto-scanning configured folders...');
    appState.files = [];
    for (const fp of validPaths) {
      appState.files.push(...scanFolder(fp));
    }
    console.log(`  Found ${appState.files.length} supported files`);

    // Parse them in background
    (async () => {
      for (const file of appState.files) {
        try {
          const parsed = await parseDocument(file.path);
          file.parsed = true;
          file.wordCount = parsed.wordCount;
          appState.parsedDocs.push({
            name: file.name,
            path: file.path,
            type: file.type,
            content: parsed.text,
            metadata: parsed.metadata,
            tables: parsed.tables,
            wordCount: parsed.wordCount,
            charCount: parsed.charCount,
            pageCount: parsed.pageCount,
            sheetNames: parsed.sheetNames
          });
        } catch (err) {
          file.parsed = false;
          file.parseError = err.message;
        }
      }
      console.log(`  ✅ Auto-parsed ${appState.parsedDocs.length} documents`);
    })();
  }
});
