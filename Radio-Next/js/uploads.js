import { byId, escapeHtml, formatTime, extractAudioMeta, fileToBase64 } from './utils.js';
import { CONFIG } from './utils.js';

// ── Submission Manager ───────────────────────────────────

export class SubmissionManager {
    constructor(db, preview, toast) {
        this.db      = db;
        this.preview = preview;
        this.toast   = toast;

        this.initDropZone(
            byId('submission-upload-zone'),
            byId('submission-file-input'),
        );
    }

    initDropZone(zone, fileInput) {
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
            this.submitFiles(audioFiles);
        });
        fileInput.onchange = event => this.submitFiles([...event.target.files]);
    }

    async load() {
        if (!this.db) return;
        try {
            const all     = await this.db.collection('submissions').list();
            const pending = all.filter(sub => sub.status === 'pending');
            const countEl = byId('sub-count');
            if (countEl) countEl.textContent = `${pending.length} pending`;
            this.render(all);
        } catch (err) {
            console.warn('[submissions]', err);
        }
    }

    render(submissions) {
        const grid = byId('submissions-grid');
        if (!grid) return;
        if (!submissions.length) {
            grid.innerHTML = `
                <div class="empty-state large">
                    <i class="fa-solid fa-inbox" aria-hidden="true"></i>
                    <span>No submissions yet</span>
                </div>`;
            return;
        }
        grid.innerHTML = submissions.map(sub => {
            const statusClass = {
                approved: 'status-approved',
                declined: 'status-declined',
            }[sub.status] ?? 'status-pending';
            return `
            <div class="song-card" data-id="${sub.id}" role="listitem">
                <div class="card-art">
                    <div class="card-disc"><div class="card-hole"></div></div>
                </div>
                <div class="card-info">
                    <div class="card-title" title="${escapeHtml(sub.title ?? 'Unknown')}">${escapeHtml(sub.title ?? 'Unknown')}</div>
                    <div class="card-artist">${escapeHtml(sub.artist ?? 'Unknown')}</div>
                    <div class="sub-status ${statusClass}">${sub.status ?? 'pending'}</div>
                    <div class="card-dur">${formatTime(sub.duration_ms)}</div>
                </div>
            </div>`;
        }).join('');
    }

    async submitFiles(files) {
        await Promise.all(files.map(file => this.submitOne(file)));
    }

    async submitOne(file) {
        this.toast.show(`Submitting ${file.name}...`, 'info');
        try {
            const meta     = await extractAudioMeta(file);
            const base64   = await fileToBase64(file);
            const safeName = `${Date.now()}-${file.name.replace(/\s+/g, '_')}`;
            const filePath = `submissions/${safeName}`;

            await this.db.filesystem.fetchWithTokenFallback(
                this.db.filesystem.contentsUrl(filePath),
                {
                    method: 'PUT',
                    body: JSON.stringify({
                        message: `submit track: ${meta.title}`,
                        content: base64,
                        branch:  this.db.filesystem.branch,
                    }),
                }
            );

            const fileUrl = `https://raw.githubusercontent.com/${CONFIG.owner}/${CONFIG.repo}/${this.db.filesystem.branch}/${filePath}`;
            await this.db.collection('submissions').add({
                ...meta,
                fileUrl,
                status:      'pending',
                submittedAt: Date.now(),
            });

            this.toast.show(`Submitted: ${meta.title}`, 'success');
            this.load();
        } catch (err) {
            this.toast.show(`Submit failed: ${file.name}`, 'error');
            console.error(err);
        }
    }
}

// ── Music Uploader ───────────────────────────────────────

const UPLOAD_STATUS_ICONS = {
    pending:   'fa-clock',
    uploading: 'fa-spinner fa-spin',
    done:      'fa-circle-check',
    error:     'fa-circle-xmark',
};

export class Uploader {
    constructor(db, toast, onDone) {
        this.db     = db;
        this.toast  = toast;
        this.onDone = onDone;

        const zone  = byId('upload-zone');
        const input = byId('file-upload-input');
        if (!zone || !input) return;

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

    async handleFiles(files) {
        await Promise.all(files.map(file => this.uploadOne(file)));
    }

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
