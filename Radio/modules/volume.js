import { byId } from './utils.js';

// ── Volume Control ───────────────────────────────────────
export class VolumeControl {
    /**
     * @param {string} sliderId
     * @param {string} fillId
     * @param {string} muteBtnId
     * @param {HTMLAudioElement} audioTarget
     * @param {string|null} storageKey - localStorage key for persisting volume
     */
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

    /** Returns the current volume as a 0–1 float. */
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

    /** @param {number} vol - 0–100 */
    updateIcon(vol) {
        const icon = this.muteBtn.querySelector('i');
        icon.className = vol === 0
            ? 'fa-solid fa-volume-xmark'
            : vol < 50
                ? 'fa-solid fa-volume-low'
                : 'fa-solid fa-volume-high';
    }
}