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

// ── App ──────────────────────────────────────────────────
async function init() {
    setConnStatus('connecting');

    const toast = new ToastManager('toast-container');
    const modal = new ModalManager();

    let db;
    try {
        db = await GitHubDB.public({ ...CONFIG });
        db.permissions({
            songs:             { read: 'public', write: 'public' },
            playlists:         { read: 'public', write: 'public' },
            submissions:       { read: 'public', write: 'public' },
            '_kv.radio_state': { read: 'public', write: 'public' },
            '_kv.radio_rules': { read: 'public', write: 'public' },
        });
        setConnStatus('connected');
    } catch (err) {
        setConnStatus('error');
        toast.show('Failed to connect to GitHub DB', 'error');
        console.error(err);
        return;
    }

    // Load rules
    const rules = { ...DEFAULT_RULES };
    const savedRules = await db.kv.get('radio_rules').catch(() => null);
    if (savedRules) Object.assign(rules, savedRules);

    // Build audio elements & router
    const liveAudioEl = byId('radio-audio');
    const catAudioEl  = new Audio();
    const prevAudioEl = new Audio();
    const router      = new AudioRouter(liveAudioEl, catAudioEl, prevAudioEl);

    // Build volume controls
    const liveVol = new VolumeControl('live-volume-slider', 'live-volume-fill', 'live-mute-btn', liveAudioEl, 'radio-volume');
    const catVol  = new VolumeControl('cat-volume-slider',  'cat-volume-fill',  'cat-mute-btn',  catAudioEl);

    // Build players
    const catPlayer = new CatPlayer(catAudioEl, router, catVol, toast, null /* livePlayer set below */);

    const preview = new PreviewPlayer(router, toast, {
        onRestoreCat: () => {
            catPlayer.audio.play().catch(() => {});
            catPlayer.startProgressLoop();
            catPlayer.updateBar();
        },
    });

    const livePlayer = new LivePlayer(liveAudioEl, router, liveVol, rules, async () => {
        const state = await db.kv.get('radio_state');
        livePlayer.currentState = state;

        if (!state?.songs?.length) { livePlayer.setOffline(); return; }

        const totalMs = state.songs.reduce((acc, song) => acc + song.duration_ms, 0);
        if (totalMs === 0) return;

        let elapsed = Date.now() - state.playlistStartedAt;
        if (rules.autoLoop) elapsed = elapsed % totalMs;
        else if (elapsed > totalMs) { livePlayer.setOffline(); return; }

        const songList = applyShuffleOrder(state);
        let runningMs  = 0;
        for (const song of songList) {
            const dur = song.duration_ms;
            if (elapsed >= runningMs && elapsed < runningMs + dur) {
                livePlayer.syncToOffset(song, elapsed - runningMs, songList);
                break;
            }
            runningMs += dur;
        }
    });

    // Wire livePlayer back into catPlayer (circular dep resolved here)
    catPlayer.livePlayer = livePlayer;

    // Build managers
    const library  = new LibraryManager(db, toast, modal);
    const playlist = new PlaylistManager(db, toast, modal, library);
    const submgr   = new SubmissionManager(db, preview, toast);
    const uploader = new Uploader(db, toast, () => library.load());
    const admin    = new AdminPanel(db, toast, modal, library, playlist, rules, livePlayer);
    admin.setPreview(preview);

    // Tune-in overlay
    byId('tune-in-btn').onclick = () => {
        byId('gate-overlay').remove();
        router.activateLive();
        livePlayer.tuneIn();
    };

    // Main navigation
    document.querySelectorAll('.nav-btn').forEach(btn => {
        btn.onclick = () => {
            document.querySelectorAll('.nav-btn').forEach(nb => {
                nb.classList.remove('active');
                nb.removeAttribute('aria-current');
            });
            document.querySelectorAll('.view').forEach(view => view.classList.remove('active'));
            btn.classList.add('active');
            btn.setAttribute('aria-current', 'page');
            byId(`view-${btn.dataset.view}`)?.classList.add('active');
            if (btn.dataset.view === 'catalogue') catPlayer.renderGrid(catPlayer.songs.length ? catPlayer.songs : []);
            if (btn.dataset.view === 'catalogue' && !catPlayer.songs.length) loadCatSongs(db, catPlayer);
            if (btn.dataset.view === 'submissions') submgr.load();
        };
    });

    // DevTools admin API
    window.radio = {
        async admin(password = '') {
            if (admin.unlocked) {
                console.info('%c[GHDB Radio] Admin panel is already open.', 'color:#cba6f7;font-weight:bold');
                return;
            }
            const expected = rules.adminPasswordHash;
            let isMatch = false;
            if (!expected) isMatch = password === 'admin';
            else isMatch = await GitHubDB.verifySecret(password, expected, 'radio-admin');

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

async function loadCatSongs(db, catPlayer) {
    try {
        const songs = await db.collection('songs').list();
        catPlayer.songs = songs;
        byId('cat-count').textContent = `${songs.length} track${songs.length !== 1 ? 's' : ''}`;
        catPlayer.renderGrid(songs);
    } catch (err) {
        console.warn('[catalogue]', err);
    }
}

init();
