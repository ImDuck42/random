import { byId, escapeHtml, formatTime, formatDuration, filterByQuery } from './utils.js';

// ── Song Library Manager ─────────────────────────────────
export class LibraryManager {
    constructor(db, toast, modal) {
        this.db        = db;
        this.toast     = toast;
        this.modal     = modal;
        this.songs     = [];
        this.selected  = new Set();
        this.playlists = [];

        byId('library-search').oninput     = event => {
            this.render(filterByQuery(this.songs, event.target.value.toLowerCase()));
        };
        byId('refresh-library-btn').onclick  = () => this.load();
        byId('select-all-checkbox').onchange = event => {
            document.querySelectorAll('.song-check').forEach(checkbox => {
                checkbox.checked = event.target.checked;
                if (event.target.checked) this.selected.add(checkbox.value);
                else this.selected.delete(checkbox.value);
            });
            this.updateBulkCount();
        };
        byId('bulk-delete-btn').onclick     = () => this.bulkDelete();
        byId('add-to-playlist-btn').onclick = () => {
            if (!this.selected.size) { this.toast.show('Select songs first', 'warning'); return; }
            this.openAddToPlaylistModal([...this.selected]);
        };
    }

    async load() {
        this.songs = await this.db.collection('songs').list();
        const totalMs = this.songs.reduce((acc, song) => acc + (song.duration_ms ?? 0), 0);
        byId('lib-total').textContent    = this.songs.length;
        byId('lib-duration').textContent = formatDuration(totalMs);
        this.render(this.songs);
        return this.songs;
    }

    /** @param {object[]} songs - songs to display (may be a filtered subset) */
    render(songs) {
        const tbody = byId('library-tbody');
        if (!songs.length) {
            tbody.innerHTML = `<tr><td colspan="6"><div class="empty-state">No songs in library</div></td></tr>`;
            return;
        }
        tbody.innerHTML = songs.map((song, index) => `
            <tr data-id="${song.id}">
                <td><input type="checkbox" class="song-check" value="${song.id}"
                           aria-label="Select ${escapeHtml(song.title ?? 'song')}"
                           ${this.selected.has(song.id) ? 'checked' : ''}></td>
                <td class="track-num">${index + 1}</td>
                <td class="track-title">${escapeHtml(song.title ?? 'Unknown')}</td>
                <td>${escapeHtml(song.artist ?? 'Unknown')}</td>
                <td class="track-dur">${formatTime(song.duration_ms)}</td>
                <td class="track-actions">
                    <button class="icon-btn delete-song-btn" data-id="${song.id}"
                            aria-label="Delete ${escapeHtml(song.title ?? 'song')}">
                        <i class="fa-solid fa-trash" aria-hidden="true"></i>
                    </button>
                </td>
            </tr>
        `).join('');

        tbody.querySelectorAll('.song-check').forEach(checkbox => {
            checkbox.onchange = () => {
                if (checkbox.checked) this.selected.add(checkbox.value);
                else this.selected.delete(checkbox.value);
                this.updateBulkCount();
            };
        });
        tbody.querySelectorAll('.delete-song-btn').forEach(btn => {
            btn.onclick = () => this.confirmDelete(btn.dataset.id);
        });
    }

    updateBulkCount() {
        byId('selected-count').textContent = `${this.selected.size} selected`;
    }

    /** @param {string} songId */
    confirmDelete(songId) {
        const song = this.songs.find(item => item.id === songId);
        this.modal.confirm(
            'Delete Song',
            `Delete "${song?.title ?? 'this song'}"? This cannot be undone.`,
            async () => {
                await this.db.collection('songs').remove(songId);
                this.toast.show(`Deleted: ${song?.title}`, 'info');
                this.load();
            }
        );
    }

    bulkDelete() {
        if (!this.selected.size) { this.toast.show('No songs selected', 'warning'); return; }
        const count = this.selected.size;
        this.modal.confirm(
            'Delete Songs',
            `Delete ${count} song(s)? This cannot be undone.`,
            async () => {
                await this.db.collection('songs').bulkRemove([...this.selected]);
                this.selected.clear();
                this.updateBulkCount();
                this.toast.show(`Deleted ${count} tracks`, 'success');
                this.load();
            }
        );
    }

    /** @param {string[]} songIds */
    openAddToPlaylistModal(songIds) {
        byId('modal-title').textContent = 'Add to Playlist';
        byId('modal-body').innerHTML = this.playlists.length
            ? `<div class="pl-select-list">
                ${this.playlists.map(playlist => `
                    <div class="pl-select-item" data-id="${playlist.id}" role="option" tabindex="0">
                        <i class="fa-solid fa-bars-staggered" aria-hidden="true"></i>
                        <span>${escapeHtml(playlist.name)}</span>
                        <small>${playlist.songs?.length ?? 0} tracks</small>
                    </div>
                `).join('')}
               </div>`
            : `<div class="empty-state">
                   <i class="fa-solid fa-bars-staggered" aria-hidden="true"></i>
                   <span>No playlists yet. Create one first.</span>
               </div>`;

        let chosenId = null;
        byId('modal-body').querySelectorAll('.pl-select-item').forEach(item => {
            item.onclick = () => {
                byId('modal-body').querySelectorAll('.pl-select-item')
                    .forEach(el => el.classList.remove('selected'));
                item.classList.add('selected');
                chosenId = item.dataset.id;
            };
        });

        byId('modal-footer').innerHTML = `
            <button class="btn-secondary" id="modal-cancel">Cancel</button>
            <button class="btn-primary" id="modal-confirm">Add Songs</button>
        `;
        byId('modal-cancel').onclick = () => this.modal.close();
        byId('modal-confirm').onclick = async () => {
            if (!chosenId) { this.toast.show('Select a playlist', 'warning'); return; }
            const playlist   = this.playlists.find(pl => pl.id === chosenId);
            const songIdSet  = new Set(playlist.songs ?? []);
            songIds.forEach(id => songIdSet.add(id));
            const newSongs   = [...songIdSet];
            await this.db.collection('playlists').update(chosenId, { songs: newSongs });
            // Update in-memory so UI reflects the change without a reload
            playlist.songs = newSongs;
            this.toast.show(`Added ${songIds.length} track(s) to ${playlist.name}`, 'success');
            this.modal.close();
        };
        this.modal.open();
    }
}