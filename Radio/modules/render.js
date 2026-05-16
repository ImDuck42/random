import { byId, escapeHtml, formatTime, formatDuration } from './utils.js';

// ── Render Helpers ───────────────────────────────────────
export function renderUpNext(currentSong, songList, rules) {
    const currentIdx = songList.findIndex(song => song.id === currentSong.id);
    const upcoming   = [
        ...songList.slice(currentIdx),
        ...(rules.autoLoop ? songList.slice(0, currentIdx) : []),
    ].slice(0, 20);

    byId('up-next-list').innerHTML = upcoming.map((song, idx) => `
        <div class="queue-item ${idx === 0 ? 'current' : ''}" role="listitem">
            <span class="item-num" aria-hidden="true">
                ${idx === 0 ? '<i class="fa-solid fa-volume-high"></i>' : idx}
            </span>
            <div class="item-info">
                <div class="item-title">${escapeHtml(song.title ?? 'Unknown')}</div>
                <div class="item-artist">${escapeHtml(song.artist ?? 'Unknown')}</div>
            </div>
            <span class="item-dur">${formatTime(song.duration_ms)}</span>
        </div>
    `).join('');
}

export function updateStats(state, songList) {
    if (!state) return;
    byId('stat-queue').textContent  = songList.length;
    byId('stat-mode').textContent   = state.mode ?? 'sequential';
    byId('stat-uptime').textContent = formatDuration(Date.now() - state.playlistStartedAt);
}

export function setConnStatus(status) {
    const el  = byId('conn-status');
    const map = {
        connecting: ['fa-circle-dot',   'Connecting...', ''],
        connected:  ['fa-circle-check', 'Connected',     'connected'],
        error:      ['fa-circle-xmark', 'Error',         'error'],
    };
    const [icon, label, cssClass] = map[status];
    el.className = `conn-status ${cssClass}`;
    el.innerHTML = `<i class="fa-solid ${icon}" aria-hidden="true"></i><span>${label}</span>`;
}
