import { byId } from './utils.js';

// ── Audio State Machine ──────────────────────────────────
// Manages exclusive audio playback across three sources.

export class AudioRouter {
    constructor(liveAudio, catAudio, previewAudio) {
        this.liveAudio    = liveAudio;
        this.catAudio     = catAudio;
        this.previewAudio = previewAudio;
        this.state        = 'idle';
        this.prevState    = null;
    }

    soloSource(source) {
        if (source !== 'live') {
            this.liveAudio.pause();
            document.body.classList.remove('playing');
        }
        if (source !== 'cat')     this.catAudio.pause();
        if (source !== 'preview') this.previewAudio.pause();
    }

    activateLive(autoplay = false) {
        this.soloSource('live');
        this.state = 'live';
        if (autoplay) {
            this.liveAudio.play().catch(() => {});
            document.body.classList.add('playing');
        }
    }

    activateCat() {
        this.soloSource('cat');
        this.state = 'catalogue';
    }

    activatePreview() {
        if (this.state !== 'preview') this.prevState = this.state;
        this.soloSource('preview');
        this.state = 'preview';
    }

    endPreview() {
        this.previewAudio.pause();
        this.state = this.prevState ?? 'idle';
        this.prevState = null;
        return this.state;
    }

    get isLiveActive()    { return this.state === 'live'; }
    get isCatActive()     { return this.state === 'catalogue'; }
    get isPreviewActive() { return this.state === 'preview'; }
}

// ── Volume Control ───────────────────────────────────────

export class VolumeControl {
    constructor(sliderId, fillId, muteBtnId, audioTarget, storageKey = null) {
        this.slider     = byId(sliderId);
        this.fill       = byId(fillId);
        this.muteBtn    = byId(muteBtnId);
        this.audio      = audioTarget;
        this.lastVol    = 80;
        this.storageKey = storageKey;

        if (storageKey) {
            const saved = localStorage.getItem(storageKey);
            if (saved !== null) this.slider.value = saved;
        }

        this.slider.addEventListener('input', () => this.onInput());
        this.muteBtn.onclick = () => this.toggleMute();
        this.onInput();
    }

    get level() { return parseInt(this.slider.value) / 100; }

    onInput() {
        const vol = parseInt(this.slider.value);
        this.fill.style.width = vol + '%';
        this.audio.volume     = vol / 100;
        if (vol > 0) this.lastVol = vol;
        this.updateIcon(vol);
        if (this.storageKey) localStorage.setItem(this.storageKey, this.slider.value);
    }

    toggleMute() {
        if (this.audio.volume > 0) {
            this.lastVol      = parseInt(this.slider.value) || 80;
            this.slider.value = 0;
        } else {
            this.slider.value = this.lastVol;
        }
        this.onInput();
    }

    updateIcon(vol) {
        const icon = this.muteBtn.querySelector('i');
        icon.className = vol === 0
            ? 'fa-solid fa-volume-xmark'
            : vol < 50
                ? 'fa-solid fa-volume-low'
                : 'fa-solid fa-volume-high';
    }
}

// ── Submission Preview Player ────────────────────────────

export class PreviewPlayer {
    constructor(router, toast, { onRestoreCat } = {}) {
        this.router       = router;
        this.toast        = toast;
        this.onRestoreCat = onRestoreCat ?? null;
        this.audio        = new Audio();
        this.activeBtn    = null;

        this.audio.onended = () => this.stop();
    }

    play(url, title, btnEl) {
        const alreadyPlaying = !this.audio.paused && this.audio.src === url;
        if (alreadyPlaying) { this.stop(); return; }

        this.router.activatePreview();
        this.audio.src = url;
        this.audio.play().catch(() => {});

        document.querySelectorAll('.preview-sub-btn i').forEach(icon => {
            icon.className = 'fa-solid fa-play';
        });
        if (btnEl) {
            btnEl.querySelector('i').className = 'fa-solid fa-pause';
            this.activeBtn = btnEl;
        }
        this.toast.show(`Previewing: ${title}`, 'info');
    }

    stop() {
        this.audio.pause();
        document.querySelectorAll('.preview-sub-btn i').forEach(icon => {
            icon.className = 'fa-solid fa-play';
        });
        this.activeBtn = null;
        const restoredState = this.router.endPreview();
        if (restoredState === 'catalogue') this.onRestoreCat?.();
    }
}
