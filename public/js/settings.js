/**
 * Settings Module — manages the settings panel UI, folder browser, and persistence
 */
const Settings = {
  els: {},
  folderPaths: [],

  init() {
    this.els = {
      overlay: document.getElementById('settings-overlay'),
      panel: document.getElementById('settings-panel'),
      provider: document.getElementById('setting-provider'),
      baseUrl: document.getElementById('setting-base-url'),
      model: document.getElementById('setting-model'),
      temperature: document.getElementById('setting-temperature'),
      tempValue: document.getElementById('temp-value'),
      maxTokens: document.getElementById('setting-max-tokens'),
      folderList: document.getElementById('folder-list'),
      connectionResult: document.getElementById('connection-result'),
      scanResult: document.getElementById('scan-result'),
      // Browser modal
      browserModal: document.getElementById('folder-browser-modal'),
      browserList: document.getElementById('browser-list'),
      browserPath: document.getElementById('browser-current-path'),
      browserSelectBtn: document.getElementById('btn-browser-select'),
      browserSelectedLabel: document.getElementById('browser-selected-label'),
    };

    this.browserCurrentPath = '';
    this.browserSelectedPath = '';

    // Provider change → update URL
    this.els.provider.addEventListener('change', () => {
      const val = this.els.provider.value;
      if (val === 'ollama') this.els.baseUrl.value = 'http://localhost:11434';
      else if (val === 'lmstudio') this.els.baseUrl.value = 'http://localhost:1234';
      this.save();
    });

    this.els.temperature.addEventListener('input', () => {
      this.els.tempValue.textContent = this.els.temperature.value;
    });
    this.els.temperature.addEventListener('change', () => this.save());
    this.els.maxTokens.addEventListener('change', () => this.save());

    // Panel buttons
    document.getElementById('btn-settings').addEventListener('click', () => this.open());
    document.getElementById('btn-close-settings').addEventListener('click', () => this.close());
    this.els.overlay.addEventListener('click', () => this.close());
    document.getElementById('btn-test-connection').addEventListener('click', () => this.testConnection());
    document.getElementById('btn-clear-data').addEventListener('click', () => this.clearData());

    // Folder buttons
    document.getElementById('btn-add-folder').addEventListener('click', () => this.openBrowser());
    document.getElementById('btn-scan-all').addEventListener('click', () => this.scanFolders());

    // Browser modal buttons
    document.getElementById('btn-close-browser').addEventListener('click', () => this.closeBrowser());
    document.getElementById('btn-browser-up').addEventListener('click', () => this.browserNavigateUp());
    this.els.browserSelectBtn.addEventListener('click', () => this.browserConfirmSelect());
    this.els.browserModal.addEventListener('click', (e) => {
      if (e.target === this.els.browserModal) this.closeBrowser();
    });

    this.load();
  },

  async load() {
    try {
      const s = await API.getSettings();
      this.els.provider.value = s.provider || 'ollama';
      this.els.baseUrl.value = s.baseUrl || 'http://localhost:11434';
      this.els.temperature.value = s.temperature ?? 0.7;
      this.els.tempValue.textContent = s.temperature ?? 0.7;
      this.els.maxTokens.value = s.maxContextTokens || 8192;
      this.folderPaths = s.folderPaths || [];
      this.renderFolderList();
      if (s.baseUrl) this.checkConnection(s.baseUrl, s.model);
    } catch (err) { console.error('Failed to load settings:', err); }
  },

  async save() {
    try {
      await API.saveSettings({
        provider: this.els.provider.value, baseUrl: this.els.baseUrl.value,
        model: this.els.model.value, temperature: parseFloat(this.els.temperature.value),
        maxContextTokens: parseInt(this.els.maxTokens.value), folderPaths: this.folderPaths
      });
    } catch (err) { App.toast('Failed to save settings', 'error'); }
  },

  open() { this.els.overlay.classList.add('open'); this.els.panel.classList.add('open'); },
  close() { this.els.overlay.classList.remove('open'); this.els.panel.classList.remove('open'); this.save(); },

  // ─── Folder List Management ────────────────────────────────────
  renderFolderList() {
    const list = this.els.folderList;
    list.innerHTML = '';

    if (this.folderPaths.length === 0) {
      list.innerHTML = '<div class="folder-empty">No folders added yet. Click "Browse & Add Folder" below.</div>';
      return;
    }

    for (let i = 0; i < this.folderPaths.length; i++) {
      const fp = this.folderPaths[i];
      const chip = document.createElement('div');
      chip.className = 'folder-chip';
      chip.innerHTML = `
        <span class="folder-chip-icon">📁</span>
        <span class="folder-chip-path" title="${fp}">${fp}</span>
        <button class="folder-chip-remove" title="Remove folder" data-index="${i}">✕</button>
      `;
      chip.querySelector('.folder-chip-remove').addEventListener('click', (e) => {
        e.stopPropagation();
        this.removeFolder(parseInt(e.currentTarget.dataset.index));
      });
      list.appendChild(chip);
    }
  },

  addFolder(folderPath) {
    if (this.folderPaths.includes(folderPath)) {
      App.toast('Folder already added', 'info');
      return;
    }
    this.folderPaths.push(folderPath);
    this.renderFolderList();
    this.save();
    App.toast('Folder added: ' + folderPath.split('/').pop(), 'success');
  },

  removeFolder(index) {
    this.folderPaths.splice(index, 1);
    this.renderFolderList();
    this.save();
  },

  // ─── Folder Browser Modal ─────────────────────────────────────
  async openBrowser() {
    this.browserSelectedPath = '';
    this.els.browserSelectBtn.disabled = true;
    this.els.browserSelectedLabel.textContent = 'Select a folder above';
    this.els.browserModal.classList.add('open');
    await this.browserNavigateTo('');
  },

  closeBrowser() {
    this.els.browserModal.classList.remove('open');
  },

  async browserNavigateTo(dirPath) {
    this.els.browserList.innerHTML = '<div class="browser-empty"><span class="spinner"></span></div>';

    try {
      const data = await API.browseFolders(dirPath || undefined);
      this.browserCurrentPath = data.current;
      this.els.browserPath.textContent = data.current;
      this.els.browserPath.title = data.current;

      // Enable "Select This Folder" for the current directory
      this.browserSelectedPath = data.current;
      this.els.browserSelectBtn.disabled = false;
      this.els.browserSelectedLabel.textContent = data.current;

      this.els.browserList.innerHTML = '';

      if (data.directories.length === 0) {
        this.els.browserList.innerHTML = '<div class="browser-empty">No subdirectories here</div>';
        return;
      }

      for (const dir of data.directories) {
        const item = document.createElement('div');
        item.className = 'browser-dir-item';
        item.innerHTML = `
          <span class="dir-icon">📁</span>
          <span class="dir-name">${dir.name}</span>
          <span class="dir-enter">→</span>
        `;

        // Single click = select, double click = navigate into
        item.addEventListener('click', () => {
          // Deselect all others
          this.els.browserList.querySelectorAll('.browser-dir-item').forEach(el => el.classList.remove('selected'));
          item.classList.add('selected');
          this.browserSelectedPath = dir.path;
          this.els.browserSelectBtn.disabled = false;
          this.els.browserSelectedLabel.textContent = dir.path;
        });

        item.addEventListener('dblclick', () => {
          this.browserNavigateTo(dir.path);
        });

        this.els.browserList.appendChild(item);
      }
    } catch (err) {
      this.els.browserList.innerHTML = `<div class="browser-empty" style="color:var(--error)">Error: ${err.message}</div>`;
    }
  },

  browserNavigateUp() {
    if (!this.browserCurrentPath || this.browserCurrentPath === '/') return;
    const parent = this.browserCurrentPath.split('/').slice(0, -1).join('/') || '/';
    this.browserNavigateTo(parent);
  },

  browserConfirmSelect() {
    if (!this.browserSelectedPath) return;
    this.addFolder(this.browserSelectedPath);
    this.closeBrowser();
  },

  // ─── Scan All Folders ─────────────────────────────────────────
  async scanFolders() {
    if (!this.folderPaths.length) {
      this.showResult('scan', 'error', 'Add at least one folder first');
      return;
    }
    const btn = document.getElementById('btn-scan-all');
    btn.innerHTML = '<span class="spinner"></span> Scanning...'; btn.disabled = true;
    try {
      const r = await API.scanFolders(this.folderPaths);
      if (r.success) {
        this.showResult('scan', 'success', `✅ Found ${r.totalFiles} files, parsed ${r.parsedFiles}.`);
        App.renderFileList(r.files);
        App.toast(`Loaded ${r.parsedFiles} documents from ${this.folderPaths.length} folder(s)`, 'success');
      } else { this.showResult('scan', 'error', `❌ ${r.error}`); }
    } catch (err) {
      let msg = err.message;
      try { msg = JSON.parse(msg).error || msg; } catch(e) {}
      this.showResult('scan', 'error', `❌ ${msg}`);
    }
    btn.innerHTML = '🔄 Scan All'; btn.disabled = false;
  },

  // ─── Connection ───────────────────────────────────────────────
  async testConnection() {
    const baseUrl = this.els.baseUrl.value.trim();
    if (!baseUrl) { this.showResult('connection', 'error', 'Please enter a base URL'); return; }
    const btn = document.getElementById('btn-test-connection');
    btn.innerHTML = '<span class="spinner"></span>'; btn.disabled = true;
    try {
      const r = await API.testConnection(baseUrl);
      if (r.connected) {
        this.showResult('connection', 'success', `✅ Connected! Found ${r.models.length} model(s).`);
        this.populateModels(r.models);
        App.setConnectionStatus(true, this.els.model.value || 'Connected');
        this.save();
      } else {
        this.showResult('connection', 'error', `❌ ${r.error}`);
        App.setConnectionStatus(false);
      }
    } catch (err) { this.showResult('connection', 'error', `❌ ${err.message}`); App.setConnectionStatus(false); }
    btn.innerHTML = 'Test'; btn.disabled = false;
  },

  async checkConnection(baseUrl, currentModel) {
    try {
      const r = await API.testConnection(baseUrl);
      if (r.connected) {
        this.populateModels(r.models, currentModel);
        App.setConnectionStatus(true, currentModel || r.models[0]?.id || 'Connected');
      } else { App.setConnectionStatus(false); }
    } catch (err) { App.setConnectionStatus(false); }
  },

  populateModels(models, currentModel) {
    const s = this.els.model;
    s.innerHTML = '';
    if (!models.length) { s.innerHTML = '<option value="">No models available</option>'; return; }
    for (const m of models) {
      const o = document.createElement('option');
      o.value = m.id; o.textContent = m.id;
      if (m.id === currentModel) o.selected = true;
      s.appendChild(o);
    }
    if (!currentModel && models.length) s.value = models[0].id;
    s.addEventListener('change', () => { this.save(); App.setConnectionStatus(true, s.value); });
  },

  showResult(type, cls, msg) {
    const el = type === 'connection' ? this.els.connectionResult : this.els.scanResult;
    el.className = 'connection-result ' + cls;
    el.textContent = msg;
    el.style.display = msg ? 'block' : 'none';
  },

  clearData() {
    if (!confirm('Clear all settings and reload?')) return;
    API.post('/api/settings', { provider:'ollama', baseUrl:'http://localhost:11434', model:'', folderPaths:[], maxContextTokens:8192, temperature:0.7 }).then(() => window.location.reload());
  }
};
