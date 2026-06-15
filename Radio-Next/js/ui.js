import { byId, escapeHtml } from './utils.js';

// ── Toast Notifications ──────────────────────────────────

const ICON_MAP = {
    success: 'fa-circle-check',
    error:   'fa-circle-xmark',
    warning: 'fa-triangle-exclamation',
    info:    'fa-circle-info',
};

export class ToastManager {
    constructor(containerId) {
        this.container = byId(containerId);
    }

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

    dismiss(toast) {
        toast.classList.add('out');
        toast.addEventListener('animationend', () => toast.remove(), { once: true });
    }
}

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
