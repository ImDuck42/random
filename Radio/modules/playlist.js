import { byId, escapeHtml, formatTime, shuffled } from './utils.js';

// ── Playlist Manager ─────────────────────────────────────
export class PlaylistManager {
    constructor(db, toast, modal, library) {
        this.db        = db;
        this.toast     = toast;
        this.modal     = modal;
        this.library   = library;
        this.playlists = [];
        this.activeId  = null;

        byId('new-playlist-btn').onclick = () => this.openCreateModal();
    }

    async load() {
        this.playlists = await this.db.collection('playlists').list();
        this.library.playlists = this.playlists;
        this.renderList();
        this.populateDropdown();
        return this.playlists;
    }

    renderList() {
        const container = byId('playlist-list');
        if (!this.playlists.length) {
            container.innerHTML = '<div class="empty-state">No playlists yet</div>';
            return;
        }
        container.innerHTML = this.playlists.map(playlist => `
            <div class="playlist-item ${playlist.id === this.activeId ? 'active' : ''}"
                 data-id="${playlist.id}" role="listitem" tabindex="0">
                <i class="fa-solid fa-music pl-icon" aria-hidden="true"></i>
                <span class="pl-name">${escapeHtml(playlist.name)}</span>
                <span class="pl-count">${playlist.songs?.length ?? 0}</span>
            </div>
        `).join('');

        container.querySelectorAll('.playlist-item').forEach(item => {
            item.onclick = () => {
                this.activeId = item.dataset.id;
                this.renderList();
                this.openEditor(item.dataset.id);
            };
        });
    }

    populateDropdown() {
        const select = byId('quick-playlist-select');
        if (!select) return;
        select.innerHTML = `<option value="">All Songs (entire library)</option>` +
            this.playlists.map(playlist =>
                `<option value="${playlist.id}">${escapeHtml(playlist.name)}</option>`
            ).join('');
    }

    /**
     * Opens the playlist editor for the given playlist, fetching its tracks.
     * @param {string} playlistId
     */
    async openEditor(playlistId) {
        const playlist = this.playlists.find(pl => pl.id === playlistId);
        if (!playlist) return;

        const tracks = (await Promise.all(
            (playlist.songs ?? []).map(songId => this.db.collection('songs').get(songId))
        )).filter(Boolean);

        const editor = byId('playlist-editor');
        editor.innerHTML = `
            <div class="playlist-editor-header">
                <span class="pl-edit-name">${escapeHtml(playlist.name)}</span>
                <div class="pl-edit-actions">
                    <button class="btn-secondary" id="shuffle-playlist-btn">
                        <i class="fa-solid fa-shuffle" aria-hidden="true"></i> Shuffle
                    </button>
                    <button class="btn-danger" id="delete-playlist-btn">
                        <i class="fa-solid fa-trash" aria-hidden="true"></i> Delete
                    </button>
                </div>
            </div>
            <div class="playlist-editor-body" id="playlist-editor-body">
                ${tracks.length
                    ? tracks.map((song, index) => `
                        <div class="pl-song-item" data-id="${song.id}">
                            <i class="fa-solid fa-grip-lines drag-handle" aria-hidden="true"></i>
                            <span class="pl-song-num">${index + 1}</span>
                            <div class="pl-song-info">
                                <div class="pl-song-title">${escapeHtml(song.title ?? 'Unknown')}</div>
                                <div class="pl-song-artist">${escapeHtml(song.artist ?? 'Unknown')}</div>
                            </div>
                            <span class="pl-song-dur">${formatTime(song.duration_ms)}</span>
                            <button class="icon-btn remove-from-pl-btn" data-id="${song.id}"
                                    aria-label="Remove ${escapeHtml(song.title ?? 'song')} from playlist">
                                <i class="fa-solid fa-xmark" aria-hidden="true"></i>
                            </button>
                        </div>
                    `).join('')
                    : '<div class="empty-state"><i class="fa-solid fa-music" aria-hidden="true"></i><span>No tracks in this playlist</span></div>'
                }
            </div>
        `;

        editor.querySelectorAll('.remove-from-pl-btn').forEach(btn => {
            btn.onclick = async () => {
                const newSongs = (playlist.songs ?? []).filter(songId => songId !== btn.dataset.id);
                await this.db.collection('playlists').update(playlistId, { songs: newSongs });
                this.toast.show('Track removed', 'info');
                await this.load();
                this.openEditor(playlistId);
            };
        });

        byId('shuffle-playlist-btn').onclick = async () => {
            const shuffledSongs = shuffled(playlist.songs ?? []);
            await this.db.collection('playlists').update(playlistId, { songs: shuffledSongs });
            this.toast.show('Playlist shuffled', 'success');
            await this.load();
            this.openEditor(playlistId);
        };

        byId('delete-playlist-btn').onclick = () => {
            this.modal.confirm(
                'Delete Playlist',
                `Delete playlist "${playlist.name}"? This cannot be undone.`,
                async () => {
                    await this.db.collection('playlists').remove(playlistId);
                    this.activeId = null;
                    this.toast.show(`Deleted: ${playlist.name}`, 'info');
                    byId('playlist-editor').innerHTML = `
                        <div class="empty-state large">
                            <i class="fa-solid fa-bars-staggered" aria-hidden="true"></i>
                            <span>Select a playlist to edit</span>
                        </div>`;
                    this.load();
                }
            );
        };
    }

    openCreateModal() {
        byId('modal-title').textContent = 'New Playlist';
        byId('modal-body').innerHTML = `
            <label class="field-label" for="new-playlist-name">Playlist Name</label>
            <input type="text" class="text-input" id="new-playlist-name" placeholder="My awesome playlist...">
        `;
        byId('modal-footer').innerHTML = `
            <button class="btn-secondary" id="modal-cancel">Cancel</button>
            <button class="btn-primary" id="modal-confirm">Create</button>
        `;
        byId('modal-cancel').onclick  = () => this.modal.close();
        byId('modal-confirm').onclick = async () => {
            const name = byId('new-playlist-name').value.trim();
            if (!name) { this.toast.show('Enter a name', 'warning'); return; }
            await this.db.collection('playlists').add({ name, songs: [], createdAt: Date.now() });
            this.toast.show(`Created: ${name}`, 'success');
            this.load();
            this.modal.close();
        };
        this.modal.open();
    }
}