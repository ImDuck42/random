// ── Helpers ──────────────────────────────────────────────
export const byId = id => document.getElementById(id);

export function formatTime(ms) {
    const totalSec = Math.floor((ms ?? 0) / 1000);
    const mins = Math.floor(totalSec / 60);
    const secs = (totalSec % 60).toString().padStart(2, '0');
    return `${mins}:${secs}`;
}

export function formatDuration(ms) {
    const totalSec = Math.floor((ms ?? 0) / 1000);
    const hours = Math.floor(totalSec / 3600);
    const mins  = Math.floor((totalSec % 3600) / 60);
    const secs  = totalSec % 60;
    if (hours > 0) return `${hours}h ${mins}m`;
    return `${mins}m ${secs}s`;
}

export function escapeHtml(str) {
    return String(str ?? '').replace(/[&<>"']/g, ch => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[ch]));
}

export function filterByQuery(songs, query) {
    if (!query) return songs;
    const lower = query.toLowerCase();
    return songs.filter(song =>
        song.title?.toLowerCase().includes(lower) ||
        song.artist?.toLowerCase().includes(lower)
    );
}

export function shuffled(arr) {
    return [...arr].sort(() => Math.random() - 0.5);
}

export function fileToBase64(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload  = () => resolve(reader.result.split(',')[1]);
        reader.onerror = () => reject(new Error('File read failed'));
    });
}

export function extractAudioMeta(file) {
    return new Promise(resolve => {
        const objectUrl = URL.createObjectURL(file);
        const tempAudio = new Audio(objectUrl);
        tempAudio.onloadedmetadata = () => {
            const durationMs = Math.round(tempAudio.duration * 1000);
            URL.revokeObjectURL(objectUrl);
            window.jsmediatags.read(file, {
                onSuccess: tags => resolve({
                    title:       tags.tags.title  || file.name.replace(/\.[^/.]+$/, ''),
                    artist:      tags.tags.artist || 'Unknown',
                    album:       tags.tags.album  || '',
                    duration_ms: durationMs,
                }),
                onError: () => resolve({
                    title:       file.name.replace(/\.[^/.]+$/, ''),
                    artist:      'Unknown',
                    album:       '',
                    duration_ms: durationMs,
                }),
            });
        };
    });
}

export function mulberry32(seed) {
    return () => {
        seed |= 0; seed = seed + 0x6D2B79F5 | 0;
        let val = Math.imul(seed ^ seed >>> 15, 1 | seed);
        val = val + Math.imul(val ^ val >>> 7, 61 | val) ^ val;
        return ((val ^ val >>> 14) >>> 0) / 4294967296;
    };
}

export function hashStr(str) {
    let hash = 0;
    for (let idx = 0; idx < str.length; idx++) {
        hash = Math.imul(31, hash) + str.charCodeAt(idx) | 0;
    }
    return hash;
}

export function applyShuffleOrder(state) {
    if (state.mode !== 'shuffle') return state.songs;
    const hourSeed = Math.floor(Date.now() / 3_600_000);
    return [...state.songs].sort((songA, songB) => {
        const hashA = mulberry32(hashStr(songA.id + hourSeed))();
        const hashB = mulberry32(hashStr(songB.id + hourSeed))();
        return hashA - hashB;
    });
}
