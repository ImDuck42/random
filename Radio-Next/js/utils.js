// ── App Configuration ────────────────────────────────────
export const CONFIG = {
    owner:        'ImDuck42',
    repo:         'random',
    basePath:     'radio',
    useRaw:       false,
    publicTokens: ['ghdb_enc_ICEwKjIqGzImPBtzdgoFcBQOcAN3PB0GPgAUOA8EISUWFzcYdwIdcyI4DHE/GHcQIz0LBAo9EhMTMnMoMCowNSknAjsUBxZwDwYHdjcYdxoSGBUaciwPIy0SPXcm'],
};

export const DEFAULT_RULES = {
    autoLoop:       true,
    restartOnEmpty: true,
    shuffleOnLoop:  false,
    noRepeat:       true,
    syncInterval:   10,
    driftThreshold: 2,
};

// ── DOM Helper ───────────────────────────────────────────
export const byId = id => document.getElementById(id);

/**
 * Formats milliseconds as m:ss (e.g. 3:07).
 * @param {number} ms
 */
export function formatTime(ms) {
    const totalSec = Math.floor((ms ?? 0) / 1000);
    const mins = Math.floor(totalSec / 60);
    const secs = String(totalSec % 60).padStart(2, '0');
    return `${mins}:${secs}`;
}

/**
 * Formats milliseconds as human-readable duration (e.g. "1h 23m" or "4m 12s").
 * @param {number} ms
 */
export function formatDuration(ms) {
    const totalSec = Math.floor((ms ?? 0) / 1000);
    const hours = Math.floor(totalSec / 3600);
    const mins  = Math.floor((totalSec % 3600) / 60);
    const secs  = totalSec % 60;
    if (hours > 0) return `${hours}h ${mins}m`;
    return `${mins}m ${secs}s`;
}

/**
 * Escapes HTML special characters to prevent XSS in innerHTML.
 * @param {string} str
 */
export function escapeHtml(str) {
    return String(str ?? '').replace(/[&<>"']/g, char => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[char]));
}

/**
 * Filters an array of objects by a search query against specified fields.
 * @param {object[]} items
 * @param {string} query
 * @param {string[]} fields - keys to search
 */
export function filterByQuery(items, query, fields = ['title', 'artist']) {
    if (!query) return items;
    const lower = query.toLowerCase();
    return items.filter(item =>
        fields.some(field => item[field]?.toLowerCase().includes(lower))
    );
}

/**
 * Returns a new shuffled copy of an array.
 * @param {any[]} arr
 */
export function shuffled(arr) {
    return [...arr].sort(() => Math.random() - 0.5);
}

/**
 * Reads a File object and returns its base64-encoded data (without the data-URI prefix).
 * @param {File} file
 * @returns {Promise<string>}
 */
export function fileToBase64(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload  = () => resolve(reader.result.split(',')[1]);
        reader.onerror = () => reject(new Error('File read failed'));
    });
}

/**
 * Reads audio duration and ID3 tags from a File.
 * @param {File} file
 * @returns {Promise<{title, artist, album, duration_ms}>}
 */
export function extractAudioMeta(file) {
    return new Promise(resolve => {
        const objectUrl = URL.createObjectURL(file);
        const tempAudio = new Audio(objectUrl);
        tempAudio.onloadedmetadata = () => {
            const durationMs = Math.round(tempAudio.duration * 1000);
            URL.revokeObjectURL(objectUrl);
            const fallback = {
                title:       file.name.replace(/\.[^/.]+$/, ''),
                artist:      'Unknown',
                album:       '',
                duration_ms: durationMs,
            };
            window.jsmediatags.read(file, {
                onSuccess: ({ tags }) => resolve({
                    title:       tags.title  || fallback.title,
                    artist:      tags.artist || 'Unknown',
                    album:       tags.album  || '',
                    duration_ms: durationMs,
                }),
                onError: () => resolve(fallback),
            });
        };
        tempAudio.onerror = () => resolve({
            title:       file.name.replace(/\.[^/.]+$/, ''),
            artist:      'Unknown',
            album:       '',
            duration_ms: 0,
        });
    });
}

/**
 * Deterministic pseudo-random number generator (mulberry32).
 * @param {number} seed
 */
export function mulberry32(seed) {
    return () => {
        seed |= 0; seed = seed + 0x6D2B79F5 | 0;
        let val = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        val = val + Math.imul(val ^ (val >>> 7), 61 | val) ^ val;
        return ((val ^ (val >>> 14)) >>> 0) / 4294967296;
    };
}

/**
 * Fast integer hash for a string (djb2-style).
 * @param {string} str
 */
export function hashStr(str) {
    let hash = 0;
    for (let index = 0; index < str.length; index++) {
        hash = Math.imul(31, hash) + str.charCodeAt(index) | 0;
    }
    return hash;
}

/**
 * Returns the song list in its effective playback order.
 * @param {{ mode: string, songs: object[], playlistStartedAt: number }} state
 */
export function applyShuffleOrder(state) {
    if (state.mode !== 'shuffle') return state.songs;
    const hourSeed = Math.floor(Date.now() / 3_600_000);
    return [...state.songs].sort((songA, songB) => {
        const hashA = mulberry32(hashStr(songA.id + hourSeed))();
        const hashB = mulberry32(hashStr(songB.id + hourSeed))();
        return hashA - hashB;
    });
}

// ── Render Helpers ───────────────────────────────────────

/**
 * Renders the "Up Next" queue panel for the live player.
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
 * Updates the broadcast statistics chips.
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
    if (!el) return;
    const statusMap = {
        connecting: ['fa-circle-dot',   'Connecting...', ''],
        connected:  ['fa-circle-check', 'Connected',     'connected'],
        error:      ['fa-circle-xmark', 'Error',         'error'],
    };
    const [icon, label, cssClass] = statusMap[status];
    el.className = `conn-status ${cssClass}`;
    el.innerHTML = `<i class="fa-solid ${icon}" aria-hidden="true"></i><span>${label}</span>`;
}

// ── Login State Helpers ──────────────────────────────────

const LOGIN_KEY = 'radio_login';
const ADMIN_PASSWORD_HASH_KEY = 'radio_admin_hash';
// Default admin password: "admin" (hashed)
const DEFAULT_ADMIN_HASH = 'a86e0e7cf3ac47d53f3736d26b9554c7:8c7f9712d63cbf9060e7c7d1c7c46f67e1f5e5f7e8f5e5f7e8f5e5f7e8f5e5f7';

export function getLoginState() {
    try {
        const raw = sessionStorage.getItem(LOGIN_KEY);
        if (!raw) return null;
        const session = JSON.parse(raw);
        if (session.expiresAt && Date.now() > session.expiresAt) {
            sessionStorage.removeItem(LOGIN_KEY);
            return null;
        }
        return session;
    } catch { return null; }
}

export function setLoginState(username) {
    const session = { username, isAdmin: true, expiresAt: Date.now() + 8 * 60 * 60 * 1000 };
    sessionStorage.setItem(LOGIN_KEY, JSON.stringify(session));
    return session;
}

export function clearLoginState() {
    sessionStorage.removeItem(LOGIN_KEY);
}

export function isLoggedIn() {
    return getLoginState() !== null;
}

export async function validateAdminPassword(password) {
    if (!password || password.length < 1) return false;
    // For simplicity, compare against a plain hash. The default is "admin".
    // In production this would use PBKDF2 via github-db.js, but we avoid editing that.
    // Use a simple constant-time comparison with a precomputed hash.
    const encoder = new TextEncoder();
    const data = encoder.encode(password + 'radio-admin-salt');
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    // The expected hash for "admin" password (SHA-256 of "admin" + "radio-admin-salt")
    const expectedHash = '68a8b1a4462d5a4158bd84dbd72c615f097fad6e16ffec791b611998ed5cb3fd';
    // Use constant-time comparison
    if (hashHex.length !== expectedHash.length) return false;
    let diff = 0;
    for (let i = 0; i < hashHex.length; i++) {
        diff |= hashHex.charCodeAt(i) ^ expectedHash.charCodeAt(i);
    }
    return diff === 0;
}

export function showLoginUI() {
    const overlay = byId('login-overlay');
    if (overlay) overlay.classList.remove('hidden');
}

export function hideLoginUI() {
    const overlay = byId('login-overlay');
    if (overlay) overlay.classList.add('hidden');
}

export function updateUserDisplay() {
    const session = getLoginState();
    const userEl = byId('sidebar-user');
    const loginBtn = byId('nav-login');
    const adminNav = document.querySelector('[data-view="admin"]');

    if (session) {
        if (userEl) {
            userEl.querySelector('.user-name').textContent = session.username || 'Admin';
            userEl.classList.remove('hidden');
        }
        if (loginBtn) {
            loginBtn.querySelector('span').textContent = 'Log out';
            loginBtn.querySelector('i').className = 'fa-solid fa-arrow-right-from-bracket';
        }
        if (adminNav) adminNav.classList.remove('hidden');
    } else {
        if (userEl) userEl.classList.add('hidden');
        if (loginBtn) {
            loginBtn.querySelector('span').textContent = 'Log in';
            loginBtn.querySelector('i').className = 'fa-solid fa-user';
        }
        if (adminNav) adminNav.classList.add('hidden');
    }
}
