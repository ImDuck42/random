import { byId, escapeHtml, formatTime, filterByQuery } from './utils.js';

// ── Catalogue Player ─────────────────────────────────────
export class CatPlayer {
    constructor(audioEl, router, volumeCtrl, toast, livePlayer) {
        this.audio      = audioEl;
        this.router     = router;
        this.vol        = volumeCtrl;
        this.toast      = toast;
        this.livePlayer = livePlayer;
        this.songs      = [];
        this.index      = -1;
        this.rafId      = null;

        this.audio.onended = () => {
            if (this.index + 1 < this.songs.length) {
                this.playAt(this.index + 1);
            } else {
                this.index = -1;
                this.updateBar();
                this.renderGrid();
                this.router.activateLive();
            }
        };

        byId('cat-play-btn').onclick  = () => this.togglePlay();
        byId('cat-prev-btn').onclick  = () => this.playAt(this.index - 1);
        byId('cat-next-btn').onclick  = () => this.playAt(this.index + 1);
        byId('cat-progress-track').onclick = ev => this.seek(ev);

        byId('cat-search').oninput = ev => {
            this.renderGrid(filterByQuery(this.songs, ev.target.value));
        };
    }

    get isPlaying() { return !this.audio.paused && this.router.isCatActive; }

    playAt(idx) {
        if (idx < 0 || idx >= this.songs.length) return;
        this.index = idx;
        const song = this.songs[idx];

        this.router.activateCat();
        this.audio.src    = song.fileUrl;
        this.audio.volume = this.vol.level;
        this.audio.play().catch(() => {});

        this.updateBar();
        this.renderGrid();
        this.startProgressLoop();
    }

    togglePlay() {
        if (this.index === -1) { if (this.songs.length) this.playAt(0); return; }
        if (this.audio.paused) {
            this.router.activateCat();
            this.audio.play().catch(() => {});
            this.startProgressLoop();
        } else {
            this.audio.pause();
            this.router.activateLive();
            this.livePlayer.resumeIfNeeded();
        }
        this.updateBar();
        this.renderGrid();
    }

    stop() {
        this.audio.pause();
        this.updateBar();
        this.renderGrid();
    }

    updateBar() {
        const song = this.songs[this.index];
        if (song) {
            byId('cat-track-title').textContent  = song.title  ?? 'Unknown';
            byId('cat-track-artist').textContent = song.artist ?? 'Unknown';
            byId('cat-time-total').textContent   = formatTime(song.duration_ms);
            byId('cat-player-bar').classList.add('visible');
        }
        byId('cat-play-icon').className = `fa-solid ${this.isPlaying ? 'fa-pause' : 'fa-play'}`;
        byId('cat-bar-disc').classList.toggle('spinning', this.isPlaying);
    }

    renderGrid(displaySongs = this.songs) {
        const grid = byId('cat-song-grid');
        if (!displaySongs.length) {
            grid.innerHTML = `<div class="empty-state large">
                <i class="fa-solid fa-music" aria-hidden="true"></i>
                <span>No songs found</span>
            </div>`;
            return;
        }
        grid.innerHTML = displaySongs.map(song => {
            const realIdx = this.songs.findIndex(item => item.id === song.id);
            const active  = realIdx === this.index;
            const playing = active && this.isPlaying;
            return `
            <div class="song-card ${active ? 'active' : ''}" data-idx="${realIdx}" role="listitem" tabindex="0">
                <div class="card-art">
                    <div class="card-disc ${playing ? 'spinning' : ''}">
                        <div class="card-hole"></div>
                    </div>
                    <button class="card-play-btn" aria-label="${playing ? 'Pause' : 'Play'} ${escapeHtml(song.title ?? 'song')}">
                        <i class="fa-solid ${playing ? 'fa-pause' : 'fa-play'}" aria-hidden="true"></i>
                    </button>
                </div>
                <div class="card-info">
                    <div class="card-title" title="${escapeHtml(song.title ?? 'Unknown')}">${escapeHtml(song.title ?? 'Unknown')}</div>
                    <div class="card-artist">${escapeHtml(song.artist ?? 'Unknown')}</div>
                    <div class="card-dur">${formatTime(song.duration_ms)}</div>
                </div>
            </div>`;
        }).join('');

        grid.querySelectorAll('.song-card').forEach(card => {
            card.onclick = () => {
                const idx = parseInt(card.dataset.idx);
                if (idx === this.index) this.togglePlay();
                else this.playAt(idx);
            };
        });
    }

    startProgressLoop() {
        if (this.rafId) cancelAnimationFrame(this.rafId);
        const tick = () => {
            if (!this.audio.duration) { this.rafId = requestAnimationFrame(tick); return; }
            const pct = Math.min((this.audio.currentTime / this.audio.duration) * 100, 100) + '%';
            byId('cat-progress-fill').style.width  = pct;
            byId('cat-progress-thumb').style.left  = pct;
            byId('cat-time-current').textContent   = formatTime(this.audio.currentTime * 1000);
            this.rafId = requestAnimationFrame(tick);
        };
        tick();
    }

    seek(ev) {
        if (!this.audio.duration) return;
        const rect = ev.currentTarget.getBoundingClientRect();
        this.audio.currentTime = ((ev.clientX - rect.left) / rect.width) * this.audio.duration;
    }
}
