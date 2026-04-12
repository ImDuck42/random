import { GitHubDB } from './github-db.js';

// ═══ KONFIGURATION ════════════════════════════════════════════════════════════

const CONFIG = {
  owner:          'ImDuck42',
  repo:           'random',
  useRaw:         true,
  rawBranches:    ['main', 'master', 'refs/heads/main', 'HEAD'],
  publicTokens:   ['ghdb_enc_ICEwKjIqGzImPBtzdgoFcBQOcAN3PAsNKxAmNyQmJXA1FzI3ACAnBQgYITg/BgM6CwAXKCYAfAUFcRwYFhwSFHYpAnYDBR40ASwsFQAdCxtyGwAMcgAqExYRfQc2'],
  defaultUser:    { username: 'theodizee_gast', password: 'gast_zugang' },
  collectionName: 'kommentare',
};

// ═══ STYLES ═══════════════════════════════════════════════════════════════════

const COMMENTS_CSS = `
#comments .comments-container {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  gap: 16px;
  padding-bottom: 8px;
}

#comments .comments-list {
  flex: 1;
  overflow-y: auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding-right: 8px;

  &::-webkit-scrollbar       { width: 6px; }
  &::-webkit-scrollbar-track { background: transparent; }
  &::-webkit-scrollbar-thumb { background-color: var(--surface1); border-radius: 3px; }
}

#comments .comment-item {
  background-color: var(--mantle);
  border: 1px solid var(--surface0);
  border-radius: 10px;
  padding: 16px;
  animation: fadeIn 0.3s ease;

  .comment-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 8px;
    padding-bottom: 8px;
    border-bottom: 1px solid var(--surface0);
  }

  .comment-author {
    display: flex;
    align-items: center;
    gap: 8px;
    font-weight: 600;
    font-size: 14px;
    color: var(--lavender);

    &::before {
      content: '◆';
      font-size: 10px;
      color: var(--green);
    }
  }

  .comment-date {
    font-size: 12px;
    color: var(--overlay1);
  }

  .comment-content {
    color: var(--text);
    font-size: 14px;
    line-height: 1.6;
    white-space: pre-wrap;
    word-wrap: break-word;

    a {
      color: var(--lavender);
      text-decoration: underline;
      text-underline-offset: 3px;
      word-break: break-all;

      &:hover { color: var(--text); }
    }
  }
}

#comments .comment-empty {
  padding: 40px;
  text-align: center;
  font-style: italic;
  color: var(--overlay1);
}

#comments .comment-form {
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 16px;
  background-color: var(--mantle);
  border: 1px solid var(--surface0);
  border-radius: 10px;

  .comment-form-header {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 14px;
    font-weight: 600;
    color: var(--subtext1);

    &::before {
      content: '✎';
      color: var(--peach);
    }
  }

  .comment-textarea {
    min-height: 80px;
    padding: 12px;
    resize: vertical;
    outline: none;
    font-family: inherit;
    font-size: 14px;
    color: var(--text);
    background-color: var(--base);
    border: 1px solid var(--surface0);
    border-radius: 8px;
    transition: border-color 0.2s;

    &:focus        { border-color: var(--lavender); }
    &::placeholder { color: var(--overlay0); }

    &::-webkit-scrollbar       { width: 6px; }
    &::-webkit-scrollbar-track { background: transparent; }
    &::-webkit-scrollbar-thumb { background-color: var(--surface1); border-radius: 3px; }

  }

  .comment-form-footer {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .comment-submit {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 20px;
    font-family: inherit;
    font-size: 14px;
    font-weight: 500;
    color: var(--text);
    background-color: var(--surface1);
    border: 1px solid var(--surface2);
    border-radius: 8px;
    cursor: pointer;
    transition: background-color 0.2s, color 0.2s, border-color 0.2s;

    &:hover    { background-color: var(--lavender); color: var(--crust); border-color: var(--lavender); }
    &:disabled { opacity: 0.5; cursor: not-allowed; }
  }

  .comment-status {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 12px;
    color: var(--overlay1);

    &.loading::before { content: '◉'; color: var(--peach); animation: spin 1s linear infinite; }
    &.success::before { content: '✓'; color: var(--green); }
  }
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to   { transform: rotate(360deg); }
}
`;
// ═══ TEMPLATES ════════════════════════════════════════════════════════════════

const FORM_HTML = `
  <h1 class="header">Kommentare</h1>
  <div class="comments-container">
    <div class="comments-list" id="comments-list">
      <div class="comment-empty">Lade Kommentare…</div>
    </div>
    <form class="comment-form" id="comment-form">
      <div class="comment-form-header">Neuer Kommentar</div>
      <textarea
        class="comment-textarea"
        id="comment-input"
        placeholder="Teile deine Gedanken zur Theodizee-Frage…"
        required
      ></textarea>
      <div class="comment-form-footer">
        <span class="comment-status" id="comment-status">Angemeldet als Gast — Es kann eine weile dauern, bis neue Kommentare reflektiert werden</span>
        <button type="submit" class="comment-submit" id="submit-btn">Kommentieren</button>
      </div>
    </form>
  </div>
`;

// ═══ HILFSFUNKTIONEN ══════════════════════════════════════════════════════════

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

const URL_REGEX = /https?:\/\/[^\s<>"']+/g;

function linkify(text) {
  return escapeHtml(text).replace(URL_REGEX, url =>
    `<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`
  );
}

function formatDate(isoString) {
  return new Date(isoString).toLocaleString('de-DE', {
    day:    '2-digit',
    month:  '2-digit',
    year:   'numeric',
    hour:   '2-digit',
    minute: '2-digit',
  });
}

function renderCommentItem({ author, createdAt, content }) {
  return `
    <div class="comment-item">
      <div class="comment-header">
        <span class="comment-author">${escapeHtml(author || 'Gast')}</span>
        <span class="comment-date">${formatDate(createdAt)}</span>
      </div>
      <div class="comment-content">${linkify(content)}</div>
    </div>`;
}

// ═══ MODUL ════════════════════════════════════════════════════════════════════

class CommentsModule {
  db       = null;
  comments = [];
  icon     = null;
  section  = null;

  constructor() {
    this.init();
  }

  // ── Setup ────────────────────────────────────────────────────────────────

  injectStyles() {
    const style = document.createElement('style');
    style.textContent = COMMENTS_CSS;
    document.head.appendChild(style);
  }

  injectHTML() {
    const navBottom   = document.querySelector('.nav-bottom');
    const pageContent = document.querySelector('.page-content');
    if (!navBottom || !pageContent) return;

    this.icon = Object.assign(document.createElement('i'), {
      className: 'fa-solid fa-comments',
      title:     'Kommentare',
    });
    this.icon.setAttribute('data-tab', 'comments');
    navBottom.appendChild(this.icon);

    this.section = Object.assign(document.createElement('section'), {
      className: 'content-section',
      id:        'comments',
      innerHTML: FORM_HTML,
    });
    pageContent.appendChild(this.section);
  }

  setupTabSwitching() {
    const allTabs     = () => document.querySelectorAll('.nav-bar .fa-solid');
    const allSections = () => document.querySelectorAll('.content-section');

    this.icon.addEventListener('click', (e) => {
      e.stopImmediatePropagation();
      allTabs().forEach(t => t.classList.remove('active'));
      allSections().forEach(s => s.classList.remove('active'));
      this.icon.classList.add('active');
      this.section.classList.add('active');
      this.loadComments();
    });

    allTabs().forEach(tab => {
      if (tab === this.icon) return;
      tab.addEventListener('click', () => {
        this.icon.classList.remove('active');
        this.section.classList.remove('active');
      });
    });
  }

  setupEventListeners() {
    document.getElementById('comment-form')?.addEventListener('submit', (e) => {
      e.preventDefault();
      this.submitComment(document.getElementById('comment-input').value);
    });
  }

  // ── Datenbank ────────────────────────────────────────────────────────────

  async initDB() {
    try {
      this.db = await GitHubDB.public({
        owner:        CONFIG.owner,
        repo:         CONFIG.repo,
        rawBranches:  CONFIG.rawBranches,
        publicTokens: CONFIG.publicTokens,
        useRaw:       CONFIG.useRaw,
      });

      this.db.permissions({
        [CONFIG.collectionName]: { read: 'public', write: 'auth' },
      });
    } catch (err) {
      console.error('Datenbankinitialisierung fehlgeschlagen:', err);
      this.setStatus('Datenbankfehler');
    }
  }

  async setupDefaultAccount() {
    if (!this.db) return;
    const { username, password } = CONFIG.defaultUser;

    try {
      await this.db.auth.login(username, password);
    } catch {
      try {
        await this.db.auth.register(username, password);
      } catch (err) {
        console.error('Authentifizierung fehlgeschlagen:', err);
        this.setStatus('Authentifizierungsfehler');
      }
    }
  }

  // ── Kommentare ───────────────────────────────────────────────────────────

  async loadComments() {
    if (!this.db) return;

    const list = document.getElementById('comments-list');
    list.innerHTML = '<div class="comment-empty">Lade Kommentare…</div>';

    try {
      const raw = await this.db.collection(CONFIG.collectionName).list();
      this.comments = raw.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      this.renderComments();
    } catch (err) {
      console.error('Kommentare konnten nicht geladen werden:', err);
      list.innerHTML = '<div class="comment-empty">Fehler beim Laden der Kommentare.</div>';
    }
  }

  renderComments() {
    const list = document.getElementById('comments-list');
    list.innerHTML = this.comments.length
      ? this.comments.map(renderCommentItem).join('')
      : '<div class="comment-empty">Noch keine Kommentare – schreib den ersten!</div>';
  }

  async submitComment(content) {
    if (!this.db || !content.trim()) return;

    const submitBtn = document.getElementById('submit-btn');
    submitBtn.disabled = true;
    this.setStatus('Wird gesendet…', 'loading');

    try {
      await this.db.collection(CONFIG.collectionName).add({
        content:   content.trim(),
        author:    this.db.auth.currentUser?.username ?? CONFIG.defaultUser.username,
        createdAt: new Date().toISOString(),
      });

      this.setStatus('Gesendet!', 'success');
      setTimeout(() => this.setStatus('Angemeldet als Gast'), 2000);
      document.getElementById('comment-input').value = '';
      await this.loadComments();
    } catch (err) {
      console.error('Kommentar konnte nicht gesendet werden:', err);
      this.setStatus('Fehler beim Senden');
    } finally {
      submitBtn.disabled = false;
    }
  }

  // ── Hilfsmethoden ────────────────────────────────────────────────────────

  setStatus(msg, type = '') {
    const el = document.getElementById('comment-status');
    if (!el) return;
    el.textContent = msg;
    el.className = `comment-status${type ? ` ${type}` : ''}`;
  }

  // ── Initialisierung ──────────────────────────────────────────────────────

  async init() {
    this.injectStyles();
    this.injectHTML();
    this.setupTabSwitching();
    this.setupEventListeners();
    await this.initDB();
    await this.setupDefaultAccount();
    await this.loadComments();
  }
}

// ═══ START ════════════════════════════════════════════════════════════════════

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => new CommentsModule());
} else {
  new CommentsModule();
}