import { byId, escapeHtml, formatTime, formatDuration, filterByQuery } from './utils.js';

// ── Channel Manager ───────────────────────────────────────
export class ChannelManager {
    constructor(db, toast, modal) {
        this.db              = db;
        this.toast           = toast;
        this.modal           = modal;
        this.channels        = [];
        this.songs           = [];
        this.playlists       = [];
        this.activeChannelId = null;

        // Callbacks injected by init.js
        this.onListenToChannel = null;
        this.onStopChannel     = null;

        byId('ch-search').oninput = event => {
            this.renderGrid(filterByQuery(this.channels, event.target.value, ['name', 'description']));
        };
        byId('ch-back-btn').onclick = () => this.closeDetail();
    }

    /** @param {object[]} songs */
    setSongsCache(songs)     { this.songs = songs; }
    /** @param {object[]} playlists */
    setPlaylistsCache(playlists) { this.playlists = playlists; }

    async load() {
        this.channels = await this.db.collection('channels').list().catch(() => []);
        const countEl = byId('ch-count');
        if (countEl) {
            countEl.textContent = `${this.channels.length} channel${this.channels.length !== 1 ? 's' : ''}`;
        }
        this.renderGrid(this.channels);
        return this.channels;
    }

    /** @param {object[]} channels */
    renderGrid(channels = this.channels) {
        const grid = byId('ch-grid');
        if (!channels.length) {
            grid.innerHTML = `
                <div class="empty-state large">
                    <i class="fa-solid fa-tower-broadcast" aria-hidden="true"></i>
                    <span>No channels available</span>
                </div>`;
            return;
        }

        grid.innerHTML = channels.map(channel => {
            const songs   = this.getSongsForChannel(channel);
            const totalMs = songs.reduce((acc, song) => acc + (song.duration_ms ?? 0), 0);
            const tags    = this.buildModeTags(channel);
            return `
            <div class="ch-card" data-id="${channel.id}" role="listitem" tabindex="0"
                 aria-label="Channel: ${escapeHtml(channel.name)}">
                <div class="ch-card-icon" aria-hidden="true">
                    <i class="fa-solid fa-tower-broadcast"></i>
                </div>
                <div class="ch-card-body">
                    <div class="ch-card-name">${escapeHtml(channel.name)}</div>
                    <div class="ch-card-meta">
                        <span class="ch-meta-item">
                            <i class="fa-solid fa-music" aria-hidden="true"></i>
                            ${songs.length} song${songs.length !== 1 ? 's' : ''}
                        </span>
                        <span class="ch-meta-item">
                            <i class="fa-solid fa-clock" aria-hidden="true"></i>
                            ${formatDuration(totalMs)}
                        </span>
                    </div>
                    <div class="ch-card-tags">
                        ${tags.map(tag => `<span class="ch-tag ch-tag-${tag.type}">${tag.label}</span>`).join('')}
                    </div>
                </div>
                <div class="ch-card-arrow" aria-hidden="true">
                    <i class="fa-solid fa-chevron-right"></i>
                </div>
            </div>`;
        }).join('');

        grid.querySelectorAll('.ch-card').forEach(card => {
            const open = () => this.openDetail(card.dataset.id);
            card.onclick   = open;
            card.onkeydown = event => {
                if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    open();
                }
            };
        });
    }

    /**
     * Opens the detail view for a channel, optionally pushing a history entry.
     * @param {string} channelId
     * @param {boolean} pushState
     */
    openDetail(channelId, pushState = true) {
        const channel = this.channels.find(ch => ch.id === channelId);
        if (!channel) { history.replaceState(null, '', location.pathname); return; }

        if (pushState) {
            const slug = encodeURIComponent(channel.slug || channel.id);
            history.pushState({ channelId }, '', `#/${slug}`);
        }

        const songs   = this.getSongsForChannel(channel);
        const totalMs = songs.reduce((acc, song) => acc + (song.duration_ms ?? 0), 0);
        const tags    = this.buildModeTags(channel);

        byId('ch-detail-name').textContent         = channel.name;
        byId('ch-detail-desc').textContent         = channel.description || 'No description provided.';
        byId('ch-detail-songs').textContent        = songs.length;
        byId('ch-detail-duration').textContent     = formatDuration(totalMs);
        byId('ch-detail-tags').innerHTML           = tags.map(tag =>
            `<span class="ch-tag ch-tag-${tag.type}">${tag.label}</span>`
        ).join('');

        this.renderListenBtn(channel);

        const trackList = byId('ch-detail-tracks');
        trackList.innerHTML = songs.length
            ? songs.map((song, index) => `
                <div class="ch-track-row">
                    <span class="ch-track-num">${index + 1}</span>
                    <div class="ch-track-info">
                        <div class="ch-track-title">${escapeHtml(song.title ?? 'Unknown')}</div>
                        <div class="ch-track-artist">${escapeHtml(song.artist ?? 'Unknown')}</div>
                    </div>
                    <span class="ch-track-dur">${formatTime(song.duration_ms)}</span>
                </div>`
            ).join('')
            : `<div class="empty-state">
                   <i class="fa-solid fa-music" aria-hidden="true"></i>
                   <span>No tracks in this channel</span>
               </div>`;

        byId('ch-grid-view').classList.add('hidden');
        byId('ch-detail-view').classList.remove('hidden');
    }

    /** @param {object} channel */
    renderListenBtn(channel) {
        const btn = byId('ch-listen-btn');
        if (!btn) return;
        const isActive = this.activeChannelId === channel.id;
        btn.innerHTML  = isActive
            ? `<i class="fa-solid fa-stop" aria-hidden="true"></i> Stop Listening`
            : `<i class="fa-solid fa-headphones" aria-hidden="true"></i> Listen Now`;
        btn.className  = isActive ? 'btn-danger' : 'btn-primary';
        btn.onclick    = () => {
            if (isActive) this.onStopChannel?.();
            else this.onListenToChannel?.(channel);
        };
    }

    /** Re-renders the listen button for the currently displayed detail view. */
    refreshListenBtn(channelId) {
        const detailView = byId('ch-detail-view');
        if (detailView?.classList.contains('hidden')) return;
        const channelName = byId('ch-detail-name')?.textContent;
        const channel = this.channels.find(ch => ch.id === channelId || ch.name === channelName);
        if (channel) this.renderListenBtn(channel);
    }

    closeDetail() {
        if (!this.activeChannelId) history.pushState(null, '', location.pathname);
        byId('ch-detail-view').classList.add('hidden');
        byId('ch-grid-view').classList.remove('hidden');
    }

    /** Handles a URL hash change and opens the matching channel detail view. */
    handleHash(hash) {
        if (!hash || hash === '#' || hash === '#/') {
            byId('ch-detail-view').classList.add('hidden');
            byId('ch-grid-view').classList.remove('hidden');
            return;
        }

        const match = hash.match(/^#\/([^/]+)$/);
        if (!match) return;

        const slug    = decodeURIComponent(match[1]);
        const channel = this.channels.find(ch => (ch.slug || ch.id) === slug || ch.id === slug);

        if (!channel) {
            history.replaceState(null, '', location.pathname);
            this.toast?.show(`Channel "${slug}" not found`, 'warning');
            return;
        }

        this.openDetail(channel.id, false);
    }

    /**
     * Returns the song list for a channel. If the channel has no playlist linked,
     * it returns the full song catalogue.
     * @param {object} channel
     */
    getSongsForChannel(channel) {
        if (!channel.playlistId) return this.songs;
        const playlist = this.playlists.find(pl => pl.id === channel.playlistId);
        if (!playlist) return this.songs;
        const songMap = new Map(this.songs.map(song => [song.id, song]));
        return (playlist.songs ?? []).map(id => songMap.get(id)).filter(Boolean);
    }

    /**
     * Builds an array of display tags for a channel's settings.
     * @param {object} channel
     * @returns {{ label: string, type: string }[]}
     */
    buildModeTags(channel) {
        const tags = [];
        if (channel.mode)         tags.push({ label: channel.mode,     type: 'mode'    });
        if (channel.autoLoop)     tags.push({ label: 'looping',        type: 'loop'    });
        if (channel.noRepeat)     tags.push({ label: 'no repeat',      type: 'repeat'  });
        if (channel.shuffleOnLoop) tags.push({ label: 'shuffle loop',  type: 'shuffle' });
        if (!channel.playlistId)  tags.push({ label: 'full catalogue', type: 'cat'     });
        return tags;
    }
}

// ── Admin Channel Panel ───────────────────────────────────
export class AdminChannelPanel {
    constructor(db, toast, modal, channelManager) {
        this.db             = db;
        this.toast          = toast;
        this.modal          = modal;
        this.channelManager = channelManager;

        byId('new-channel-btn').onclick = () => this.openCreateModal();
    }

    async load() {
        try {
            await this.channelManager.load();
            this.renderAdminList();
        } catch (err) {
            console.error('[channels admin] load failed:', err);
        }
    }

    renderAdminList() {
        const list = byId('admin-channels-list');
        if (!list) { console.error('[channels] admin-channels-list element not found'); return; }
        const { channels } = this.channelManager;

        if (!channels.length) {
            list.innerHTML = `
                <div class="empty-state">
                    <i class="fa-solid fa-tower-broadcast" aria-hidden="true"></i>
                    <span>No channels yet. Create one to get started.</span>
                </div>`;
            return;
        }

        list.innerHTML = channels.map(channel => {
            const songs = this.channelManager.getSongsForChannel(channel);
            return `
            <div class="admin-ch-item" data-id="${channel.id}">
                <div class="admin-ch-icon" aria-hidden="true">
                    <i class="fa-solid fa-tower-broadcast"></i>
                </div>
                <div class="admin-ch-info">
                    <div class="admin-ch-name">${escapeHtml(channel.name)}</div>
                    <div class="admin-ch-meta">
                        ${songs.length} tracks
                        ${channel.playlistId ? '· playlist linked' : '· full catalogue'}
                        · <code>#/${escapeHtml(channel.slug || channel.id)}</code>
                    </div>
                </div>
                <div class="admin-ch-actions">
                    <button class="btn-secondary edit-ch-btn" data-id="${channel.id}"
                            aria-label="Edit ${escapeHtml(channel.name)}">
                        <i class="fa-solid fa-pen" aria-hidden="true"></i> Edit
                    </button>
                    <button class="btn-danger delete-ch-btn" data-id="${channel.id}"
                            aria-label="Delete ${escapeHtml(channel.name)}">
                        <i class="fa-solid fa-trash" aria-hidden="true"></i>
                    </button>
                </div>
            </div>`;
        }).join('');

        list.querySelectorAll('.edit-ch-btn').forEach(btn => {
            btn.onclick = () => this.openEditModal(btn.dataset.id);
        });
        list.querySelectorAll('.delete-ch-btn').forEach(btn => {
            btn.onclick = () => this.deleteChannel(btn.dataset.id);
        });
    }

    /**
     * Generates the channel form HTML for create/edit modals.
     * @param {object} channel - existing channel data (empty for create)
     * @param {object[]} playlists
     */
    channelFormHtml(channel = {}, playlists = []) {
        const playlistOptions = playlists.map(pl =>
            `<option value="${pl.id}" ${channel.playlistId === pl.id ? 'selected' : ''}>${escapeHtml(pl.name)}</option>`
        ).join('');

        const modes = ['sequential', 'shuffle', 'loop-one', 'loop-all'];

        return `
            <label class="field-label" for="ch-form-name">Channel Name *</label>
            <input type="text" class="text-input" id="ch-form-name" placeholder="Morning Vibes"
                   value="${escapeHtml(channel.name ?? '')}">

            <label class="field-label" for="ch-form-slug">URL Slug *</label>
            <input type="text" class="text-input" id="ch-form-slug" placeholder="morning-vibes"
                   value="${escapeHtml(channel.slug ?? '')}">
            <small class="field-hint">Used in the URL: <code>#/{slug}</code>. Lowercase, hyphens only.</small>

            <label class="field-label" for="ch-form-desc">Description</label>
            <textarea class="text-input" id="ch-form-desc" rows="3"
                      placeholder="Describe this channel...">${escapeHtml(channel.description ?? '')}</textarea>

            <label class="field-label" for="ch-form-playlist">Playlist</label>
            <select class="select-input" id="ch-form-playlist">
                <option value="">All songs (full catalogue)</option>
                ${playlistOptions}
            </select>

            <label class="field-label">Playback Mode</label>
            <div class="mode-grid ch-mode-grid">
                ${modes.map(mode => `
                    <label class="mode-option">
                        <input type="radio" name="ch-mode" value="${mode}"
                               ${(channel.mode ?? 'sequential') === mode ? 'checked' : ''}>
                        <span>
                            <i class="${this.modeIcon(mode)}" aria-hidden="true"></i>
                            ${this.modeLabel(mode)}
                        </span>
                    </label>`).join('')}
            </div>

            <div class="rules-grid" style="margin-top:1.25rem;">
                <div class="admin-card">
                    <div class="card-header">
                        <i class="fa-solid fa-repeat" aria-hidden="true"></i>
                        <h4>Loop Behaviour</h4>
                    </div>
                    <div class="rule-row">
                        <div class="rule-info">
                            <span>Auto-loop playlist</span>
                            <small>Keep broadcasting even when no admin is active</small>
                        </div>
                        <label class="toggle">
                            <input type="checkbox" id="ch-form-loop" ${channel.autoLoop !== false ? 'checked' : ''}>
                            <span class="toggle-slider"></span>
                        </label>
                    </div>
                    <div class="rule-row">
                        <div class="rule-info">
                            <span>Restart on empty queue</span>
                            <small>Auto-replay playlist from the beginning</small>
                        </div>
                        <label class="toggle">
                            <input type="checkbox" id="ch-form-restart" ${channel.restartOnEmpty !== false ? 'checked' : ''}>
                            <span class="toggle-slider"></span>
                        </label>
                    </div>
                </div>

                <div class="admin-card">
                    <div class="card-header">
                        <i class="fa-solid fa-shuffle" aria-hidden="true"></i>
                        <h4>Playback Order</h4>
                    </div>
                    <div class="rule-row">
                        <div class="rule-info">
                            <span>Shuffle on loop</span>
                            <small>Re-shuffle each time the playlist loops</small>
                        </div>
                        <label class="toggle">
                            <input type="checkbox" id="ch-form-shuffleloop" ${channel.shuffleOnLoop ? 'checked' : ''}>
                            <span class="toggle-slider"></span>
                        </label>
                    </div>
                    <div class="rule-row">
                        <div class="rule-info">
                            <span>Avoid repeats</span>
                            <small>Don't play the same song twice in a row</small>
                        </div>
                        <label class="toggle">
                            <input type="checkbox" id="ch-form-norepeat" ${channel.noRepeat !== false ? 'checked' : ''}>
                            <span class="toggle-slider"></span>
                        </label>
                    </div>
                </div>

                <div class="admin-card">
                    <div class="card-header">
                        <i class="fa-solid fa-clock" aria-hidden="true"></i>
                        <h4>Timing</h4>
                    </div>
                    <div class="rule-row vertical">
                        <label class="field-label" for="ch-form-sync">Sync interval (seconds)</label>
                        <input type="number" id="ch-form-sync" value="${channel.syncInterval ?? 10}" min="5" max="60"
                               class="number-input">
                        <small>How often listeners re-sync to the stream</small>
                    </div>
                    <div class="rule-row vertical">
                        <label class="field-label" for="ch-form-drift">Drift correction threshold (seconds)</label>
                        <input type="number" id="ch-form-drift" value="${channel.driftThreshold ?? 2}" min="1" max="10"
                               class="number-input">
                        <small>Max allowed drift before forcing a re-sync</small>
                    </div>
                </div>
            </div>
        `;
    }

    /** @param {string} mode */
    modeIcon(mode) {
        return {
            sequential: 'fa-solid fa-arrow-right-long',
            shuffle:    'fa-solid fa-shuffle',
            'loop-one': 'fa-solid fa-1',
            'loop-all': 'fa-solid fa-repeat',
        }[mode] ?? 'fa-solid fa-music';
    }

    /** @param {string} mode */
    modeLabel(mode) {
        return {
            sequential: 'Sequential',
            shuffle:    'Shuffle',
            'loop-one': 'Loop One',
            'loop-all': 'Loop All',
        }[mode] ?? mode;
    }

    /** Converts a channel name to a URL-safe slug. */
    slugify(name) {
        return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    }

    openCreateModal() {
        const playlists = this.channelManager.playlists;
        byId('modal-title').textContent = 'New Channel';
        byId('modal-body').innerHTML    = this.channelFormHtml({}, playlists);
        byId('modal-body').parentElement.classList.add('modal-wide');
        byId('modal-footer').innerHTML  = `
            <button class="btn-secondary" id="modal-cancel">Cancel</button>
            <button class="btn-primary" id="modal-confirm">Create Channel</button>
        `;

        byId('ch-form-name').oninput = event => {
            const slugInput = byId('ch-form-slug');
            if (!slugInput.dataset.touched) slugInput.value = this.slugify(event.target.value);
        };
        byId('ch-form-slug').oninput = event => { event.target.dataset.touched = !!event.target.value; };

        byId('modal-cancel').onclick  = () => this.modal.close();
        byId('modal-confirm').onclick = async () => {
            const data = this.readForm();
            if (!data) return;
            const slugExists = this.channelManager.channels.some(ch => (ch.slug || ch.id) === data.slug);
            if (slugExists) { this.toast.show('Slug already in use', 'warning'); return; }
            await this.db.collection('channels').add({ ...data, createdAt: Date.now() });
            this.toast.show(`Channel "${data.name}" created`, 'success');
            await this.load();
            this.modal.close();
        };
        this.modal.open();
    }

    /** @param {string} channelId */
    openEditModal(channelId) {
        const channel   = this.channelManager.channels.find(ch => ch.id === channelId);
        const playlists = this.channelManager.playlists;
        if (!channel) return;

        byId('modal-title').textContent = `Edit: ${channel.name}`;
        byId('modal-body').innerHTML    = this.channelFormHtml(channel, playlists);
        byId('modal-body').parentElement.classList.add('modal-wide');
        byId('modal-footer').innerHTML  = `
            <button class="btn-secondary" id="modal-cancel">Cancel</button>
            <button class="btn-primary" id="modal-confirm">Save Changes</button>
        `;

        byId('modal-cancel').onclick  = () => this.modal.close();
        byId('modal-confirm').onclick = async () => {
            const data     = this.readForm();
            if (!data) return;
            const conflict = this.channelManager.channels.find(
                ch => (ch.slug || ch.id) === data.slug && ch.id !== channelId
            );
            if (conflict) { this.toast.show('Slug already in use', 'warning'); return; }
            await this.db.collection('channels').update(channelId, { ...data, updatedAt: Date.now() });
            this.toast.show(`Channel "${data.name}" saved`, 'success');
            await this.load();
            this.modal.close();
        };
        this.modal.open();
    }

    /**
     * Reads and validates the channel form. Returns the data object or null on error.
     * @returns {object|null}
     */
    readForm() {
        const name = byId('ch-form-name').value.trim();
        const slug = byId('ch-form-slug').value.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-');
        if (!name) { this.toast.show('Name is required', 'warning'); return null; }
        if (!slug) { this.toast.show('Slug is required', 'warning'); return null; }
        return {
            name,
            slug,
            description:    byId('ch-form-desc').value.trim(),
            playlistId:     byId('ch-form-playlist').value || null,
            mode:           document.querySelector('input[name="ch-mode"]:checked')?.value ?? 'sequential',
            autoLoop:       byId('ch-form-loop').checked,
            restartOnEmpty: byId('ch-form-restart').checked,
            shuffleOnLoop:  byId('ch-form-shuffleloop').checked,
            noRepeat:       byId('ch-form-norepeat').checked,
            syncInterval:   parseInt(byId('ch-form-sync').value)  || 10,
            driftThreshold: parseInt(byId('ch-form-drift').value) || 2,
        };
    }

    /** @param {string} channelId */
    deleteChannel(channelId) {
        const channel = this.channelManager.channels.find(ch => ch.id === channelId);
        this.modal.confirm(
            'Delete Channel',
            `Delete channel "${channel?.name ?? 'this channel'}"? This cannot be undone.`,
            async () => {
                await this.db.collection('channels').remove(channelId);
                this.toast.show(`Deleted: ${channel?.name}`, 'info');
                await this.load();
                this.modal.close();
            }
        );
    }
}