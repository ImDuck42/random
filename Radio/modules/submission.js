import { byId, escapeHtml, formatTime, extractAudioMeta, fileToBase64 } from './utils.js';
import { CONFIG } from './config.js';

// ── Submission Manager ───────────────────────────────────
export class SubmissionManager {
    constructor(db, preview, toast) {
        this.db      = db;
        this.preview = preview;
        this.toast   = toast;

        const zone = byId('submission-upload-zone');
        zone.addEventListener('dragover', ev => { ev.preventDefault(); zone.classList.add('drag-over'); });
        zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
        zone.addEventListener('drop', ev => {
            ev.preventDefault();
            zone.classList.remove('drag-over');
            const files = [...ev.dataTransfer.files].filter(file => file.type.startsWith('audio/'));
            this.submitFiles(files);
        });
        byId('submission-file-input').onchange = ev => this.submitFiles([...ev.target.files]);
    }

    async load() {
        if (!this.db) return;
        try {
            const all     = await this.db.collection('submissions').list();
            const pending = all.filter(sub => sub.status === 'pending');
            byId('sub-count').textContent = `${pending.length} pending`;
            this.render(all);
        } catch (err) {
            console.warn('[submissions]', err);
        }
    }

    render(submissions) {
        const grid = byId('submissions-grid');
        if (!submissions.length) {
            grid.innerHTML = `<div class="empty-state large"><i class="fa-solid fa-inbox" aria-hidden="true"></i><span>No submissions yet</span></div>`;
            return;
        }
        grid.innerHTML = submissions.map(sub => {
            const statusClass = sub.status === 'approved' ? 'status-approved'
                              : sub.status === 'declined' ? 'status-declined'
                              : 'status-pending';
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

            await this.db.filesystem.fetchWithTokenFallback(this.db.filesystem.contentsUrl(filePath), {
                method: 'PUT',
                body: JSON.stringify({
                    message: `submit track: ${meta.title}`,
                    content: base64,
                    branch:  this.db.filesystem.branch,
                }),
            });

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
