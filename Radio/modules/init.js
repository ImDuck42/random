import { GitHubDB } from './../js/github-db.js';
import { CONFIG, DEFAULT_RULES } from './config.js';
import { byId, applyShuffleOrder } from './utils.js';
import { setConnStatus } from './render.js';
import { ToastManager } from './toast.js';
import { ModalManager } from './modal.js';
import { VolumeControl } from './volume.js';
import { AudioRouter } from './router.js';
import { LivePlayer } from './live-player.js';
import { CatPlayer } from './cat-player.js';
import { PreviewPlayer } from './preview-player.js';
import { SubmissionManager } from './submission.js';
import { LibraryManager } from './library.js';
import { PlaylistManager } from './playlist.js';
import { Uploader } from './uploader.js';
import { AdminPanel } from './admin.js';
import { ChannelManager, AdminChannelPanel } from './channels.js';

// ── Application Bootstrap ────────────────────────────────
async function init() {
    setConnStatus('connecting');

    const toast = new ToastManager('toast-container');
    const modal = new ModalManager();

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
    } catch (err) {
        setConnStatus('error');
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
    const catVol  = new VolumeControl('cat-volume-slider',  'cat-volume-fill',  'cat-mute-btn',  catAudioEl);

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

    // ── Channel → Live Player bridge ─────────────────────
    // Each channel gets its own KV key. We only write when the config actually changes.
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

            // Deterministic stamp of the channel's current effective configuration
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
            if (existing && existing._configStamp === configStamp) {
                // Config unchanged — reuse existing state, avoid unnecessary write
                chState = existing;
            } else {
                chState = {
                    playlistStartedAt: Date.now(),
                    songs:             orderedSongs,
                    mode:              channel.mode ?? 'sequential',
                    playlistId:        channel.playlistId ?? null,
                    channelId:         channel.id,
                    channelRules,
                    _configStamp:      configStamp,
                };
                await db.kv.set(chKey, chState);
            }

            Object.assign(livePlayer.rules, chState.channelRules);
            livePlayer.activeChannelId = channel.id;
            livePlayer.startSync();

            channelMgr.activeChannelId = channel.id;
            history.replaceState(null, '', `#/${encodeURIComponent(channel.slug || channel.id)}`);
            channelMgr.refreshListenBtn(channel.id);

            activateView('listener');
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
            livePlayer.startSync(); // seamlessly falls back to radio_state

            channelMgr.activeChannelId = null;
            history.replaceState(null, '', location.pathname);
            channelMgr.refreshListenBtn(prevChannelId);

            toast.show('Stopped channel — resumed default broadcast', 'info');
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

    // ── View navigation ───────────────────────────────────
    /**
     * Switches the active view and runs any view-specific initialization.
     * @param {string} viewName
     * @param {boolean} skipHash - if true, skips auto-handling the URL hash
     */
    async function activateView(viewName, skipHash = false) {
        document.querySelectorAll('.nav-btn').forEach(btn => {
            const isActive = btn.dataset.view === viewName;
            btn.classList.toggle('active', isActive);
            if (isActive) btn.setAttribute('aria-current', 'page');
            else          btn.removeAttribute('aria-current');
        });
        document.querySelectorAll('.view').forEach(view => view.classList.remove('active'));
        byId(`view-${viewName}`)?.classList.add('active');

        if (viewName === 'catalogue') {
            catPlayer.renderGrid(catPlayer.songs);
            if (!catPlayer.songs.length) loadCatSongs(db, catPlayer);
        }
        if (viewName === 'submissions') {
            submissionMgr.load();
        }
        if (viewName === 'channels') {
            if (!catPlayer.songs.length) await loadCatSongs(db, catPlayer);
            if (!playlist.playlists.length) await playlist.load();
            channelMgr.setSongsCache(catPlayer.songs);
            channelMgr.setPlaylistsCache(playlist.playlists);
            await channelMgr.load();
            if (!skipHash && location.hash && location.hash !== '#') {
                await channelMgr.handleHash(location.hash);
            }
        }
    }

    document.querySelectorAll('.nav-btn').forEach(btn => {
        btn.onclick = () => {
            // Strip channel hash when navigating away if no channel is active
            if (btn.dataset.view !== 'channels' && !channelMgr.activeChannelId
                    && location.hash.startsWith('#/')) {
                history.replaceState(null, '', location.pathname);
            }
            activateView(btn.dataset.view);
        };
    });

    // ── Hash-based deep linking ───────────────────────────
    async function handleHashNavigation(hash = location.hash) {
        if (hash?.startsWith('#/') && hash.length > 2) {
            await activateView('channels', /* skipHash */ true);
            const channel = await channelMgr.handleHash(hash);
            if (channel && !channelMgr.activeChannelId) {
                channelMgr.onListenToChannel?.(channel);
            }
        }
    }

    window.addEventListener('popstate', () => {
        const hash = location.hash;
        if (!hash || !hash.startsWith('#/')) {
            const channelsView = byId('view-channels');
            if (channelsView?.classList.contains('active')) {
                byId('ch-detail-view').classList.add('hidden');
                byId('ch-grid-view').classList.remove('hidden');
            }
        } else {
            handleHashNavigation(hash);
        }
    });

    // Handle deep-link channel URLs on initial load
    if (location.hash?.startsWith('#/') && location.hash.length > 2) {
        handleHashNavigation();
    }

    // ── Admin panel callbacks ─────────────────────────────
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
        async admin(password = '') {
            if (admin.unlocked) {
                console.info('%c[GHDB Radio] Admin panel is already open.', 'color:#cba6f7;font-weight:bold');
                return;
            }
            const expectedHash = rules.adminPasswordHash;
            const isMatch = expectedHash
                ? await GitHubDB.verifySecret(password, expectedHash, 'radio-admin')
                : password === 'admin';

            if (!isMatch) {
                console.warn('%c[GHDB Radio] Wrong password. Usage: radio.admin("yourpassword")', 'color:#f38ba8');
                return;
            }
            console.info('%c[GHDB Radio] Admin panel unlocked. Welcome!', 'color:#a6e3a1;font-weight:bold');
            admin.open();
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
            console.table(livePlayer.currentState ?? { status: 'No broadcast' });
        },
    };
    console.info('%c[GHDB Radio] Type radio.help() for DevTools commands.', 'color:#89b4fa;font-family:monospace');

    livePlayer.startSync();
}

/**
 * Loads songs from the database into the catalogue player and updates the count badge.
 * @param {object} db
 * @param {CatPlayer} catPlayer
 * @returns {Promise<object[]>}
 */
async function loadCatSongs(db, catPlayer) {
    try {
        const songs = await db.collection('songs').list();
        catPlayer.songs = songs;
        byId('cat-count').textContent = `${songs.length} track${songs.length !== 1 ? 's' : ''}`;
        catPlayer.renderGrid(songs);
        return songs;
    } catch (err) {
        console.warn('[catalogue]', err);
        return [];
    }
}

init();