import { byId, escapeHtml, formatTime, shuffled } from './utils.js';
import { CONFIG } from './utils.js';

export class AdminPanel {
    constructor(db, toast, modal, library, playlists, rules, livePlayer) {
        this.db         = db;
        this.toast      = toast;
        this.modal      = modal;
        this.library    = library;
        this.playlists  = playlists;
        this.rules      = rules;
        this.livePlayer = livePlayer;
        this.unlocked   = false;
        this.preview    = null;
        this.onChannelsPanel = null;
        this.afterLoad       = null;

        const closeBtn = byId('admin-close-btn');
        if (closeBtn) closeBtn.onclick = () => this.close();

        document.querySelectorAll('.admin-nav-btn').forEach(btn => {
            btn.onclick = () => {
                document.querySelectorAll('.admin-nav-btn').forEach(nb => nb.classList.remove('active'));
                document.querySelectorAll('.admin-panel').forEach(panel => panel.classList.remove('active'));
                btn.classList.add('active');
                byId(`panel-${btn.dataset.panel}`)?.classList.add('active');
                if (btn.dataset.panel === 'submissions') this.loadSubmissions();
                if (btn.dataset.panel === 'channels')    this.onChannelsPanel?.();
            };
        });

        const goLive = byId('go-live-btn');
        if (goLive) goLive.onclick = () => this.goLive();
        const stopBroadcast = byId('stop-broadcast-btn');
        if (stopBroadcast) stopBroadcast.onclick = () => this.stopBroadcast();
        const skipTrack = byId('skip-track-btn');
        if (skipTrack) skipTrack.onclick = () => this.skipTrack();
        const saveRules = byId('save-rules-btn');
        if (saveRules) saveRules.onclick = () => this.saveRules();
        const changePw = byId('change-password-btn');
        if (changePw) changePw.onclick = () => this.changePassword();
        const refreshSub = byId('refresh-submissions-btn');
        if (refreshSub) refreshSub.onclick = () => this.loadSubmissions();
    }

    open() {
        this.unlocked = true;
        byId('admin-overlay').classList.remove('hidden');
        this.loadAll();
    }

    close() {
        byId('admin-overlay').classList.add('hidden');
        this.unlocked = false;
    }

    async loadAll() {
        await Promise.all([
            this.library.load(),
            this.playlists.load(),
            this.loadBroadcastStatus(),
            this.applyRulesToForm(),
            this.loadSubmissions(),
        ]);
        if (this.afterLoad) await this.afterLoad();
    }

    async loadBroadcastStatus() {
        const state = await this.db.kv.get('radio_state');
        const badge = byId('on-air-badge');
        const info  = byId('broadcast-info');
        if (!badge || !info) return;

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

        const totalMs    = state.songs.reduce((acc, song) => acc + song.duration_ms, 0);
        const elapsed    = Date.now() - state.playlistStartedAt;
        const loopElapsed = this.rules.autoLoop ? elapsed % totalMs : elapsed;
        let runningMs    = 0;
        let currentTrack = null;

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
                &nbsp;\u00b7&nbsp;
                <i class="fa-solid fa-bars-staggered" aria-hidden="true"></i> ${state.songs.length} tracks
                &nbsp;\u00b7&nbsp;
                <i class="fa-solid fa-repeat" aria-hidden="true"></i> ${state.mode ?? 'sequential'}
            </div>
        `;
    }

    async goLive() {
        const mode       = document.querySelector('input[name="playback-mode"]:checked')?.value ?? 'sequential';
        const playlistId = byId('quick-playlist-select')?.value || null;

        let songs;
        let label;

        if (playlistId) {
            const playlist = this.playlists.playlists.find(pl => pl.id === playlistId);
            if (!playlist) { this.toast.show('Playlist not found', 'warning'); return; }
            const allSongs = await this.db.collection('songs').list();
            const songMap  = new Map(allSongs.map(song => [song.id, song]));
            songs = (playlist.songs ?? []).map(id => songMap.get(id)).filter(Boolean);
            label = playlist.name;
        } else {
            songs = await this.db.collection('songs').list();
            label = 'All Songs';
        }

        if (!songs.length) { this.toast.show('No songs to broadcast', 'warning'); return; }
        if (mode === 'shuffle') songs = shuffled(songs);

        await this.db.kv.set('radio_state', {
            playlistStartedAt: Date.now(),
            songs,
            mode,
            playlistId,
        });

        this.toast.show(`Now broadcasting: ${label} (${songs.length} tracks)`, 'success');
        this.loadBroadcastStatus();
        this.livePlayer.startSync();
    }

    stopBroadcast() {
        this.modal.confirm(
            'Stop Broadcast',
            'Stop the current broadcast? Listeners will be disconnected.',
            async () => {
                await this.db.kv.delete('radio_state');
                this.livePlayer.stopSync();
                this.livePlayer.audio.pause();
                this.livePlayer.audio.src  = '';
                this.livePlayer.tunedIn    = false;
                this.livePlayer.setOffline();
                this.loadBroadcastStatus();
                this.toast.show('Broadcast stopped', 'info');
            }
        );
    }

    async skipTrack() {
        const state = await this.db.kv.get('radio_state');
        if (!state?.songs?.length) { this.toast.show('No active broadcast', 'warning'); return; }

        const totalMs  = state.songs.reduce((acc, song) => acc + song.duration_ms, 0);
        const elapsed  = (Date.now() - state.playlistStartedAt) % totalMs;
        let runningMs  = 0;
        let currentIdx = 0;

        for (let idx = 0; idx < state.songs.length; idx++) {
            const dur = state.songs[idx].duration_ms;
            if (elapsed >= runningMs && elapsed < runningMs + dur) { currentIdx = idx; break; }
            runningMs += dur;
        }

        const nextIdx  = (currentIdx + 1) % state.songs.length;
        let skipMs     = 0;
        for (let idx = 0; idx < nextIdx; idx++) skipMs += state.songs[idx].duration_ms;

        await this.db.kv.set('radio_state', { ...state, playlistStartedAt: Date.now() - skipMs });
        this.livePlayer.startSync();
        this.toast.show('Skipped to next track', 'info');
    }

    async loadSubmissions() {
        try {
            const all     = await this.db.collection('submissions').list();
            const pending = all.filter(sub => sub.status === 'pending');
            this.renderAdminSubmissions(pending);
        } catch (err) {
            console.warn('[admin submissions]', err);
        }
    }

    renderAdminSubmissions(pending) {
        const tbody = byId('submissions-tbody');
        if (!tbody) return;
        if (!pending.length) {
            tbody.innerHTML = `<tr><td colspan="5"><div class="empty-state">No pending submissions</div></td></tr>`;
            return;
        }
        tbody.innerHTML = pending.map(sub => `
            <tr data-id="${sub.id}">
                <td class="track-title">${escapeHtml(sub.title ?? 'Unknown')}</td>
                <td>${escapeHtml(sub.artist ?? 'Unknown')}</td>
                <td class="track-dur">${formatTime(sub.duration_ms)}</td>
                <td><span class="status-pending">pending</span></td>
                <td class="track-actions">
                    <button class="icon-btn preview-sub-btn"
                            data-url="${sub.fileUrl}"
                            data-title="${escapeHtml(sub.title ?? '')}"
                            aria-label="Preview ${escapeHtml(sub.title ?? 'song')}">
                        <i class="fa-solid fa-play" aria-hidden="true"></i>
                    </button>
                    <button class="icon-btn approve-btn" data-id="${sub.id}"
                            aria-label="Approve ${escapeHtml(sub.title ?? 'song')}">
                        <i class="fa-solid fa-check status-approved-icon" aria-hidden="true"></i>
                    </button>
                    <button class="icon-btn decline-btn" data-id="${sub.id}"
                            aria-label="Decline ${escapeHtml(sub.title ?? 'song')}">
                        <i class="fa-solid fa-xmark status-declined-icon" aria-hidden="true"></i>
                    </button>
                </td>
            </tr>
        `).join('');

        tbody.querySelectorAll('.preview-sub-btn').forEach(btn => {
            btn.onclick = () => this.preview?.play(btn.dataset.url, btn.dataset.title, btn);
        });
        tbody.querySelectorAll('.approve-btn').forEach(btn => {
            btn.onclick = () => this.approveSubmission(btn.dataset.id);
        });
        tbody.querySelectorAll('.decline-btn').forEach(btn => {
            btn.onclick = () => this.declineSubmission(btn.dataset.id);
        });
    }

    setPreview(preview) { this.preview = preview; }

    async approveSubmission(id) {
        const sub = await this.db.collection('submissions').get(id);
        if (!sub) { this.toast.show('Submission not found', 'error'); return; }
        const { status, submittedAt, approvedAt, declinedAt, id: _id, ...songData } = sub;
        await this.db.collection('songs').add(songData);
        await this.db.collection('submissions').update(id, { status: 'approved', approvedAt: Date.now() });
        this.toast.show(`Approved: ${sub.title}`, 'success');
        this.loadSubmissions();
        this.library.load();
    }

    async declineSubmission(id) {
        const sub = await this.db.collection('submissions').get(id);
        if (!sub) { this.toast.show('Submission not found', 'error'); return; }
        await this.db.collection('submissions').update(id, { status: 'declined', declinedAt: Date.now() });
        this.toast.show(`Declined: ${sub.title}`, 'info');
        this.loadSubmissions();
    }

    applyRulesToForm() {
        const setChecked = (id, val) => { const el = byId(id); if (el) el.checked = val; };
        const setValue = (id, val) => { const el = byId(id); if (el) el.value = val; };
        setChecked('rule-auto-loop', this.rules.autoLoop ?? true);
        setChecked('rule-restart-empty', this.rules.restartOnEmpty ?? true);
        setChecked('rule-shuffle-loop', this.rules.shuffleOnLoop ?? false);
        setChecked('rule-no-repeat', this.rules.noRepeat ?? true);
        setValue('rule-sync-interval', this.rules.syncInterval ?? 10);
        setValue('rule-drift-threshold', this.rules.driftThreshold ?? 2);
    }

    async saveRules() {
        Object.assign(this.rules, {
            autoLoop:       byId('rule-auto-loop').checked,
            restartOnEmpty: byId('rule-restart-empty').checked,
            shuffleOnLoop:  byId('rule-shuffle-loop').checked,
            noRepeat:       byId('rule-no-repeat').checked,
            syncInterval:   parseInt(byId('rule-sync-interval').value)   || 10,
            driftThreshold: parseInt(byId('rule-drift-threshold').value) || 2,
        });
        await this.db.kv.set('radio_rules', this.rules);
        this.livePlayer.startSync();
        this.toast.show('Rules saved', 'success');
    }

    async changePassword() {
        const password = byId('rule-admin-password').value.trim();
        if (!password || password.length < 4) {
            this.toast.show('Password must be at least 4 characters', 'warning');
            return;
        }
        this.rules.adminPasswordHash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(password + 'radio-admin'))
            .then(buf => Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join(''));
        await this.db.kv.set('radio_rules', this.rules);
        byId('rule-admin-password').value = '';
        this.toast.show('Password updated', 'success');
    }
}
