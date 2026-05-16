import { byId, formatTime } from './utils.js';
import { renderUpNext, updateStats } from './render.js';

// ── Live Radio Player ────────────────────────────────────
export class LivePlayer {
    constructor(audioEl, router, volumeCtrl, rules, onSyncTick) {
        this.audio      = audioEl;
        this.router     = router;
        this.vol        = volumeCtrl;
        this.rules      = rules;
        this.onSyncTick = onSyncTick;

        this.syncIntervalId = null;
        this.rafId          = null;
        this.tunedIn        = false;
        this.currentState   = null;

        this.audio.onended = () => this.startSync();
    }

    tuneIn() {
        this.tunedIn = true;
        this.router.activateLive(true);
        this.audio.volume = this.vol.level;
    }

    startSync() {
        if (this.syncIntervalId) clearInterval(this.syncIntervalId);
        const tick = async () => {
            try {
                await this.onSyncTick();
            } catch (err) {
                console.warn('[live sync]', err);
            }
        };
        tick();
        this.syncIntervalId = setInterval(tick, (this.rules.syncInterval ?? 10) * 1000);
    }

    stopSync() {
        if (this.syncIntervalId) { clearInterval(this.syncIntervalId); this.syncIntervalId = null; }
    }

    syncToOffset(song, offsetMs, songList) {
        const offsetSec = offsetMs / 1000;

        byId('now-playing-title').textContent  = song.title  ?? 'Unknown';
        byId('now-playing-artist').textContent = song.artist ?? 'Unknown';
        byId('live-time-total').textContent    = formatTime(song.duration_ms);
        document.title = song.title ?? 'GHDB Radio';

        if (!this.router.isCatActive) {
            if (this.audio.src !== song.fileUrl) {
                this.audio.src         = song.fileUrl;
                this.audio.currentTime = offsetSec;
                this.audio.volume      = this.vol.level;
                if (this.tunedIn && this.router.isLiveActive) {
                    this.audio.play().catch(() => {});
                    document.body.classList.add('playing');
                }
            } else {
                if (this.audio.paused) {
                    this.audio.currentTime = offsetSec;
                    if (this.tunedIn && this.router.isLiveActive) {
                        this.audio.play().catch(() => {});
                        document.body.classList.add('playing');
                    }
                } else if (Math.abs(this.audio.currentTime - offsetSec) > (this.rules.driftThreshold ?? 2)) {
                    this.audio.currentTime = offsetSec;
                }
            }
            this.startProgressLoop(song, offsetMs);
        } else {
            if (this.audio.src !== song.fileUrl) {
                this.audio.src         = song.fileUrl;
                this.audio.currentTime = offsetSec;
                this.audio.volume      = this.vol.level;
            }
        }

        renderUpNext(song, songList, this.rules);
        updateStats(this.currentState, songList);
    }

    startProgressLoop(song, offsetAtStartMs) {
        if (this.rafId) cancelAnimationFrame(this.rafId);
        const startWallMs = Date.now() - offsetAtStartMs;
        const dur = song.duration_ms;

        const tick = () => {
            const currentMs = this.audio.paused
                ? Math.min(Math.max(0, Date.now() - startWallMs), dur)
                : this.audio.currentTime * 1000;
            const pct = Math.min((currentMs / dur) * 100, 100) + '%';
            byId('live-progress-fill').style.width = pct;
            byId('live-progress-thumb').style.left = pct;
            byId('live-time-current').textContent  = formatTime(currentMs);
            this.rafId = requestAnimationFrame(tick);
        };
        tick();
    }

    setOffline() {
        if (this.rafId) { cancelAnimationFrame(this.rafId); this.rafId = null; }
        byId('now-playing-title').textContent  = 'Offline';
        byId('now-playing-artist').textContent = 'Waiting for broadcast...';
        document.body.classList.remove('playing');
        document.title = 'GHDB Radio';
        byId('up-next-list').innerHTML = `
            <div class="empty-state">
                <i class="fa-solid fa-satellite-dish" aria-hidden="true"></i>
                <span>No broadcast active</span>
            </div>`;
        byId('stat-queue').textContent  = '—';
        byId('stat-mode').textContent   = '—';
        byId('stat-uptime').textContent = '—';
    }

    resumeIfNeeded() {
        if (this.tunedIn && this.router.isLiveActive && this.audio.paused) {
            this.audio.volume = this.vol.level;
            this.audio.play().catch(() => {});
            document.body.classList.add('playing');
        }
    }
}
