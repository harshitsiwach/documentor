/**
 * Chat Module — handles message rendering, input, and streaming
 */
const Chat = {
  messages: [],
  isStreaming: false,
  currentController: null,
  els: {},

  init() {
    this.els = {
      container: document.getElementById('chat-messages'),
      input: document.getElementById('chat-input'),
      sendBtn: document.getElementById('send-btn'),
      welcome: document.getElementById('welcome-screen')
    };

    // Input handling
    this.els.input.addEventListener('input', () => this.handleInput());
    this.els.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this.send();
      }
    });
    this.els.sendBtn.addEventListener('click', () => this.send());

    // Quick actions
    document.querySelectorAll('.quick-action').forEach(btn => {
      btn.addEventListener('click', () => {
        const action = btn.dataset.action;
        if (action === 'settings') Settings.open();
        else if (action === 'report') this.generateReport();
        else if (action === 'summarize') {
          this.els.input.value = 'Please summarize all the documents in the folder.';
          this.send();
        }
      });
    });
  },

  handleInput() {
    const textarea = this.els.input;
    textarea.style.height = 'auto';
    textarea.style.height = Math.min(textarea.scrollHeight, 120) + 'px';
    this.els.sendBtn.disabled = !textarea.value.trim() || this.isStreaming;
  },

  send() {
    const text = this.els.input.value.trim();
    if (!text || this.isStreaming) return;

    // Hide welcome screen
    if (this.els.welcome) {
      this.els.welcome.style.display = 'none';
    }

    // Add user message
    this.addMessage('user', text);
    this.els.input.value = '';
    this.els.input.style.height = 'auto';
    this.els.sendBtn.disabled = true;

    // Start streaming response
    this.streamResponse(text);
  },

  addMessage(role, content) {
    const msg = { role, content };
    this.messages.push(msg);
    this.renderMessage(msg);
    return msg;
  },

  renderMessage(msg) {
    const div = document.createElement('div');
    div.className = `message ${msg.role}`;

    const avatar = document.createElement('div');
    avatar.className = 'message-avatar';
    avatar.textContent = msg.role === 'user' ? '👤' : '🤖';

    const content = document.createElement('div');
    content.className = 'message-content';
    content.innerHTML = this.renderMarkdown(msg.content);

    div.appendChild(avatar);
    div.appendChild(content);
    this.els.container.appendChild(div);
    this.scrollToBottom();
    return content;
  },

  streamResponse(userMessage) {
    this.isStreaming = true;

    // Create assistant message placeholder
    const div = document.createElement('div');
    div.className = 'message assistant';

    const avatar = document.createElement('div');
    avatar.className = 'message-avatar';
    avatar.textContent = '🤖';

    const content = document.createElement('div');
    content.className = 'message-content';
    content.innerHTML = '<div class="typing-indicator"><span></span><span></span><span></span></div>';

    div.appendChild(avatar);
    div.appendChild(content);
    this.els.container.appendChild(div);
    this.scrollToBottom();

    let fullResponse = '';
    let firstChunk = true;

    // Build history (exclude the last user message since it's sent separately)
    const history = this.messages.slice(0, -1).map(m => ({
      role: m.role,
      content: m.content
    }));

    this.currentController = API.streamChat(
      userMessage,
      history,
      // onChunk
      (chunk) => {
        if (firstChunk) {
          content.innerHTML = '';
          firstChunk = false;
        }
        fullResponse += chunk;
        content.innerHTML = this.renderMarkdown(fullResponse);
        this.scrollToBottom();
      },
      // onDone
      () => {
        this.isStreaming = false;
        this.currentController = null;
        this.els.sendBtn.disabled = !this.els.input.value.trim();
        if (fullResponse) {
          this.messages.push({ role: 'assistant', content: fullResponse });
        }
        if (firstChunk) {
          content.innerHTML = '<em style="color:var(--text-muted)">No response received. Check your LLM connection.</em>';
        }
      },
      // onError
      (error) => {
        this.isStreaming = false;
        this.currentController = null;
        this.els.sendBtn.disabled = !this.els.input.value.trim();
        content.innerHTML = `<em style="color:var(--error)">Error: ${error}</em>`;
        App.toast(error, 'error');
      }
    );
  },

  generateReport() {
    if (this.isStreaming) return;

    if (this.els.welcome) {
      this.els.welcome.style.display = 'none';
    }

    this.addMessage('user', '📊 Generate a comprehensive analysis report of all documents.');
    this.isStreaming = true;

    const div = document.createElement('div');
    div.className = 'message assistant';

    const avatar = document.createElement('div');
    avatar.className = 'message-avatar';
    avatar.textContent = '🤖';

    const content = document.createElement('div');
    content.className = 'message-content';
    content.innerHTML = '<div class="typing-indicator"><span></span><span></span><span></span></div>';

    div.appendChild(avatar);
    div.appendChild(content);
    this.els.container.appendChild(div);
    this.scrollToBottom();

    let fullResponse = '';
    let firstChunk = true;

    this.currentController = API.streamReport(
      (chunk) => {
        if (firstChunk) { content.innerHTML = ''; firstChunk = false; }
        fullResponse += chunk;
        content.innerHTML = this.renderMarkdown(fullResponse);
        this.scrollToBottom();
      },
      () => {
        this.isStreaming = false;
        this.currentController = null;
        this.els.sendBtn.disabled = !this.els.input.value.trim();
        if (fullResponse) this.messages.push({ role: 'assistant', content: fullResponse });
        if (firstChunk) content.innerHTML = '<em style="color:var(--text-muted)">No response. Check connection.</em>';
      },
      (error) => {
        this.isStreaming = false;
        this.currentController = null;
        this.els.sendBtn.disabled = !this.els.input.value.trim();
        content.innerHTML = `<em style="color:var(--error)">Error: ${error}</em>`;
        App.toast(error, 'error');
      }
    );
  },

  clear() {
    this.messages = [];
    this.els.container.innerHTML = '';
    if (this.els.welcome) {
      this.els.welcome.style.display = '';
      this.els.container.appendChild(this.els.welcome);
    }
    if (this.currentController) {
      this.currentController.abort();
      this.currentController = null;
      this.isStreaming = false;
    }
  },

  scrollToBottom() {
    requestAnimationFrame(() => {
      this.els.container.scrollTop = this.els.container.scrollHeight;
    });
  },

  /**
   * Simple markdown renderer
   */
  renderMarkdown(text) {
    if (!text) return '';
    let html = this.escapeHtml(text);

    // Code blocks (```...```)
    html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
      return `<pre><code class="language-${lang}">${code.trim()}</code></pre>`;
    });

    // Inline code
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

    // Bold
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');

    // Italic
    html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');

    // Headers
    html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
    html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
    html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');

    // Blockquotes
    html = html.replace(/^&gt; (.+)$/gm, '<blockquote>$1</blockquote>');

    // Unordered lists
    html = html.replace(/^[\-\*] (.+)$/gm, '<li>$1</li>');
    html = html.replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>');

    // Ordered lists
    html = html.replace(/^\d+\. (.+)$/gm, '<li>$1</li>');

    // Tables
    html = html.replace(/^(\|.+\|)\n(\|[\-\s|:]+\|)\n((?:\|.+\|\n?)*)/gm, (_, headerRow, sepRow, bodyRows) => {
      const headers = headerRow.split('|').filter(c => c.trim()).map(c => `<th>${c.trim()}</th>`).join('');
      const rows = bodyRows.trim().split('\n').map(row => {
        const cells = row.split('|').filter(c => c.trim()).map(c => `<td>${c.trim()}</td>`).join('');
        return `<tr>${cells}</tr>`;
      }).join('');
      return `<table><thead><tr>${headers}</tr></thead><tbody>${rows}</tbody></table>`;
    });

    // Horizontal rule
    html = html.replace(/^---$/gm, '<hr>');

    // Paragraphs (double newlines)
    html = html.replace(/\n\n/g, '</p><p>');
    html = '<p>' + html + '</p>';

    // Single newlines to <br> (but not inside pre/code blocks)
    html = html.replace(/(?<!<\/h[1-6]>|<\/li>|<\/tr>|<\/table>|<\/pre>|<\/blockquote>|<hr>|<\/ul>|<\/p>|<p>)\n/g, '<br>');

    // Clean up empty paragraphs
    html = html.replace(/<p>\s*<\/p>/g, '');
    html = html.replace(/<p>\s*(<h[1-6]>)/g, '$1');
    html = html.replace(/(<\/h[1-6]>)\s*<\/p>/g, '$1');
    html = html.replace(/<p>\s*(<pre>)/g, '$1');
    html = html.replace(/(<\/pre>)\s*<\/p>/g, '$1');
    html = html.replace(/<p>\s*(<table>)/g, '$1');
    html = html.replace(/(<\/table>)\s*<\/p>/g, '$1');
    html = html.replace(/<p>\s*(<ul>)/g, '$1');
    html = html.replace(/(<\/ul>)\s*<\/p>/g, '$1');
    html = html.replace(/<p>\s*(<hr>)/g, '$1');
    html = html.replace(/(<hr>)\s*<\/p>/g, '$1');

    return html;
  },

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
};
