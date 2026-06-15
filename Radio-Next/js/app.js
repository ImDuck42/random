import { GitHubDB } from './github-db.js';
import { CONFIG, DEFAULT_RULES, byId, setConnStatus, applyShuffleOrder, filterByQuery } from './utils.js';
import { getLoginState, setLoginState, clearLoginState, validateAdminPassword, updateUserDisplay } from './utils.js';
import { ToastManager } from './ui.js';
import { ModalManager } from './ui.js';
import { AudioRouter } from './audio.js';
import { VolumeControl } from './audio.js';
import { PreviewPlayer } from './audio.js';
import { LivePlayer } from './player.js';
import { CatPlayer } from './player.js';
import { LibraryManager } from './library.js';
import { PlaylistManager } from './playlists.js';
import { SubmissionManager } from './uploads.js';
import { Uploader } from './uploads.js';
import { AdminPanel } from './admin.js';
import { ChannelManager, AdminChannelPanel } from './channels.js';

// ── Application Bootstrap ────────────────────────────────

async function init() {
    setConnStatus('connecting');

    const toast = new ToastManager('toast-container');
    const modal = new ModalManager();

    // ── Login System ─────────────────────────────────────
    setupLoginSystem(toast);

    // ── Database connection ──────────────────────────────
    let db;
    try {
        db = await GitHubDB.public({ ...CONFIG });
        db.permissions({
            songs:       { read: 'public', write: 'public' },
            channels:    { read: 'public', write: 'public' },
            playlists:   { read: 'public', write: 'public' },
            submissions: { read: 'public', write: 'public' },
            _kv:         { read: 'public', write: 'public' },
        });
        setConnStatus('connected');
        const connPill = byId('conn-pill');
        if (connPill) { connPill.className = 'conn-pill connected'; connPill.innerHTML = '<i class="fa-solid fa-circle-check"></i><span>Connected</span>'; }
    } catch (err) {
        setConnStatus('error');
        const connPill = byId('conn-pill');
        if (connPill) { connPill.className = 'conn-pill error'; connPill.innerHTML = '<i class="fa-solid fa-circle-xmark"></i><span>Error</span>'; }
        toast.show('Failed to connect to GitHub DB', 'error');
        console.error(err);
        return;
    }

    // ── Rules ────────────────────────────────────────────
    const rules = { ...DEFAULT_RULES };
    const savedRules = await db.kv.get('radio_rules').catch(() => null);
    if (savedRules) Object.assign(rules, savedRules);

    // ── Audio graph ──────────────────────────────────────
    const liveAudioEl    = byId('radio-audio');
    const catAudioEl     = new Audio();
    const previewAudioEl = new Audio();
    const router         = new AudioRouter(liveAudioEl, catAudioEl, previewAudioEl);

    const liveVol = new VolumeControl('live-volume-slider', 'live-volume-fill', 'live-mute-btn', liveAudioEl, 'radio-volume');
    const catVol  = new VolumeControl('live-volume-slider', 'live-volume-fill', 'live-mute-btn',  catAudioEl);

    // ── Players ──────────────────────────────────────────
    const catPlayer = new CatPlayer(catAudioEl, router, catVol, toast, null);

    const preview = new PreviewPlayer(router, toast, {
        onRestoreCat: () => {
            catPlayer.audio.play().catch(() => {});
            catPlayer.startProgressLoop();
            catPlayer.updateBar();
        },
    });

    const livePlayer = new LivePlayer(liveAudioEl, router, liveVol, rules, async () => {
        const key = livePlayer.activeChannelId
            ? `radio_channel_${livePlayer.activeChannelId}`
            : 'radio_state';
        const state = await db.kv.get(key);
        livePlayer.currentState = state;

        if (!state?.songs?.length) { livePlayer.setOffline(); return; }

        const totalMs = state.songs.reduce((acc, song) => acc + song.duration_ms, 0);
        if (totalMs === 0) return;

        let elapsed = Date.now() - state.playlistStartedAt;
        if (livePlayer.rules.autoLoop) elapsed = elapsed % totalMs;
        else if (elapsed > totalMs) { livePlayer.setOffline(); return; }

        const songList = applyShuffleOrder(state);
        let runningMs  = 0;
        for (const song of songList) {
            if (elapsed >= runningMs && elapsed < runningMs + song.duration_ms) {
                livePlayer.syncToOffset(song, elapsed - runningMs, songList);
                break;
            }
            runningMs += song.duration_ms;
        }
    });

    catPlayer.livePlayer = livePlayer;

    // ── Managers ─────────────────────────────────────────
    const library        = new LibraryManager(db, toast, modal);
    const playlist       = new PlaylistManager(db, toast, modal, library);
    const submissionMgr  = new SubmissionManager(db, preview, toast);
    const uploader       = new Uploader(db, toast, () => library.load());
    const admin          = new AdminPanel(db, toast, modal, library, playlist, rules, livePlayer);
    admin.setPreview(preview);

    const channelMgr    = new ChannelManager(db, toast, modal);
    const adminChannels = new AdminChannelPanel(db, toast, modal, channelMgr);

    // ── Channel \u2192 Live Player bridge ─────────────────────
    channelMgr.onListenToChannel = async (channel) => {
        try {
            const songs = channelMgr.getSongsForChannel(channel);
            if (!songs.length) { toast.show('Channel has no tracks', 'warning'); return; }

            const channelRules = {
                autoLoop:       channel.autoLoop       ?? rules.autoLoop,
                restartOnEmpty: channel.restartOnEmpty ?? rules.restartOnEmpty,
                shuffleOnLoop:  channel.shuffleOnLoop  ?? rules.shuffleOnLoop,
                noRepeat:       channel.noRepeat       ?? rules.noRepeat,
                syncInterval:   channel.syncInterval   ?? rules.syncInterval,
                driftThreshold: channel.driftThreshold ?? rules.driftThreshold,
            };

            let orderedSongs = [...songs];
            if (channel.mode === 'shuffle') {
                orderedSongs = orderedSongs.sort(() => Math.random() - 0.5);
            }

            const chKey    = `radio_channel_${channel.id}`;
            const existing = await db.kv.get(chKey).catch(() => null);

            const configStamp = [
                channel.mode ?? 'sequential',
                channel.playlistId ?? '',
                channel.autoLoop,
                channel.shuffleOnLoop,
                channel.noRepeat,
                channel.syncInterval,
                channel.driftThreshold,
                ...orderedSongs.map(s => `${s.id}:${s.duration_ms}`)
            ].join('|');

            let chState;
            if (existing && existing.configStamp === configStamp) {
                chState = existing;
            } else {
                chState = {
                    playlistStartedAt: Date.now(),
                    songs:             orderedSongs,
                    mode:              channel.mode ?? 'sequential',
                    playlistId:        channel.playlistId ?? null,
                    channelId:         channel.id,
                    channelRules,
                    configStamp,
                };
                await db.kv.set(chKey, chState);
            }

            Object.assign(livePlayer.rules, chState.channelRules);
            livePlayer.activeChannelId = channel.id;
            livePlayer.startSync();

            channelMgr.activeChannelId = channel.id;
            history.replaceState(null, '', `#/${encodeURIComponent(channel.slug || channel.id)}`);
            channelMgr.refreshListenBtn(channel.id);

            activateView('home');
            toast.show(`Tuned to: ${channel.name}`, 'success');
        } catch (err) {
            console.error('[channel listen]', err);
            toast.show('Failed to tune to channel', 'error');
        }
    };

    channelMgr.onStopChannel = async () => {
        try {
            const prevChannelId = channelMgr.activeChannelId;

            livePlayer.activeChannelId = null;
            Object.assign(livePlayer.rules, rules);
            livePlayer.stopSync();
            livePlayer.audio.pause();
            livePlayer.audio.src = '';
            livePlayer.startSync();

            channelMgr.activeChannelId = null;
            history.replaceState(null, '', location.pathname);
            channelMgr.refreshListenBtn(prevChannelId);

            toast.show('Stopped channel \u2014 resumed default broadcast', 'info');
        } catch (err) {
            console.error('[channel stop]', err);
        }
    };

    // ── Tune-in gate ─────────────────────────────────────
    byId('tune-in-btn').onclick = () => {
        byId('gate-overlay').remove();
        router.activateLive(true);
        livePlayer.tuneIn();
    };

    // ── Header search bar ────────────────────────────────
    byId('header-search').oninput = event => {
        const q = event.target.value;
        // Auto-switch to catalogue when user starts typing
        const searchView = byId('view-search');
        if (searchView && !searchView.classList.contains('active')) {
            activateView('search');
        }
        catPlayer.renderGrid(filterByQuery(catPlayer.songs, q));
    };

    // ── Bottom bar: catalogue-only visibility ────────────
    function updateBottomBarVisibility() {
        const bar   = document.querySelector('.cat-only-bar');
        const shell = document.querySelector('.spotify-app');
        const show  = router.isCatActive && catPlayer.index !== -1;
        if (!bar) return;
        bar.classList.toggle('cat-bar-visible', show);
        shell?.classList.toggle('player-visible', show);
    }
    // Patch catPlayer methods to refresh bar visibility
    const _origPlayAt   = catPlayer.playAt.bind(catPlayer);
    const _origStop     = catPlayer.stop.bind(catPlayer);
    const _origToggle   = catPlayer.togglePlay.bind(catPlayer);
    catPlayer.playAt     = (...a) => { _origPlayAt(...a);  updateBottomBarVisibility(); };
    catPlayer.stop       = (...a) => { _origStop(...a);    updateBottomBarVisibility(); };
    catPlayer.togglePlay = (...a) => { _origToggle(...a);  updateBottomBarVisibility(); };
    // Also catch the end-of-queue path (onended resets index internally)
    const _origOnEnded = catPlayer.audio.onended;
    catPlayer.audio.onended = (...a) => {
        if (_origOnEnded) _origOnEnded(...a);
        updateBottomBarVisibility();
    };

    // ── View navigation ──────────────────────────────────
    async function activateView(viewName, skipHash = false) {
        // Hide all main views
        document.querySelectorAll('.main-view').forEach(view => view.classList.remove('active'));
        byId(`view-${viewName}`)?.classList.add('active');

        // Update nav buttons
        document.querySelectorAll('.nav-btn').forEach(btn => {
            const isActive = btn.dataset.view === viewName;
            btn.classList.toggle('active', isActive);
            if (isActive) btn.setAttribute('aria-current', 'page');
            else          btn.removeAttribute('aria-current');
        });

        // View-specific init
        if (viewName === 'search') {
            const q = byId('header-search')?.value ?? '';
            catPlayer.renderGrid(q ? filterByQuery(catPlayer.songs, q) : catPlayer.songs);
            if (!catPlayer.songs.length) loadCatSongs(db, catPlayer);
        }
        if (viewName === 'library') {
            if (!catPlayer.songs.length) await loadCatSongs(db, catPlayer);
            if (!playlist.playlists.length) await playlist.load();
            channelMgr.setSongsCache(catPlayer.songs);
            channelMgr.setPlaylistsCache(playlist.playlists);
            await channelMgr.load();
            if (!skipHash && location.hash && location.hash !== '#') {
                await channelMgr.handleHash(location.hash);
            }
        }
        if (viewName === 'submissions') {
            submissionMgr.load();
        }
        if (viewName === 'admin') {
            admin.open();
        }

        // Scroll to top
        const mainContent = byId('main-scroll');
        if (mainContent) mainContent.scrollTop = 0;
    }

    document.querySelectorAll('.nav-btn[data-view]').forEach(btn => {
        btn.addEventListener('click', () => {
            const view = btn.dataset.view;
            if (view === 'admin') {
                const session = getLoginState();
                if (!session) {
                    showLoginOverlay();
                    return;
                }
                admin.open();
                return;
            }
            if (btn.dataset.view !== 'library' && !channelMgr.activeChannelId
                    && location.hash.startsWith('#/')) {
                history.replaceState(null, '', location.pathname);
            }
            activateView(btn.dataset.view);
        });
    });

    // ── Hash-based deep linking ──────────────────────────
    async function handleHashNavigation(hash = location.hash) {
        if (hash?.startsWith('#/') && hash.length > 2) {
            await activateView('library', true);
            const channel = await channelMgr.handleHash(hash);
            if (channel && !channelMgr.activeChannelId) {
                channelMgr.onListenToChannel?.(channel);
            }
        }
    }

    window.addEventListener('popstate', () => {
        const hash = location.hash;
        if (!hash || !hash.startsWith('#/')) {
            const libraryView = byId('view-library');
            if (libraryView?.classList.contains('active')) {
                byId('ch-detail-view').classList.add('hidden');
                byId('ch-grid-view').classList.remove('hidden');
            }
        } else {
            handleHashNavigation(hash);
        }
    });

    if (location.hash?.startsWith('#/') && location.hash.length > 2) {
        handleHashNavigation();
    }

    // ── Admin panel callbacks ────────────────────────────
    admin.onChannelsPanel = async () => {
        try {
            if (!catPlayer.songs.length)     await loadCatSongs(db, catPlayer);
            if (!playlist.playlists.length)  await playlist.load();
            channelMgr.setSongsCache(catPlayer.songs);
            channelMgr.setPlaylistsCache(playlist.playlists);
            await adminChannels.load();
        } catch (err) {
            console.error('[channels panel] failed to load:', err);
        }
    };

    admin.afterLoad = async () => {
        if (!catPlayer.songs.length) await loadCatSongs(db, catPlayer);
        channelMgr.setSongsCache(catPlayer.songs);
        channelMgr.setPlaylistsCache(playlist.playlists);
    };

    // ── DevTools API ─────────────────────────────────────
    window.radio = {
        admin() { console.info('%c[GHDB Radio] Use the sidebar "Dashboard" button after logging in.', 'color:#cba6f7;font-weight:bold'); },
        help() {
            console.info(`%c
\u2554\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2557
\u2551        GHDB Radio DevTools API           \u2551
\u2560\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2563
\u2551  Use sidebar "Dashboard" after login    \u2551
\u2551  radio.status()  \u2500  broadcast status    \u2551
\u2551  radio.help()    \u2500  this menu           \u2551
\u255a\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u255d
`, 'color:#1db954;font-family:monospace');
        },
        status() {
            console.table(livePlayer.currentState ?? { status: 'No broadcast' });
        },
    };
    console.info('%c[GHDB Radio] Type radio.help() for DevTools commands.', 'color:#1db954;font-family:monospace');

    livePlayer.startSync();
    updateUserDisplay();
}

// ── Login System ─────────────────────────────────────────

function setupLoginSystem(toast) {
    const loginOverlay  = byId('login-overlay');
    const loginSubmit   = byId('login-submit');
    const loginClose    = byId('login-close');
    const loginUsername = byId('login-username');
    const loginPassword = byId('login-password');

    if (loginClose) {
        loginClose.addEventListener('click', () => loginOverlay?.classList.add('hidden'));
    }
    if (loginOverlay) {
        loginOverlay.addEventListener('click', e => {
            if (e.target === loginOverlay) loginOverlay.classList.add('hidden');
        });
    }

    if (loginSubmit) {
        loginSubmit.addEventListener('click', async () => {
            const username = loginUsername?.value.trim();
            const password = loginPassword?.value;

            if (!username) { toast.show('Please enter a username', 'warning'); return; }
            if (!password) { toast.show('Please enter a password', 'warning'); return; }

            const isValid = await validateAdminPassword(password);
            if (!isValid) {
                toast.show('Invalid password', 'error');
                return;
            }

            setLoginState(username);
            hideLoginOverlay();
            updateUserDisplay();
            toast.show(`Welcome, ${username}!`, 'success');
            loginPassword.value = '';
        });
    }

    // Login nav button - use addEventListener to avoid conflicts
    const loginBtn = byId('nav-login');
    if (loginBtn) {
        loginBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (getLoginState()) {
                clearLoginState();
                updateUserDisplay();
                toast.show('Logged out', 'info');
            } else {
                showLoginOverlay();
            }
        });
    }

    // Enter key on password field
    if (loginPassword) {
        loginPassword.addEventListener('keydown', e => { if (e.key === 'Enter') loginSubmit?.click(); });
    }
}

function showLoginOverlay() {
    const overlay = byId('login-overlay');
    if (!overlay) return;
    overlay.classList.remove('hidden');
    requestAnimationFrame(() => {
        const usernameField = byId('login-username');
        if (usernameField) usernameField.focus();
    });
}

function hideLoginOverlay() {
    const overlay = byId('login-overlay');
    if (overlay) overlay.classList.add('hidden');
}

// ── Catalogue Loader ─────────────────────────────────────

async function loadCatSongs(db, catPlayer) {
    try {
        const songs = await db.collection('songs').list();
        catPlayer.songs = songs;
        const countEl = byId('cat-count');
        if (countEl) countEl.textContent = `${songs.length} track${songs.length !== 1 ? 's' : ''}`;
        catPlayer.renderGrid(songs);
        return songs;
    } catch (err) {
        console.warn('[catalogue]', err);
        return [];
    }
}

init();
