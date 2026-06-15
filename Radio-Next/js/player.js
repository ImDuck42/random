import { byId, escapeHtml, formatTime, filterByQuery } from './utils.js';
import { renderUpNext, updateStats } from './utils.js';

// ── Live Radio Player ────────────────────────────────────

export class LivePlayer {
    constructor(audioEl, router, volumeCtrl, rules, onSyncTick) {
        this.audio        = audioEl;
        this.router       = router;
        this.vol          = volumeCtrl;
        this.rules        = rules;
        this.onSyncTick   = onSyncTick;
        this.syncTimerId  = null;
        this.rafId        = null;
        this.tunedIn      = false;
        this.currentState = null;
        this.activeChannelId = null;

        this.audio.onended = () => this.startSync();
    }

    tuneIn() {
        this.tunedIn = true;
        this.router.activateLive(true);
        this.audio.volume = this.vol.level;
    }

    startSync() {
        if (this.syncTimerId) clearInterval(this.syncTimerId);
        const tick = async () => {
            try { await this.onSyncTick(); }
            catch (err) { console.warn('[live sync]', err); }
        };
        tick();
        this.syncTimerId = setInterval(tick, (this.rules.syncInterval ?? 10) * 1000);
    }

    stopSync() {
        if (!this.syncTimerId) return;
        clearInterval(this.syncTimerId);
        this.syncTimerId = null;
    }

    syncToOffset(song, offsetMs, songList) {
        const offsetSec = offsetMs / 1000;

        byId('now-playing-title').textContent  = song.title  ?? 'Unknown';
        byId('now-playing-artist').textContent = song.artist ?? 'Unknown';
        byId('live-time-total').textContent    = formatTime(song.duration_ms);
        // Only update bottom bar title if catalogue is not active
        if (!this.router.isCatActive) {
            byId('player-title').textContent  = song.title  ?? 'Unknown';
            byId('player-artist').textContent = song.artist ?? 'Unknown';
            document.title = `${song.title ?? 'GHDB Radio'} - Radio`;
        }

        this.syncAudio(song, offsetSec);
        renderUpNext(song, songList, this.rules);
        updateStats(this.currentState, songList);
    }

    syncAudio(song, offsetSec) {
        if (this.router.isCatActive) {
            if (this.audio.src !== song.fileUrl) {
                this.audio.src         = song.fileUrl;
                this.audio.currentTime = offsetSec;
                this.audio.volume      = this.vol.level;
            }
            return;
        }

        const isSameSrc = this.audio.src === song.fileUrl;

        if (!isSameSrc) {
            this.audio.src         = song.fileUrl;
            this.audio.currentTime = offsetSec;
            this.audio.volume      = this.vol.level;
            if (this.tunedIn && this.router.isLiveActive) {
                this.audio.play().catch(() => {});
                document.body.classList.add('playing');
            }
        } else if (this.audio.paused) {
            this.audio.currentTime = offsetSec;
            if (this.tunedIn && this.router.isLiveActive) {
                this.audio.play().catch(() => {});
                document.body.classList.add('playing');
            }
        } else {
            const drift = Math.abs(this.audio.currentTime - offsetSec);
            if (drift > (this.rules.driftThreshold ?? 2)) {
                this.audio.currentTime = offsetSec;
            }
        }

        this.startProgressLoop(song, offsetSec * 1000);
    }

    startProgressLoop(song, offsetAtStartMs) {
        if (this.rafId) cancelAnimationFrame(this.rafId);
        const startWallMs = Date.now() - offsetAtStartMs;
        const dur = song.duration_ms;

        const tick = () => {
            const currentMs = this.audio.paused
                ? Math.min(Math.max(0, Date.now() - startWallMs), dur)
                : this.audio.currentTime * 1000;
            const pct = `${Math.min((currentMs / dur) * 100, 100)}%`;
            byId('live-progress-fill').style.width = pct;
            byId('live-progress-thumb').style.left = pct;
            byId('live-time-current').textContent  = formatTime(currentMs);
            byId('player-progress-fill').style.width = pct;
            this.rafId = requestAnimationFrame(tick);
        };
        tick();
    }

    setOffline() {
        if (this.rafId) { cancelAnimationFrame(this.rafId); this.rafId = null; }
        byId('now-playing-title').textContent  = 'Offline';
        byId('now-playing-artist').textContent = 'Waiting for broadcast...';
        byId('player-title').textContent       = 'Offline';
        byId('player-artist').textContent      = 'Waiting for broadcast...';
        document.body.classList.remove('playing');
        document.title = 'GHDB Radio';
        byId('up-next-list').innerHTML = `
            <div class="empty-state">
                <i class="fa-solid fa-satellite-dish" aria-hidden="true"></i>
                <span>No broadcast active</span>
            </div>`;
        byId('stat-queue').textContent  = '\u2014';
        byId('stat-mode').textContent   = '\u2014';
        byId('stat-uptime').textContent = '\u2014';
    }

    resumeIfNeeded() {
        if (this.tunedIn && this.router.isLiveActive && this.audio.paused) {
            this.audio.volume = this.vol.level;
            this.audio.play().catch(() => {});
            document.body.classList.add('playing');
        }
    }
}

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

        byId('player-play-btn').onclick       = () => this.togglePlay();
        byId('player-prev-btn').onclick       = () => this.playAt(this.index - 1);
        byId('player-next-btn').onclick       = () => this.playAt(this.index + 1);
        byId('player-progress-track').onclick = event => this.seek(event);
    }

    get isPlaying() { return !this.audio.paused && this.router.isCatActive; }

    playAt(index) {
        if (index < 0 || index >= this.songs.length) return;
        this.index = index;
        const song = this.songs[index];

        this.router.activateCat();
        this.audio.src    = song.fileUrl;
        this.audio.volume = this.vol.level;
        this.audio.play().catch(() => {});

        this.updateBar();
        this.renderGrid();
        this.startProgressLoop();
    }

    togglePlay() {
        if (this.index === -1) {
            if (this.songs.length) this.playAt(0);
            return;
        }
        if (this.audio.paused) {
            this.router.activateCat();
            this.audio.play().catch(() => {});
            this.startProgressLoop();
        } else {
            this.audio.pause();
            this.router.activateLive();
            this.livePlayer?.resumeIfNeeded();
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
            byId('player-title').textContent        = song.title  ?? 'Unknown';
            byId('player-artist').textContent       = song.artist ?? 'Unknown';
            byId('player-time-total').textContent   = formatTime(song.duration_ms);
        }
        byId('player-play-icon').className = `fa-solid ${this.isPlaying ? 'fa-pause' : 'fa-play'}`;
        byId('player-bar-disc')?.classList.toggle('spinning', this.isPlaying);
    }

    renderGrid(displaySongs = this.songs) {
        const grid = byId('cat-song-grid');
        if (!grid) return;
        if (!displaySongs.length) {
            grid.innerHTML = `
                <div class="empty-state large">
                    <i class="fa-solid fa-music" aria-hidden="true"></i>
                    <span>No songs found</span>
                </div>`;
            return;
        }

        grid.innerHTML = displaySongs.map(song => {
            const realIndex = this.songs.findIndex(item => item.id === song.id);
            const active    = realIndex === this.index;
            const playing   = active && this.isPlaying;
            return `
            <div class="song-card ${active ? 'active' : ''}" data-idx="${realIndex}"
                 role="listitem" tabindex="0">
                <div class="card-art">
                    <div class="card-disc ${playing ? 'spinning' : ''}">
                        <div class="card-hole"></div>
                    </div>
                    <button class="card-play-btn"
                            aria-label="${playing ? 'Pause' : 'Play'} ${escapeHtml(song.title ?? 'song')}">
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
            const pct = `${Math.min((this.audio.currentTime / this.audio.duration) * 100, 100)}%`;
            byId('player-progress-fill').style.width = pct;
            byId('player-progress-thumb').style.left = pct;
            byId('player-time-current').textContent  = formatTime(this.audio.currentTime * 1000);
            this.rafId = requestAnimationFrame(tick);
        };
        tick();
    }

    seek(event) {
        if (!this.audio.duration) return;
        const rect = event.currentTarget.getBoundingClientRect();
        this.audio.currentTime = ((event.clientX - rect.left) / rect.width) * this.audio.duration;
    }
}

