import { byId, escapeHtml } from './utils.js';

const ICON_MAP = {
    success: 'fa-circle-check',
    error:   'fa-circle-xmark',
    warning: 'fa-triangle-exclamation',
    info:    'fa-circle-info',
};

// ── Toast Notifications ──────────────────────────────────
export class ToastManager {
    constructor(containerId) {
        this.container = byId(containerId);
    }

    /** @param {string} message @param {'success'|'error'|'warning'|'info'} type */
    show(message, type = 'info') {
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.innerHTML = `
            <i class="fa-solid ${ICON_MAP[type] ?? ICON_MAP.info}" aria-hidden="true"></i>
            <span>${escapeHtml(message)}</span>
            <button class="toast-dismiss" aria-label="Dismiss">
                <i class="fa-solid fa-xmark" aria-hidden="true"></i>
            </button>
        `;
        toast.querySelector('.toast-dismiss').onclick = () => this.dismiss(toast);
        this.container.appendChild(toast);
        setTimeout(() => this.dismiss(toast), 4000);
    }

    /** @param {HTMLElement} toast */
    dismiss(toast) {
        toast.classList.add('out');
        toast.addEventListener('animationend', () => toast.remove(), { once: true });
    }
}