import { byId, formatTime } from './utils.js';
import { renderUpNext, updateStats } from './render.js';

// ── Live Radio Player ────────────────────────────────────
export class LivePlayer {
    /**
     * @param {HTMLAudioElement} audioEl
     * @param {AudioRouter} router
     * @param {VolumeControl} volumeCtrl
     * @param {object} rules
     * @param {() => Promise<void>} onSyncTick - called on each sync interval
     */
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

        this.audio.onended = () => this.startSync();
    }

    tuneIn() {
        this.tunedIn = true;
        this.router.activateLive(true);
        this.audio.volume = this.vol.level;
    }

    /** Starts (or restarts) the periodic sync interval. */
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

    /**
     * Seeks the audio to a specific offset and begins playback if tuned in.
     * Updates the UI with track info and starts the progress animation loop.
     * @param {{ id, title, artist, duration_ms, fileUrl }} song
     * @param {number} offsetMs - how far into the song to start
     * @param {object[]} songList - full ordered list for the queue display
     */
    syncToOffset(song, offsetMs, songList) {
        const offsetSec = offsetMs / 1000;

        byId('now-playing-title').textContent  = song.title  ?? 'Unknown';
        byId('now-playing-artist').textContent = song.artist ?? 'Unknown';
        byId('live-time-total').textContent    = formatTime(song.duration_ms);
        document.title = song.title ?? 'GHDB Radio';

        this._syncAudio(song, offsetSec);

        renderUpNext(song, songList, this.rules);
        updateStats(this.currentState, songList);
    }

    /**
     * Internal: updates the audio element's src, seek position, and playback state.
     * When the catalogue player is active, we sync metadata only (no playback).
     */
    _syncAudio(song, offsetSec) {
        if (this.router.isCatActive) {
            // Background sync: keep src/time ready but don't interrupt catalogue
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

    /**
     * Animates the progress bar and time display using requestAnimationFrame.
     * Falls back to wall-clock time when the audio is paused.
     * @param {{ duration_ms: number }} song
     * @param {number} offsetAtStartMs
     */
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
            this.rafId = requestAnimationFrame(tick);
        };
        tick();
    }

    /** Shows the offline state in the player UI. */
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

    /** Resumes live audio if tuned in and playback has stopped. */
    resumeIfNeeded() {
        if (this.tunedIn && this.router.isLiveActive && this.audio.paused) {
            this.audio.volume = this.vol.level;
            this.audio.play().catch(() => {});
            document.body.classList.add('playing');
        }
    }
}
