// ── Submission Preview Player ────────────────────────────
export class PreviewPlayer {
    /**
     * @param {AudioRouter} router
     * @param {ToastManager} toast
     * @param {{ onRestoreCat?: () => void }} options
     */
    constructor(router, toast, { onRestoreCat } = {}) {
        this.router       = router;
        this.toast        = toast;
        this.onRestoreCat = onRestoreCat ?? null;
        this.audio        = new Audio();
        this.activeBtn    = null;

        this.audio.onended = () => this.stop();
    }

    /**
     * Plays or toggles a preview track.
     * @param {string} url
     * @param {string} title
     * @param {HTMLElement|null} btnEl - the button that triggered playback
     */
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