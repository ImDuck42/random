import { byId, escapeHtml, formatTime, formatDuration } from './utils.js';

/**
 * Renders the "Up Next" queue panel for the live player.
 * Shows up to 20 upcoming songs with the current track highlighted.
 * @param {{ id: string }} currentSong
 * @param {object[]} songList
 * @param {{ autoLoop: boolean }} rules
 */
export function renderUpNext(currentSong, songList, rules) {
    const currentIndex = songList.findIndex(song => song.id === currentSong.id);
    const upcoming = [
        ...songList.slice(currentIndex),
        ...(rules.autoLoop ? songList.slice(0, currentIndex) : []),
    ].slice(0, 20);

    byId('up-next-list').innerHTML = upcoming.map((song, index) => `
        <div class="queue-item ${index === 0 ? 'current' : ''}" role="listitem">
            <span class="item-num" aria-hidden="true">
                ${index === 0 ? '<i class="fa-solid fa-volume-high"></i>' : index}
            </span>
            <div class="item-info">
                <div class="item-title">${escapeHtml(song.title ?? 'Unknown')}</div>
                <div class="item-artist">${escapeHtml(song.artist ?? 'Unknown')}</div>
            </div>
            <span class="item-dur">${formatTime(song.duration_ms)}</span>
        </div>
    `).join('');
}

/**
 * Updates the broadcast statistics chips (queue size, mode, uptime).
 * @param {{ mode: string, playlistStartedAt: number } | null} state
 * @param {object[]} songList
 */
export function updateStats(state, songList) {
    if (!state) return;
    byId('stat-queue').textContent  = songList.length;
    byId('stat-mode').textContent   = state.mode ?? 'sequential';
    byId('stat-uptime').textContent = formatDuration(Date.now() - state.playlistStartedAt);
}

/**
 * Updates the connection status indicator in the sidebar.
 * @param {'connecting' | 'connected' | 'error'} status
 */
export function setConnStatus(status) {
    const el = byId('conn-status');
    const statusMap = {
        connecting: ['fa-circle-dot',   'Connecting...', ''],
        connected:  ['fa-circle-check', 'Connected',     'connected'],
        error:      ['fa-circle-xmark', 'Error',         'error'],
    };
    const [icon, label, cssClass] = statusMap[status];
    el.className = `conn-status ${cssClass}`;
    el.innerHTML = `<i class="fa-solid ${icon}" aria-hidden="true"></i><span>${label}</span>`;
}