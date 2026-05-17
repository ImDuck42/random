import { byId, escapeHtml, extractAudioMeta, fileToBase64 } from './utils.js';
import { CONFIG } from './config.js';

const UPLOAD_STATUS_ICONS = {
    pending:   'fa-clock',
    uploading: 'fa-spinner fa-spin',
    done:      'fa-circle-check',
    error:     'fa-circle-xmark',
};

// ── Music Uploader ───────────────────────────────────────
export class Uploader {
    /**
     * @param {object} db
     * @param {ToastManager} toast
     * @param {() => void} onDone - called after each successful upload
     */
    constructor(db, toast, onDone) {
        this.db     = db;
        this.toast  = toast;
        this.onDone = onDone;

        const zone  = byId('upload-zone');
        const input = byId('file-upload-input');

        zone.addEventListener('dragover', event => {
            event.preventDefault();
            zone.classList.add('drag-over');
        });
        zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
        zone.addEventListener('drop', event => {
            event.preventDefault();
            zone.classList.remove('drag-over');
            const audioFiles = [...event.dataTransfer.files].filter(
                file => file.type.startsWith('audio/')
            );
            this.handleFiles(audioFiles);
        });
        input.onchange = event => this.handleFiles([...event.target.files]);
    }

    /** @param {File[]} files */
    async handleFiles(files) {
        await Promise.all(files.map(file => this.uploadOne(file)));
    }

    /** @param {File} file */
    async uploadOne(file) {
        const item = this.createQueueItem(file.name);
        byId('upload-queue').prepend(item.el);

        try {
            item.setStatus('uploading');
            const meta     = await extractAudioMeta(file);
            const base64   = await fileToBase64(file);
            const safeName = `${Date.now()}-${file.name.replace(/\s+/g, '_')}`;
            const filePath = `music/${safeName}`;

            item.setProgress(40);

            await this.db.filesystem.fetchWithTokenFallback(
                this.db.filesystem.contentsUrl(filePath),
                {
                    method: 'PUT',
                    body: JSON.stringify({
                        message: `add track: ${meta.title}`,
                        content: base64,
                        branch:  this.db.filesystem.branch,
                    }),
                }
            );

            item.setProgress(80);

            const fileUrl = `https://raw.githubusercontent.com/${CONFIG.owner}/${CONFIG.repo}/${this.db.filesystem.branch}/${filePath}`;
            await this.db.collection('songs').add({ ...meta, fileUrl });

            item.setProgress(100);
            item.setStatus('done');
            this.toast.show(`Uploaded: ${meta.title}`, 'success');
            this.onDone?.();
        } catch (err) {
            item.setStatus('error');
            this.toast.show(`Upload failed: ${file.name}`, 'error');
            console.error(err);
        }
    }

    /**
     * Creates and returns a queue item element with progress/status controls.
     * @param {string} fileName
     */
    createQueueItem(fileName) {
        const el = document.createElement('div');
        el.className = 'upload-item';
        el.innerHTML = `
            <div class="upload-item-info">
                <div class="upload-item-name">${escapeHtml(fileName)}</div>
                <div class="upload-prog-wrap">
                    <div class="upload-prog-bar" style="width:0%"></div>
                </div>
            </div>
            <i class="fa-solid fa-clock upload-status-icon pending" aria-hidden="true"></i>
        `;
        return {
            el,
            setProgress: pct => {
                el.querySelector('.upload-prog-bar').style.width = pct + '%';
            },
            setStatus: status => {
                const icon = el.querySelector('.upload-status-icon');
                icon.className = `fa-solid ${UPLOAD_STATUS_ICONS[status] ?? 'fa-clock'} upload-status-icon ${status}`;
            },
        };
    }
}