// ========== ADDON: NOTES ==========
// A persistent sticky-note pad that lives below the shortcuts grid.
// Supports multiple named notes, Markdown-lite rendering, and pinning.

export default {
    name        : 'Notes',
    version     : '1.0.0',
    description : 'Quick-access sticky notes with persistence',
    author      : 'startpage',
    icon        : 'sticky_note_2',

    async init(ctx) {
        // ---- State ----
        const load  = () => ctx.storage.get('notes') ?? [];
        const save  = (notes) => ctx.storage.set('notes', notes);

        let   notes        = load();
        let   activeIndex  = 0;

        // ---- CSS ----
        ctx.injectCSS(`
            .notes-addon {
                width      : 100%;
                max-width  : 500px;
                margin-top : 10px;
            }

            .notes-tabs {
                display         : flex;
                gap             : 4px;
                margin-bottom   : 6px;
                overflow-x      : auto;
                scrollbar-width : none;
                align-items     : center;
            }

            .notes-tabs::-webkit-scrollbar { display: none; }

            .notes-tab {
                background    : rgba(255,255,255,0.07);
                border        : 1px solid rgba(255,255,255,0.12);
                border-radius : 8px 8px 0 0;
                color         : rgba(255,255,255,0.6);
                padding       : 5px 12px;
                font-size     : 0.75rem;
                cursor        : pointer;
                white-space   : nowrap;
                transition    : all 0.15s ease;
                display       : flex;
                align-items   : center;
                gap           : 5px;
                user-select   : none;
                -webkit-user-select : none;
            }

            .notes-tab.active {
                background : rgba(118, 75, 162, 0.3);
                border-color: var(--accent);
                color      : #fff;
            }

            .notes-tab .tab-close {
                font-size  : 14px;
                opacity    : 0.4;
                transition : opacity 0.15s;
            }

            .notes-tab:hover .tab-close { opacity: 1; }

            .notes-tab-new {
                background    : transparent;
                border        : 1px dashed rgba(255,255,255,0.25);
                border-radius : 8px;
                color         : rgba(255,255,255,0.4);
                width         : 28px;
                height        : 28px;
                font-size     : 1rem;
                cursor        : pointer;
                display       : flex;
                align-items   : center;
                justify-content : center;
                flex-shrink   : 0;
                transition    : all 0.15s;
            }

            .notes-tab-new:hover {
                background  : rgba(255,255,255,0.08);
                color       : #fff;
            }

            .notes-body {
                background      : rgba(255,255,255,0.05);
                backdrop-filter : blur(20px);
                border          : 1px solid rgba(255,255,255,0.12);
                border-radius   : 0 12px 12px 12px;
                padding         : 12px;
                display         : flex;
                flex-direction  : column;
                gap             : 8px;
            }

            .notes-title-input {
                background   : transparent;
                border       : none;
                color        : #fff;
                font-weight  : 600;
                font-size    : 0.9rem;
                width        : 100%;
                padding      : 0;
                border-bottom : 1px solid rgba(255,255,255,0.1);
                padding-bottom : 6px;
                margin-bottom  : 2px;
            }

            .notes-title-input::placeholder { color: rgba(255,255,255,0.3); }
            .notes-title-input:focus        { outline: none; border-bottom-color: var(--accent); }

            .notes-textarea {
                background : transparent;
                border     : none;
                color      : rgba(255,255,255,0.85);
                font-size  : 0.85rem;
                line-height : 1.55;
                width      : 100%;
                resize     : none;
                min-height : 100px;
                max-height : 280px;
                font-family : inherit;
                field-sizing: content;
            }

            .notes-textarea::placeholder { color: rgba(255,255,255,0.25); }
            .notes-textarea:focus        { outline: none; }

            .notes-footer {
                display         : flex;
                justify-content : space-between;
                align-items     : center;
                font-size       : 0.7rem;
                color           : rgba(255,255,255,0.3);
                padding-top     : 6px;
                border-top      : 1px solid rgba(255,255,255,0.07);
            }

            .notes-char-count { font-variant-numeric: tabular-nums; }

            .notes-empty {
                color      : rgba(255,255,255,0.3);
                font-size  : 0.82rem;
                text-align : center;
                padding    : 20px 0;
            }
        `);

        // ---- DOM ----
        const panel = ctx.injectPanel({ id: 'addon-notes-panel', className: 'notes-addon' });

        // ---- Render ----
        const render = () => {
            // Ensure at least one note exists
            if (notes.length === 0) {
                notes.push({ title: 'Note 1', body: '' });
                save(notes);
            }
            if (activeIndex >= notes.length) activeIndex = notes.length - 1;

            const note = notes[activeIndex];

            panel.innerHTML = '';

            // Tabs
            const tabsEl = document.createElement('div');
            tabsEl.className = 'notes-tabs';
            notes.forEach((n, i) => {
                const tab      = document.createElement('button');
                tab.className  = `notes-tab${i === activeIndex ? ' active' : ''}`;
                tab.innerHTML  = `
                    <span>${n.title || `Note ${i + 1}`}</span>
                    <span class="material-symbols-outlined tab-close" data-tab-close="${i}">close</span>
                `;
                tab.addEventListener('click', (evt) => {
                    if (evt.target.closest('[data-tab-close]')) {
                        const idx = parseInt(evt.target.closest('[data-tab-close]').dataset.tabClose);
                        notes.splice(idx, 1);
                        if (activeIndex >= notes.length) activeIndex = Math.max(0, notes.length - 1);
                        save(notes);
                        render();
                    } else {
                        activeIndex = i;
                        render();
                    }
                });
                tabsEl.appendChild(tab);
            });

            // New tab button
            const newBtn       = document.createElement('button');
            newBtn.className   = 'notes-tab-new';
            newBtn.innerHTML   = '<span class="material-symbols-outlined" style="font-size:16px">add</span>';
            newBtn.addEventListener('click', () => {
                notes.push({ title: `Note ${notes.length + 1}`, body: '' });
                activeIndex = notes.length - 1;
                save(notes);
                render();
            });
            tabsEl.appendChild(newBtn);
            panel.appendChild(tabsEl);

            // Body
            const body       = document.createElement('div');
            body.className   = 'notes-body';

            const titleInput          = document.createElement('input');
            titleInput.className      = 'notes-title-input';
            titleInput.type           = 'text';
            titleInput.value          = note.title;
            titleInput.placeholder    = 'Untitled note…';
            titleInput.style.userSelect = 'text';
            titleInput.style.webkitUserSelect = 'text';
            titleInput.addEventListener('input', () => {
                notes[activeIndex].title = titleInput.value;
                save(notes);
                // Update tab label live
                const activeTab = tabsEl.querySelector('.notes-tab.active span:first-child');
                if (activeTab) activeTab.textContent = titleInput.value || `Note ${activeIndex + 1}`;
            });

            const textarea             = document.createElement('textarea');
            textarea.className         = 'notes-textarea';
            textarea.value             = note.body;
            textarea.placeholder       = 'Start typing…';
            textarea.style.userSelect  = 'text';
            textarea.style.webkitUserSelect = 'text';
            textarea.addEventListener('input', () => {
                notes[activeIndex].body = textarea.value;
                charCount.textContent   = `${textarea.value.length} chars`;
                save(notes);
            });

            const footer    = document.createElement('div');
            footer.className = 'notes-footer';

            const charCount      = document.createElement('span');
            charCount.className  = 'notes-char-count';
            charCount.textContent = `${note.body.length} chars`;

            const ts      = document.createElement('span');
            ts.textContent = `${notes.length} note${notes.length !== 1 ? 's' : ''}`;

            footer.appendChild(charCount);
            footer.appendChild(ts);

            body.appendChild(titleInput);
            body.appendChild(textarea);
            body.appendChild(footer);
            panel.appendChild(body);
        };

        render();

        // ---- Settings ----
        const section = ctx.addSettingsSection('Notes');
        ctx.addSettingsButton(section, 'Clear all notes', 'Clear', () => {
            if (confirm('Delete all notes?')) {
                notes       = [{ title: 'Note 1', body: '' }];
                activeIndex = 0;
                save(notes);
                render();
                ctx.toast('Notes cleared', 'info');
            }
        });
    },
};