// ── Audio State Machine ──────────────────────────────────
// Manages exclusive audio playback across three sources.
// States: idle | live | catalogue | preview
export class AudioRouter {
    constructor(liveAudio, catAudio, previewAudio) {
        this.liveAudio    = liveAudio;
        this.catAudio     = catAudio;
        this.previewAudio = previewAudio;
        this.state        = 'idle';
        this.prevState    = null;
    }

    /** Pauses all sources except the one that is about to play. */
    soloSource(source) {
        if (source !== 'live') {
            this.liveAudio.pause();
            document.body.classList.remove('playing');
        }
        if (source !== 'cat')     this.catAudio.pause();
        if (source !== 'preview') this.previewAudio.pause();
    }

    /** @param {boolean} autoplay - if true, immediately starts playback */
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

    /** Ends preview and restores the previous state. Returns the restored state name. */
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