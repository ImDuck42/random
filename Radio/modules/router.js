// ── Audio State Machine ──────────────────────────────────
// States: idle | live | catalogue | preview
export class AudioRouter {
    constructor(liveAudio, catAudio, previewAudio) {
        this.liveAudio    = liveAudio;
        this.catAudio     = catAudio;
        this.previewAudio = previewAudio;
        this.state        = 'idle';
        this.prevState    = null;
    }

    soloSource(source) {
        if (source !== 'live')    { this.liveAudio.pause(); document.body.classList.remove('playing'); }
        if (source !== 'cat')     { this.catAudio.pause(); }
        if (source !== 'preview') { this.previewAudio.pause(); }
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
