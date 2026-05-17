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
 * Returns a new shuffled copy of an array (Fisher-Yates via sort shorthand).
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
 * Reads audio duration and ID3 tags from a File using the Web Audio API and jsmediatags.
 * Falls back gracefully if tags cannot be read.
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
        // Guard against files that fail to load metadata
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
 * Returns a function that produces a float in [0, 1) from the given seed.
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
 * In shuffle mode, songs are sorted using a seeded PRNG that changes hourly,
 * ensuring all listeners share the same order without a server round-trip.
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