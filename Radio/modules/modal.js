import { byId, escapeHtml } from './utils.js';

// ── Shared Modal ─────────────────────────────────────────
export class ModalManager {
    constructor() {
        this.overlay = byId('modal-overlay');
        byId('modal-close-btn').onclick = () => this.close();
        this.overlay.onclick = event => {
            if (event.target === this.overlay) this.close();
        };
    }

    open()  { this.overlay.classList.remove('hidden'); }

    close() {
        this.overlay.classList.add('hidden');
        this.overlay.querySelector('.modal')?.classList.remove('modal-wide');
    }

    /**
     * Opens a confirmation dialog with Cancel and Confirm buttons.
     * @param {string} title
     * @param {string} message
     * @param {() => Promise<void>} onConfirm
     */
    confirm(title, message, onConfirm) {
        byId('modal-title').textContent = title;
        byId('modal-body').innerHTML    = `<p>${escapeHtml(message)}</p>`;
        byId('modal-footer').innerHTML  = `
            <button class="btn-secondary" id="modal-cancel">Cancel</button>
            <button class="btn-danger" id="modal-confirm">Confirm</button>
        `;
        byId('modal-cancel').onclick  = () => this.close();
        byId('modal-confirm').onclick = async () => { this.close(); await onConfirm(); };
        this.open();
    }
}