import { byId, escapeHtml } from './utils.js';

// ── Toast ────────────────────────────────────────────────
export class ToastManager {
    constructor(containerId) {
        this.container = byId(containerId);
    }

    show(message, type = 'info') {
        const iconMap = {
            success: 'fa-circle-check',
            error:   'fa-circle-xmark',
            warning: 'fa-triangle-exclamation',
            info:    'fa-circle-info',
        };
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.innerHTML = `
            <i class="fa-solid ${iconMap[type]}" aria-hidden="true"></i>
            <span>${escapeHtml(message)}</span>
            <button class="toast-dismiss" aria-label="Dismiss">
                <i class="fa-solid fa-xmark" aria-hidden="true"></i>
            </button>
        `;
        toast.querySelector('.toast-dismiss').onclick = () => this.dismiss(toast);
        this.container.appendChild(toast);
        setTimeout(() => this.dismiss(toast), 4000);
    }

    dismiss(toast) {
        toast.classList.add('out');
        toast.addEventListener('animationend', () => toast.remove(), { once: true });
    }
}
