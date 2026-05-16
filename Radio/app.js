import { GitHubDB } from './github-db.js';

// ── Config ──────────────────────────────────────────────
const CONFIG = {
    owner:        'ImDuck42',
    repo:         'random',
    basePath:     'radio',
    useRaw:       false,
    publicTokens: ['ghdb_enc_ICEwKjIqGzImPBtzdgoFcBQOcAN3PB0GPgAUOA8EISUWFzcYdwIdcyI4DHE/GHcQIz0LBAo9EhMTMnMoMCowNSknAjsUBxZwDwYHdjcYdxoSGBUaciwPIy0SPXcm'],
};

const DEFAULT_RULES = {
    autoLoop:       true,
    restartOnEmpty: true,
    shuffleOnLoop:  false,
    noRepeat:       true,
    syncInterval:   2,
    driftThreshold: 2,
};

// ── State ────────────────────────────────────────────────
let db;
let rules           = { ...DEFAULT_RULES };
let currentState    = null;
let allSongs        = [];
let playlists       = [];
let selectedSongs   = new Set();
let activePlistId   = null;
let syncIntervalId  = null;
let progressRafId   = null;
let isAdminUnlocked = false;

// ── DOM helpers ──────────────────────────────────────────
const getEl  = id => document.getElementById(id);
const radioAudio = getEl('radio-audio');

// ── Boot ─────────────────────────────────────────────────
async function init() {
    setStatus('connecting');
    try {
        db = await GitHubDB.public({ ...CONFIG });
        db.permissions({
            songs:              { read: 'public', write: 'public' },
            playlists:          { read: 'public', write: 'public' },
            '_kv.radio_state':  { read: 'public', write: 'public' },
            '_kv.radio_rules':  { read: 'public', write: 'public' },
        });
        setStatus('connected');
    } catch (err) {
        setStatus('error');
        showToast('Failed to connect to GitHub DB', 'error');
        console.error(err);
        return;
    }

    await loadRules();
    startSyncLoop();
    exposeAdminAPI();
}

// ── DevTools Admin API ───────────────────────────────────
function exposeAdminAPI() {
    window.radio = {
        admin: async function(password = '') {
            if (isAdminUnlocked) {
                console.info('%c[GHDB Radio] Admin panel is already open.', 'color:#cba6f7;font-weight:bold');
                return;
            }
            const expected = rules.adminPasswordHash;

            let isMatch = false;
            if (!expected) {
                isMatch = password === 'admin';
            } else {
                isMatch = await GitHubDB.verifySecret(password, expected, 'radio-admin');
            }

            if (!isMatch) {
                console.warn('%c[GHDB Radio] Wrong password. Usage: radio.admin("yourpassword")', 'color:#f38ba8');
                return;
            }
            console.info('%c[GHDB Radio] Admin panel unlocked. Welcome!', 'color:#a6e3a1;font-weight:bold');
            openAdmin();
        },
        help() {
            console.info(`%c
╔══════════════════════════════════════════╗
║        GHDB Radio DevTools API           ║
╠══════════════════════════════════════════╣
║  radio.admin("password") — open admin    ║
║  radio.status()          — broadcast     ║
║  radio.help()            — this menu     ║
╚══════════════════════════════════════════╝
`, 'color:#cba6f7;font-family:monospace');
        },
        status() {
            console.table(currentState ?? { status: 'No broadcast' });
        },
    };
    console.info('%c[GHDB Radio] Type radio.help() for DevTools commands.', 'color:#89b4fa;font-family:monospace');
}

// ── Sync Loop ────────────────────────────────────────────
function startSyncLoop() {
    if (syncIntervalId) clearInterval(syncIntervalId);

    const tick = async () => {
        try {
            const state = await db.kv.get('radio_state');
            currentState = state;

            if (!state?.songs?.length) {
                setOffline();
                return;
            }

            const totalMs = state.songs.reduce((acc, song) => acc + song.duration_ms, 0);
            if (totalMs === 0) return;

            let elapsed = Date.now() - state.playlistStartedAt;

            if (rules.autoLoop) {
                elapsed = elapsed % totalMs;
            } else if (elapsed > totalMs) {
                setOffline();
                return;
            }

            const songList = applyShuffleOrder(state);
            let runningMs  = 0;

            for (const song of songList) {
                const songEnd = runningMs + song.duration_ms;
                if (elapsed >= runningMs && elapsed < songEnd) {
                    syncAudioToOffset(song, elapsed - runningMs, songList);
                    break;
                }
                runningMs = songEnd;
            }

            updateStats(state, songList);
        } catch (err) {
            console.warn('[sync]', err);
        }
    };

    tick();
    syncIntervalId = setInterval(tick, (rules.syncInterval ?? 10) * 1000);
}

// Produces a deterministic per-hour order for shuffle mode so all listeners hear the same thing
function applyShuffleOrder(state) {
    if (state.mode !== 'shuffle') return state.songs;

    const hourSeed = Math.floor(Date.now() / 3_600_000);
    return [...state.songs].sort((songA, songB) => {
        const hashA = mulberry32(hashString(songA.id + hourSeed))();
        const hashB = mulberry32(hashString(songB.id + hourSeed))();
        return hashA - hashB;
    });
}

function mulberry32(seed) {
    return () => {
        seed |= 0; seed = seed + 0x6D2B79F5 | 0;
        let val = Math.imul(seed ^ seed >>> 15, 1 | seed);
        val = val + Math.imul(val ^ val >>> 7, 61 | val) ^ val;
        return ((val ^ val >>> 14) >>> 0) / 4294967296;
    };
}

function hashString(str) {
    let hash = 0;
    for (let idx = 0; idx < str.length; idx++) {
        hash = Math.imul(31, hash) + str.charCodeAt(idx) | 0;
    }
    return hash;
}

function syncAudioToOffset(song, offsetMs, allInQueue) {
    const offsetSec = offsetMs / 1000;

    getEl('now-playing-title').textContent  = song.title  ?? 'Unknown';
    getEl('now-playing-artist').textContent = song.artist ?? 'Unknown';
    getEl('time-total').textContent         = formatTime(song.duration_ms);
    document.title = `${song.title} — GHDB Radio`;

    if (!catIsPlaying) {
        if (radioAudio.src !== song.fileUrl) {
            radioAudio.src         = song.fileUrl;
            radioAudio.currentTime = offsetSec;
            radioAudio.volume      = getLiveVolume();
            radioAudio.play().catch(() => {});
            document.body.classList.add('playing');
        } else {
            if (radioAudio.paused) {
                radioAudio.currentTime = offsetSec;
                radioAudio.play().catch(() => {});
                document.body.classList.add('playing');
            } else if (Math.abs(radioAudio.currentTime - offsetSec) > (rules.driftThreshold ?? 2)) {
                radioAudio.currentTime = offsetSec;
            }
        }
    } else {
        // Catalogue is active — keep src updated silently so live resumes cleanly
        if (radioAudio.src !== song.fileUrl) {
            radioAudio.src         = song.fileUrl;
            radioAudio.currentTime = offsetSec;
            radioAudio.volume      = getLiveVolume();
        }
    }

    renderUpNext(song, allInQueue);
    startProgressLoop(song);
}

function startProgressLoop(song) {
    if (progressRafId) cancelAnimationFrame(progressRafId);

    const tick = () => {
        const currentMs  = radioAudio.currentTime * 1000;
        const pct        = Math.min((currentMs / song.duration_ms) * 100, 100);
        const pctStr     = pct + '%';
        getEl('progress-bar-fill').style.width = pctStr;
        getEl('progress-thumb').style.left     = pctStr;
        getEl('time-current').textContent      = formatTime(currentMs);
        progressRafId = requestAnimationFrame(tick);
    };

    tick();
}

function setOffline() {
    if (progressRafId) {
        cancelAnimationFrame(progressRafId);
        progressRafId = null;
    }
    getEl('now-playing-title').textContent  = 'Offline';
    getEl('now-playing-artist').textContent = 'Waiting for broadcast...';
    document.body.classList.remove('playing');
    document.title = 'GHDB Radio';
    getEl('up-next-list').innerHTML = `
        <div class="empty-state">
            <i class="fa-solid fa-satellite-dish" aria-hidden="true"></i>
            <span>No broadcast active</span>
        </div>`;
    getEl('stat-queue').textContent  = '—';
    getEl('stat-mode').textContent   = '—';
    getEl('stat-uptime').textContent = '—';
}

function updateStats(state, songList) {
    getEl('stat-queue').textContent  = songList.length;
    getEl('stat-mode').textContent   = state.mode ?? 'sequential';
    const uptimeMs = Date.now() - state.playlistStartedAt;
    getEl('stat-uptime').textContent = formatDuration(uptimeMs);
}

function renderUpNext(currentSong, songList) {
    const currentIndex = songList.findIndex(song => song.id === currentSong.id);
    const upcoming = [
        ...songList.slice(currentIndex),
        ...(rules.autoLoop ? songList.slice(0, currentIndex) : []),
    ].slice(0, 20);

    getEl('up-next-list').innerHTML = upcoming.map((song, index) => `
        <div class="up-next-item ${index === 0 ? 'current' : ''}" role="listitem">
            <span class="up-next-num" aria-hidden="true">
                ${index === 0 ? '<i class="fa-solid fa-volume-high"></i>' : index}
            </span>
            <div class="up-next-info">
                <div class="up-title">${escapeHtml(song.title ?? 'Unknown')}</div>
                <div class="up-artist">${escapeHtml(song.artist ?? 'Unknown')}</div>
            </div>
            <span class="up-next-dur">${formatTime(song.duration_ms)}</span>
        </div>
    `).join('');
}

// ── Admin Panel ──────────────────────────────────────────
function openAdmin() {
    isAdminUnlocked = true;
    getEl('admin-overlay').classList.remove('hidden');
    loadAdminData();
}

function closeAdmin() {
    getEl('admin-overlay').classList.add('hidden');
    isAdminUnlocked = false;
}

getEl('admin-close-btn').onclick = closeAdmin;

document.querySelectorAll('.admin-nav-btn').forEach(btn => {
    btn.onclick = () => {
        document.querySelectorAll('.admin-nav-btn').forEach(navBtn => navBtn.classList.remove('active'));
        document.querySelectorAll('.admin-panel').forEach(panel => panel.classList.remove('active'));
        btn.classList.add('active');
        getEl('panel-' + btn.dataset.panel)?.classList.add('active');
    };
});

async function loadAdminData() {
    await Promise.all([
        loadLibrary(),
        loadPlaylists(),
        loadBroadcastStatus(),
        applyRulesToForm(),
    ]);
    populatePlaylistDropdown();
}

// ── Broadcast ────────────────────────────────────────────
async function loadBroadcastStatus() {
    const state = await db.kv.get('radio_state');
    const badge = getEl('on-air-badge');
    const info  = getEl('broadcast-info');

    if (!state?.songs?.length) {
        badge.classList.remove('live');
        badge.querySelector('span:last-child').textContent = 'OFF AIR';
        info.innerHTML = `<div class="empty-state">
            <i class="fa-solid fa-satellite-dish" aria-hidden="true"></i>
            <span>No active broadcast</span>
        </div>`;
        return;
    }

    badge.classList.add('live');
    badge.querySelector('span:last-child').textContent = 'ON AIR';

    const totalMs      = state.songs.reduce((acc, song) => acc + song.duration_ms, 0);
    const elapsed      = Date.now() - state.playlistStartedAt;
    const loopElapsed  = rules.autoLoop ? elapsed % totalMs : elapsed;
    let runningMs      = 0;
    let currentTrack   = null;

    for (const song of state.songs) {
        if (loopElapsed >= runningMs && loopElapsed < runningMs + song.duration_ms) {
            currentTrack = song;
            break;
        }
        runningMs += song.duration_ms;
    }

    info.innerHTML = `
        <div class="broadcast-track">${escapeHtml(currentTrack?.title ?? 'Unknown')}</div>
        <div class="broadcast-meta">
            <i class="fa-solid fa-user" aria-hidden="true"></i> ${escapeHtml(currentTrack?.artist ?? '')}
            &nbsp;·&nbsp;
            <i class="fa-solid fa-bars-staggered" aria-hidden="true"></i> ${state.songs.length} tracks
            &nbsp;·&nbsp;
            <i class="fa-solid fa-repeat" aria-hidden="true"></i> ${state.mode ?? 'sequential'}
        </div>
    `;
}

getEl('go-live-btn').onclick = async () => {
    const playlistId = getEl('quick-playlist-select').value;
    if (!playlistId) { showToast('Select a playlist first', 'warning'); return; }

    const playlist = playlists.find(pl => pl.id === playlistId);
    if (!playlist?.songs?.length) { showToast('Playlist is empty', 'warning'); return; }

    const mode = document.querySelector('input[name="playback-mode"]:checked')?.value ?? 'sequential';
    let songs   = await Promise.all(playlist.songs.map(id => db.collection('songs').get(id)));
    songs       = songs.filter(Boolean);

    if (mode === 'shuffle') songs = shuffleArray(songs);

    await db.kv.set('radio_state', {
        playlistStartedAt: Date.now(),
        songs,
        mode,
        playlistId,
    });

    showToast(`🔴 Now broadcasting: ${playlist.name}`, 'success');
    loadBroadcastStatus();
    startSyncLoop();
};

getEl('stop-broadcast-btn').onclick = () => {
    openConfirmModal(
        'Stop Broadcast',
        'Stop the current broadcast? Listeners will be disconnected.',
        async () => {
            await db.kv.delete('radio_state');
            setOffline();
            loadBroadcastStatus();
            showToast('Broadcast stopped', 'info');
        }
    );
};

getEl('skip-track-btn').onclick = async () => {
    const state = await db.kv.get('radio_state');
    if (!state?.songs?.length) { showToast('No active broadcast', 'warning'); return; }

    const totalMs  = state.songs.reduce((acc, song) => acc + song.duration_ms, 0);
    const elapsed  = (Date.now() - state.playlistStartedAt) % totalMs;
    let runningMs  = 0;
    let currentIdx = 0;

    for (let idx = 0; idx < state.songs.length; idx++) {
        if (elapsed >= runningMs && elapsed < runningMs + state.songs[idx].duration_ms) {
            currentIdx = idx;
            break;
        }
        runningMs += state.songs[idx].duration_ms;
    }

    const nextIdx  = (currentIdx + 1) % state.songs.length;
    let skipMs     = 0;
    for (let idx = 0; idx < nextIdx; idx++) skipMs += state.songs[idx].duration_ms;

    await db.kv.set('radio_state', { ...state, playlistStartedAt: Date.now() - skipMs });
    startSyncLoop();
    showToast('Skipped to next track', 'info');
};

// ── Library ──────────────────────────────────────────────
async function loadLibrary() {
    allSongs = await db.collection('songs').list();
    renderLibrary(allSongs);

    const totalMs = allSongs.reduce((acc, song) => acc + (song.duration_ms ?? 0), 0);
    getEl('lib-total').textContent    = allSongs.length;
    getEl('lib-duration').textContent = formatDuration(totalMs);
}

function renderLibrary(songs) {
    const tbody = getEl('library-tbody');
    if (!songs.length) {
        tbody.innerHTML = `<tr><td colspan="6"><div class="empty-state">No songs in library</div></td></tr>`;
        return;
    }
    tbody.innerHTML = songs.map((song, index) => `
        <tr data-id="${song.id}">
            <td><input type="checkbox" class="song-check" value="${song.id}"
                       aria-label="Select ${escapeHtml(song.title ?? 'song')}"
                       ${selectedSongs.has(song.id) ? 'checked' : ''}></td>
            <td class="track-num">${index + 1}</td>
            <td class="track-title">${escapeHtml(song.title ?? 'Unknown')}</td>
            <td>${escapeHtml(song.artist ?? 'Unknown')}</td>
            <td class="track-dur">${formatTime(song.duration_ms)}</td>
            <td class="track-actions">
                <button class="icon-btn delete-song-btn" data-id="${song.id}"
                        aria-label="Delete ${escapeHtml(song.title ?? 'song')}">
                    <i class="fa-solid fa-trash" aria-hidden="true"></i>
                </button>
            </td>
        </tr>
    `).join('');

    tbody.querySelectorAll('.song-check').forEach(checkbox => {
        checkbox.onchange = () => {
            if (checkbox.checked) selectedSongs.add(checkbox.value);
            else selectedSongs.delete(checkbox.value);
            updateBulkActionsCount();
        };
    });

    tbody.querySelectorAll('.delete-song-btn').forEach(btn => {
        btn.onclick = () => confirmDeleteSong(btn.dataset.id);
    });
}

getEl('select-all-checkbox').onchange = (event) => {
    document.querySelectorAll('.song-check').forEach(checkbox => {
        checkbox.checked = event.target.checked;
        if (event.target.checked) selectedSongs.add(checkbox.value);
        else selectedSongs.delete(checkbox.value);
    });
    updateBulkActionsCount();
};

function updateBulkActionsCount() {
    getEl('selected-count').textContent = `${selectedSongs.size} selected`;
}

getEl('library-search').oninput = (event) => {
    const query    = event.target.value.toLowerCase();
    const filtered = filterSongs(allSongs, query);
    renderLibrary(filtered);
};

getEl('refresh-library-btn').onclick = loadLibrary;

async function confirmDeleteSong(songId) {
    const song = allSongs.find(item => item.id === songId);
    openConfirmModal(
        'Delete Song',
        `Delete "${escapeHtml(song?.title ?? 'this song')}"? This cannot be undone.`,
        async () => {
            await db.collection('songs').remove(songId);
            showToast(`Deleted: ${song?.title}`, 'info');
            loadLibrary();
        }
    );
}

getEl('bulk-delete-btn').onclick = () => {
    if (!selectedSongs.size) { showToast('No songs selected', 'warning'); return; }
    const count = selectedSongs.size;
    openConfirmModal(
        'Delete Songs',
        `Delete ${count} song(s)? This cannot be undone.`,
        async () => {
            await db.collection('songs').bulkRemove([...selectedSongs]);
            selectedSongs.clear();
            updateBulkActionsCount();
            showToast(`Deleted ${count} tracks`, 'success');
            loadLibrary();
        }
    );
};

getEl('add-to-playlist-btn').onclick = () => {
    if (!selectedSongs.size) { showToast('Select songs first', 'warning'); return; }
    openAddToPlaylistModal([...selectedSongs]);
};

function openAddToPlaylistModal(songIds) {
    getEl('modal-title').textContent = 'Add to Playlist';
    getEl('modal-body').innerHTML = `
        <div class="pl-select-list">
            ${playlists.map(pl => `
                <div class="pl-select-item" data-id="${pl.id}" role="option" tabindex="0">
                    <i class="fa-solid fa-bars-staggered" aria-hidden="true"></i>
                    <span>${escapeHtml(pl.name)}</span>
                    <small>${pl.songs?.length ?? 0} tracks</small>
                </div>
            `).join('')}
        </div>
        ${!playlists.length
            ? '<div class="empty-state"><i class="fa-solid fa-bars-staggered" aria-hidden="true"></i><span>No playlists yet. Create one first.</span></div>'
            : ''
        }
    `;

    let chosenId = null;
    getEl('modal-body').querySelectorAll('.pl-select-item').forEach(item => {
        item.onclick = () => {
            getEl('modal-body').querySelectorAll('.pl-select-item').forEach(el => el.classList.remove('selected'));
            item.classList.add('selected');
            chosenId = item.dataset.id;
        };
    });

    getEl('modal-footer').innerHTML = `
        <button class="btn-secondary" id="modal-cancel">Cancel</button>
        <button class="btn-primary" id="modal-confirm">Add Songs</button>
    `;
    getEl('modal-cancel').onclick = closeModal;
    getEl('modal-confirm').onclick = async () => {
        if (!chosenId) { showToast('Select a playlist', 'warning'); return; }
        const playlist      = playlists.find(pl => pl.id === chosenId);
        const existingSet   = new Set(playlist.songs ?? []);
        songIds.forEach(id => existingSet.add(id));
        await db.collection('playlists').update(chosenId, { songs: [...existingSet] });
        showToast(`Added ${songIds.length} track(s) to ${playlist.name}`, 'success');
        loadPlaylists();
        closeModal();
    };
    openModal();
}

// ── Playlists ────────────────────────────────────────────
async function loadPlaylists() {
    playlists = await db.collection('playlists').list();
    renderPlaylistList();
    populatePlaylistDropdown();
}

function renderPlaylistList() {
    const container = getEl('playlist-list');
    if (!playlists.length) {
        container.innerHTML = '<div class="empty-state">No playlists yet</div>';
        return;
    }
    container.innerHTML = playlists.map(pl => `
        <div class="playlist-item ${pl.id === activePlistId ? 'active' : ''}"
             data-id="${pl.id}" role="listitem" tabindex="0">
            <i class="fa-solid fa-music pl-icon" aria-hidden="true"></i>
            <span class="pl-name">${escapeHtml(pl.name)}</span>
            <span class="pl-count">${pl.songs?.length ?? 0}</span>
        </div>
    `).join('');

    container.querySelectorAll('.playlist-item').forEach(item => {
        item.onclick = () => {
            activePlistId = item.dataset.id;
            renderPlaylistList();
            openPlaylistEditor(item.dataset.id);
        };
    });
}

function populatePlaylistDropdown() {
    const select = getEl('quick-playlist-select');
    select.innerHTML = `<option value="">Choose a playlist...</option>` +
        playlists.map(pl => `<option value="${pl.id}">${escapeHtml(pl.name)}</option>`).join('');
}

async function openPlaylistEditor(playlistId) {
    const playlist = playlists.find(pl => pl.id === playlistId);
    if (!playlist) return;

    const songIds = playlist.songs ?? [];
    const tracks  = (await Promise.all(songIds.map(sid => db.collection('songs').get(sid)))).filter(Boolean);
    const editor  = getEl('playlist-editor');

    editor.innerHTML = `
        <div class="playlist-editor-header">
            <span class="pl-edit-name">${escapeHtml(playlist.name)}</span>
            <div class="pl-edit-actions">
                <button class="btn-secondary" id="shuffle-playlist-btn">
                    <i class="fa-solid fa-shuffle" aria-hidden="true"></i> Shuffle
                </button>
                <button class="btn-danger" id="delete-playlist-btn">
                    <i class="fa-solid fa-trash" aria-hidden="true"></i> Delete
                </button>
            </div>
        </div>
        <div class="playlist-editor-body" id="playlist-editor-body">
            ${tracks.length
                ? tracks.map((song, index) => `
                    <div class="pl-song-item" data-id="${song.id}">
                        <i class="fa-solid fa-grip-lines drag-handle" aria-hidden="true"></i>
                        <span class="pl-song-num">${index + 1}</span>
                        <div class="pl-song-info">
                            <div class="pl-song-title">${escapeHtml(song.title ?? 'Unknown')}</div>
                            <div class="pl-song-artist">${escapeHtml(song.artist ?? 'Unknown')}</div>
                        </div>
                        <span class="pl-song-dur">${formatTime(song.duration_ms)}</span>
                        <button class="icon-btn remove-from-playlist-btn" data-id="${song.id}"
                                aria-label="Remove ${escapeHtml(song.title ?? 'song')} from playlist">
                            <i class="fa-solid fa-xmark" aria-hidden="true"></i>
                        </button>
                    </div>
                `).join('')
                : '<div class="empty-state"><i class="fa-solid fa-music" aria-hidden="true"></i><span>No tracks in this playlist</span></div>'
            }
        </div>
    `;

    editor.querySelectorAll('.remove-from-playlist-btn').forEach(btn => {
        btn.onclick = async () => {
            const newSongs = (playlist.songs ?? []).filter(sid => sid !== btn.dataset.id);
            await db.collection('playlists').update(playlistId, { songs: newSongs });
            showToast('Track removed', 'info');
            await loadPlaylists();
            openPlaylistEditor(playlistId);
        };
    });

    getEl('shuffle-playlist-btn').onclick = async () => {
        const shuffled = shuffleArray(playlist.songs ?? []);
        await db.collection('playlists').update(playlistId, { songs: shuffled });
        showToast('Playlist shuffled', 'success');
        await loadPlaylists();
        openPlaylistEditor(playlistId);
    };

    getEl('delete-playlist-btn').onclick = () => {
        openConfirmModal(
            'Delete Playlist',
            `Delete playlist "${escapeHtml(playlist.name)}"? This cannot be undone.`,
            async () => {
                await db.collection('playlists').remove(playlistId);
                activePlistId = null;
                showToast(`Deleted: ${playlist.name}`, 'info');
                getEl('playlist-editor').innerHTML = `
                    <div class="empty-state large">
                        <i class="fa-solid fa-bars-staggered" aria-hidden="true"></i>
                        <span>Select a playlist to edit</span>
                    </div>`;
                loadPlaylists();
                closeModal();
            }
        );
    };
}

getEl('new-playlist-btn').onclick = () => {
    getEl('modal-title').textContent = 'New Playlist';
    getEl('modal-body').innerHTML = `
        <label class="field-label" for="new-playlist-name">Playlist Name</label>
        <input type="text" class="text-input" id="new-playlist-name" placeholder="My awesome playlist...">
    `;
    getEl('modal-footer').innerHTML = `
        <button class="btn-secondary" id="modal-cancel">Cancel</button>
        <button class="btn-primary" id="modal-confirm">Create</button>
    `;
    getEl('modal-cancel').onclick = closeModal;
    getEl('modal-confirm').onclick = async () => {
        const name = getEl('new-playlist-name').value.trim();
        if (!name) { showToast('Enter a name', 'warning'); return; }
        await db.collection('playlists').add({ name, songs: [], createdAt: Date.now() });
        showToast(`Created: ${name}`, 'success');
        loadPlaylists();
        closeModal();
    };
    openModal();
};

// ── Upload ───────────────────────────────────────────────
const uploadZone = getEl('upload-zone');

uploadZone.addEventListener('dragover', event => {
    event.preventDefault();
    uploadZone.classList.add('drag-over');
});
uploadZone.addEventListener('dragleave', () => uploadZone.classList.remove('drag-over'));
uploadZone.addEventListener('drop', event => {
    event.preventDefault();
    uploadZone.classList.remove('drag-over');
    const audioFiles = [...event.dataTransfer.files].filter(file => file.type.startsWith('audio/'));
    handleFileUploads(audioFiles);
});

getEl('file-upload').onchange = event => handleFileUploads([...event.target.files]);

async function handleFileUploads(files) {
    await Promise.all(files.map(file => uploadSingleFile(file)));
}

async function uploadSingleFile(file) {
    const uploadItem = createUploadItem(file.name);
    getEl('upload-queue').prepend(uploadItem.el);

    try {
        uploadItem.setStatus('uploading');

        const meta     = await extractAudioMeta(file);
        const base64   = await fileToBase64(file);
        const fileName = `${Date.now()}-${file.name.replace(/\s+/g, '_')}`;
        const filePath = `music/${fileName}`;

        uploadItem.setProgress(40);

        await db.filesystem.fetchWithTokenFallback(db.filesystem.contentsUrl(filePath), {
            method: 'PUT',
            body: JSON.stringify({
                message: `add track: ${meta.title}`,
                content: base64,
                branch:  db.filesystem.branch,
            }),
        });

        uploadItem.setProgress(80);

        const fileUrl = `https://raw.githubusercontent.com/${CONFIG.owner}/${CONFIG.repo}/${db.filesystem.branch}/${filePath}`;
        await db.collection('songs').add({ ...meta, fileUrl });

        uploadItem.setProgress(100);
        uploadItem.setStatus('done');
        showToast(`Uploaded: ${meta.title}`, 'success');
        loadLibrary();
    } catch (err) {
        uploadItem.setStatus('error');
        showToast(`Upload failed: ${file.name}`, 'error');
        console.error(err);
    }
}

function createUploadItem(fileName) {
    const el = document.createElement('div');
    el.className = 'upload-item';
    el.innerHTML = `
        <div class="upload-item-info">
            <div class="upload-item-name">${escapeHtml(fileName)}</div>
            <div class="upload-progress-wrap">
                <div class="upload-progress-bar" style="width:0%"></div>
            </div>
        </div>
        <i class="fa-solid fa-clock upload-status-icon pending" aria-hidden="true"></i>
    `;
    const iconClassMap = {
        pending:   'fa-clock',
        uploading: 'fa-spinner fa-spin',
        done:      'fa-circle-check',
        error:     'fa-circle-xmark',
    };
    return {
        el,
        setProgress(pct) {
            el.querySelector('.upload-progress-bar').style.width = pct + '%';
        },
        setStatus(status) {
            const icon     = el.querySelector('.upload-status-icon');
            icon.className = `fa-solid ${iconClassMap[status]} upload-status-icon ${status}`;
        },
    };
}

// ── Rules ────────────────────────────────────────────────
async function loadRules() {
    const saved = await db.kv.get('radio_rules').catch(() => null);
    if (saved) rules = { ...DEFAULT_RULES, ...saved };
}

function applyRulesToForm() {
    getEl('rule-auto-loop').checked     = rules.autoLoop       ?? true;
    getEl('rule-restart-empty').checked = rules.restartOnEmpty ?? true;
    getEl('rule-shuffle-loop').checked  = rules.shuffleOnLoop  ?? false;
    getEl('rule-no-repeat').checked     = rules.noRepeat       ?? true;
    getEl('rule-sync-interval').value   = rules.syncInterval   ?? 10;
    getEl('rule-drift-threshold').value = rules.driftThreshold ?? 2;
}

getEl('save-rules-btn').onclick = async () => {
    rules = {
        ...rules,
        autoLoop:       getEl('rule-auto-loop').checked,
        restartOnEmpty: getEl('rule-restart-empty').checked,
        shuffleOnLoop:  getEl('rule-shuffle-loop').checked,
        noRepeat:       getEl('rule-no-repeat').checked,
        syncInterval:   parseInt(getEl('rule-sync-interval').value)   || 10,
        driftThreshold: parseInt(getEl('rule-drift-threshold').value)  || 2,
    };
    await db.kv.set('radio_rules', rules);
    startSyncLoop();
    showToast('Rules saved', 'success');
};

getEl('change-password-btn').onclick = async () => {
    const password = getEl('rule-admin-password').value.trim();
    if (!password || password.length < 4) {
        showToast('Password must be at least 4 characters', 'warning');
        return;
    }
    rules.adminPasswordHash = await GitHubDB.hashSecret(password, 'radio-admin');
    await db.kv.set('radio_rules', rules);
    getEl('rule-admin-password').value = '';
    showToast('Password updated', 'success');
};

// ── Catalogue Player ─────────────────────────────────────
let catSongs      = [];
let catIndex      = -1;
let catAudio      = new Audio();
let catIsPlaying  = false;
let catRafId      = null;
let catLastVolume = 80;

function pauseLiveRadio() {
    radioAudio.pause();
    document.body.classList.remove('playing');
}

async function loadCatalogue() {
    if (!db) return;
    try {
        const songs = await db.collection('songs').list();
        catSongs = songs;
        getEl('cat-count').textContent = `${songs.length} track${songs.length !== 1 ? 's' : ''}`;
        renderCatalogueGrid(songs);
    } catch (err) {
        console.warn('[catalogue]', err);
    }
}

function filterSongs(songs, query) {
    if (!query) return songs;
    return songs.filter(song =>
        song.title?.toLowerCase().includes(query) ||
        song.artist?.toLowerCase().includes(query)
    );
}

function renderCatalogueGrid(songs) {
    const grid = getEl('cat-song-grid');
    if (!songs.length) {
        grid.innerHTML = `<div class="empty-state large">
            <i class="fa-solid fa-music" aria-hidden="true"></i>
            <span>No songs found</span>
        </div>`;
        return;
    }
    grid.innerHTML = songs.map(song => {
        const realIndex = catSongs.findIndex(item => item.id === song.id);
        const isActive  = realIndex === catIndex;
        return `
        <div class="cat-card ${isActive ? 'active' : ''}" data-idx="${realIndex}" role="listitem" tabindex="0">
            <div class="cat-card-art">
                <div class="cat-card-disc ${isActive && catIsPlaying ? 'spinning' : ''}">
                    <div class="cat-card-hole"></div>
                </div>
                <button class="cat-card-play-btn" aria-label="${isActive && catIsPlaying ? 'Pause' : 'Play'} ${escapeHtml(song.title ?? 'song')}">
                    <i class="fa-solid ${isActive && catIsPlaying ? 'fa-pause' : 'fa-play'}" aria-hidden="true"></i>
                </button>
            </div>
            <div class="cat-card-info">
                <div class="cat-card-title" title="${escapeHtml(song.title ?? 'Unknown')}">${escapeHtml(song.title ?? 'Unknown')}</div>
                <div class="cat-card-artist">${escapeHtml(song.artist ?? 'Unknown')}</div>
                <div class="cat-card-dur">${formatTime(song.duration_ms)}</div>
            </div>
        </div>`;
    }).join('');

    grid.querySelectorAll('.cat-card').forEach(card => {
        card.onclick = () => {
            const idx = parseInt(card.dataset.idx);
            if (idx === catIndex) {
                if (catAudio.paused) catResume(); else catPause();
            } else {
                catPlayAtIndex(idx);
            }
        };
    });
}

function catSetPlayerBarState() {
    const song = catSongs[catIndex];
    if (!song) return;
    getEl('cat-track-title').textContent   = song.title  ?? 'Unknown';
    getEl('cat-track-artist').textContent  = song.artist ?? 'Unknown';
    getEl('cat-time-total').textContent    = formatTime(song.duration_ms);
    getEl('cat-play-icon').className       = `fa-solid ${catIsPlaying ? 'fa-pause' : 'fa-play'}`;
    getEl('cat-bar-disc').classList.toggle('spinning', catIsPlaying);
    getEl('cat-player-bar').classList.add('visible');
}

function catPlayAtIndex(idx) {
    if (idx < 0 || idx >= catSongs.length) return;
    catIndex = idx;
    const song = catSongs[idx];

    pauseLiveRadio();

    catAudio.src    = song.fileUrl;
    catAudio.volume = parseInt(getEl('cat-volume-slider').value) / 100;
    catAudio.play().catch(() => {});
    catIsPlaying = true;
    catSetPlayerBarState();

    const query = getEl('cat-search').value.toLowerCase();
    renderCatalogueGrid(filterSongs(catSongs, query));
    startCatProgressLoop();
}

function catPause() {
    catAudio.pause();
    catIsPlaying = false;
    catSetPlayerBarState();

    const query = getEl('cat-search').value.toLowerCase();
    renderCatalogueGrid(filterSongs(catSongs, query));
    startSyncLoop(); // hand back to live radio
}

function catResume() {
    catAudio.play().catch(() => {});
    catIsPlaying = true;
    catSetPlayerBarState();

    const query = getEl('cat-search').value.toLowerCase();
    renderCatalogueGrid(filterSongs(catSongs, query));
    startCatProgressLoop();
}

function startCatProgressLoop() {
    if (catRafId) cancelAnimationFrame(catRafId);
    const tick = () => {
        if (!catAudio.duration) { catRafId = requestAnimationFrame(tick); return; }
        const pct    = Math.min((catAudio.currentTime / catAudio.duration) * 100, 100);
        const pctStr = pct + '%';
        getEl('cat-progress-fill').style.width  = pctStr;
        getEl('cat-progress-thumb').style.left  = pctStr;
        getEl('cat-time-current').textContent   = formatTime(catAudio.currentTime * 1000);
        catRafId = requestAnimationFrame(tick);
    };
    tick();
}

catAudio.onended = () => {
    if (catIndex + 1 < catSongs.length) {
        catPlayAtIndex(catIndex + 1);
    } else {
        catIsPlaying = false;
        catSetPlayerBarState();
        const query = getEl('cat-search').value.toLowerCase();
        renderCatalogueGrid(filterSongs(catSongs, query));
        startSyncLoop();
    }
};

radioAudio.onended = () => {
    startSyncLoop();
};

getEl('cat-play-btn').onclick = () => {
    if (catIndex === -1) { if (catSongs.length) catPlayAtIndex(0); return; }
    if (catAudio.paused) catResume(); else catPause();
};

getEl('cat-prev-btn').onclick = () => catPlayAtIndex(catIndex - 1);
getEl('cat-next-btn').onclick = () => catPlayAtIndex(catIndex + 1);

getEl('cat-progress-track').onclick = event => {
    if (!catAudio.duration) return;
    const rect = event.currentTarget.getBoundingClientRect();
    catAudio.currentTime = ((event.clientX - rect.left) / rect.width) * catAudio.duration;
};

const catVolumeSlider = getEl('cat-volume-slider');
const catVolumeFill   = getEl('cat-volume-fill');

catVolumeSlider.oninput = () => {
    const vol = parseInt(catVolumeSlider.value);
    catVolumeFill.style.width = vol + '%';
    catAudio.volume           = vol / 100;
    updateVolumeIcon(getEl('cat-mute-btn'), vol);
};

getEl('cat-mute-btn').onclick = () => {
    if (catAudio.volume > 0) {
        catLastVolume          = parseInt(catVolumeSlider.value) || 80;
        catVolumeSlider.value  = 0;
    } else {
        catVolumeSlider.value = catLastVolume;
    }
    catVolumeSlider.dispatchEvent(new Event('input'));
};

getEl('cat-search').oninput = event => {
    const query = event.target.value.toLowerCase();
    renderCatalogueGrid(filterSongs(catSongs, query));
};

// ── Main Navigation ──────────────────────────────────────
document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.onclick = () => {
        document.querySelectorAll('.nav-btn').forEach(navBtn => {
            navBtn.classList.remove('active');
            navBtn.removeAttribute('aria-current');
        });
        document.querySelectorAll('.view').forEach(view => view.classList.remove('active'));
        btn.classList.add('active');
        btn.setAttribute('aria-current', 'page');
        getEl('view-' + btn.dataset.view)?.classList.add('active');
        if (btn.dataset.view === 'catalogue') loadCatalogue();
    };
});

// ── Live Volume ──────────────────────────────────────────
const volumeSlider = getEl('volume-slider');
const volumeFill   = getEl('volume-fill');
const muteBtn      = getEl('mute-btn');
let lastLiveVolume = 80;

function getLiveVolume() {
    return parseInt(volumeSlider.value) / 100;
}

volumeSlider.oninput = () => {
    const vol = parseInt(volumeSlider.value);
    volumeFill.style.width = vol + '%';
    radioAudio.volume      = vol / 100;
    lastLiveVolume         = vol || lastLiveVolume;
    updateVolumeIcon(muteBtn, vol);
};

muteBtn.onclick = () => {
    if (radioAudio.volume > 0) {
        lastLiveVolume     = parseInt(volumeSlider.value) || 80;
        volumeSlider.value = 0;
    } else {
        volumeSlider.value = lastLiveVolume;
    }
    volumeSlider.dispatchEvent(new Event('input'));
};

function updateVolumeIcon(button, vol) {
    const icon = button.querySelector('i');
    icon.className = vol === 0
        ? 'fa-solid fa-volume-xmark'
        : vol < 50
            ? 'fa-solid fa-volume-low'
            : 'fa-solid fa-volume-high';
}

// Restore volume from last session
const savedVolume = localStorage.getItem('radio-volume');
if (savedVolume !== null) {
    volumeSlider.value = savedVolume;
    volumeSlider.dispatchEvent(new Event('input'));
}
volumeSlider.addEventListener('input', () => {
    localStorage.setItem('radio-volume', volumeSlider.value);
});

// ── Tune-In Overlay ──────────────────────────────────────
getEl('tune-in-btn').onclick = () => {
    getEl('tune-in-overlay').remove();
    radioAudio.volume = getLiveVolume();
    radioAudio.play().catch(() => {});
};

// ── Modal ────────────────────────────────────────────────
function openModal()  { getEl('modal-overlay').classList.remove('hidden'); }
function closeModal() { getEl('modal-overlay').classList.add('hidden'); }

getEl('modal-close-btn').onclick = closeModal;
getEl('modal-overlay').onclick = event => {
    if (event.target === getEl('modal-overlay')) closeModal();
};

function openConfirmModal(title, message, onConfirm) {
    getEl('modal-title').textContent = title;
    getEl('modal-body').innerHTML    = `<p>${escapeHtml(message)}</p>`;
    getEl('modal-footer').innerHTML  = `
        <button class="btn-secondary" id="modal-cancel">Cancel</button>
        <button class="btn-danger" id="modal-confirm">Confirm</button>
    `;
    getEl('modal-cancel').onclick  = closeModal;
    getEl('modal-confirm').onclick = async () => {
        closeModal();
        await onConfirm();
    };
    openModal();
}

// ── Toasts ───────────────────────────────────────────────
function showToast(message, type = 'info') {
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
    toast.querySelector('.toast-dismiss').onclick = () => dismissToast(toast);
    getEl('toast-container').appendChild(toast);
    setTimeout(() => dismissToast(toast), 4000);
}

function dismissToast(toast) {
    toast.classList.add('out');
    toast.addEventListener('animationend', () => toast.remove(), { once: true });
}

// ── Connection Status ────────────────────────────────────
function setStatus(status) {
    const el    = getEl('connection-status');
    const stateMap = {
        connecting: ['fa-circle-dot',   'Connecting...', ''],
        connected:  ['fa-circle-check', 'Connected',     'connected'],
        error:      ['fa-circle-xmark', 'Error',         'error'],
    };
    const [icon, label, cssClass] = stateMap[status];
    el.className = `sidebar-status ${cssClass}`;
    el.innerHTML = `<i class="fa-solid ${icon}" aria-hidden="true"></i><span>${label}</span>`;
}

// ── Utilities ────────────────────────────────────────────
function formatTime(ms) {
    const totalSec = Math.floor((ms ?? 0) / 1000);
    const minutes  = Math.floor(totalSec / 60);
    const seconds  = (totalSec % 60).toString().padStart(2, '0');
    return `${minutes}:${seconds}`;
}

function formatDuration(ms) {
    const totalSec  = Math.floor((ms ?? 0) / 1000);
    const minutes   = Math.floor(totalSec / 60);
    const hours     = Math.floor(minutes / 60);
    const remMin    = minutes % 60;
    const remSec    = totalSec % 60;
    if (hours > 0) return `${hours}h ${remMin}m`;
    return `${remMin}m ${remSec}s`;
}

function fileToBase64(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload  = () => resolve(reader.result.split(',')[1]);
        reader.onerror = () => reject(new Error('File read failed'));
    });
}

function extractAudioMeta(file) {
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

function shuffleArray(arr) {
    return [...arr].sort(() => Math.random() - 0.5);
}

function escapeHtml(str) {
    return String(str ?? '').replace(/[&<>"']/g, char => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[char]));
}

// ── Boot ─────────────────────────────────────────────────
init();