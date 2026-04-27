/**
 * App Module — main application controller
 */
const App = {
  init() {
    Chat.init();
    Settings.init();
    this.bindEvents();
    this.loadFiles();
  },

  bindEvents() {
    // Sidebar toggle
    document.getElementById('btn-toggle-sidebar').addEventListener('click', () => this.toggleSidebar());
    document.getElementById('btn-show-sidebar').addEventListener('click', () => this.toggleSidebar());

    // New chat
    document.getElementById('btn-new-chat').addEventListener('click', () => Chat.clear());

    // Report
    document.getElementById('btn-report').addEventListener('click', () => Chat.generateReport());

    // Rescan
    document.getElementById('btn-rescan').addEventListener('click', () => Settings.scanFolders());

    // Modal close
    document.getElementById('btn-close-modal').addEventListener('click', () => this.closeModal());
    document.getElementById('file-modal').addEventListener('click', (e) => {
      if (e.target.id === 'file-modal') this.closeModal();
    });

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        this.closeModal();
        Settings.close();
      }
    });
  },

  toggleSidebar() {
    const sidebar = document.getElementById('sidebar');
    const showBtn = document.getElementById('btn-show-sidebar');
    sidebar.classList.toggle('collapsed');
    showBtn.style.display = sidebar.classList.contains('collapsed') ? 'flex' : 'none';
  },

  setConnectionStatus(connected, modelName) {
    const dot = document.getElementById('status-dot');
    const text = document.getElementById('status-text');
    dot.className = 'status-dot ' + (connected ? 'connected' : 'disconnected');
    text.textContent = connected ? (modelName || 'Connected') : 'Disconnected';
  },

  async loadFiles() {
    try {
      const data = await API.getFiles();
      if (data.files && data.files.length > 0) {
        this.renderFileList(data.files);
      }
    } catch (err) { /* silent */ }
  },

  renderFileList(files) {
    const list = document.getElementById('file-list');
    const empty = document.getElementById('file-empty-state');

    if (!files || files.length === 0) {
      list.innerHTML = '';
      list.appendChild(empty);
      empty.style.display = '';
      this.updateStats(0, 0);
      return;
    }

    if (empty) empty.style.display = 'none';
    list.innerHTML = '';

    let totalWords = 0;
    for (const file of files) {
      totalWords += file.wordCount || 0;
      const item = document.createElement('div');
      item.className = 'file-item';
      item.innerHTML = `
        <div class="file-icon ${file.type.toLowerCase()}">${this.getFileIcon(file.type)}</div>
        <div class="file-info">
          <div class="file-name" title="${file.name}">${file.name}</div>
          <div class="file-meta">${file.sizeFormatted}${file.wordCount ? ' · ' + file.wordCount.toLocaleString() + ' words' : ''}</div>
        </div>
        <div class="file-status ${file.parsed ? 'parsed' : (file.parseError ? 'error' : 'pending')}" title="${file.parseError || (file.parsed ? 'Parsed' : 'Pending')}"></div>
      `;
      item.addEventListener('click', () => this.previewFile(file.name));
      list.appendChild(item);
    }

    this.updateStats(files.length, totalWords);
  },

  getFileIcon(type) {
    switch(type) { case 'PDF': return 'PDF'; case 'Excel': return 'XLS'; case 'CSV': return 'CSV'; default: return '📄'; }
  },

  updateStats(fileCount, wordCount) {
    document.getElementById('stat-files').textContent = fileCount;
    document.getElementById('stat-words').textContent = wordCount > 1000 ? Math.round(wordCount/1000) + 'K' : wordCount;
  },

  async previewFile(filename) {
    try {
      const doc = await API.getFileContent(filename);
      document.getElementById('modal-title').textContent = filename;
      document.getElementById('modal-body').textContent = doc.content || 'No content extracted.';
      document.getElementById('file-modal').classList.add('open');
    } catch (err) {
      this.toast('Could not load file preview', 'error');
    }
  },

  closeModal() {
    document.getElementById('file-modal').classList.remove('open');
  },

  toast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => { toast.style.opacity = '0'; setTimeout(() => toast.remove(), 300); }, 4000);
  }
};

// Boot
document.addEventListener('DOMContentLoaded', () => App.init());
