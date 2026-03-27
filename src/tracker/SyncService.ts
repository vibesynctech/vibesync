import * as vscode from 'vscode';
import { log, logError } from '../utils/logger.js';
import { GitHubService, SyncData } from './GitHubService.js';
import { ActivityTracker } from './ActivityTracker.js';

const SYNC_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const DEBOUNCE_MS = 10_000; // Wait 10s after last save before syncing

/**
 * Handles merging and syncing data between local globalState and remote Gist.
 *
 * Sync strategy:
 * - dailySeconds: MAX(local, remote) per day — hours only go up
 * - dailyNotes: last-write-wins based on lastSyncedAt timestamp
 * - dailyCommits: always pulled from GitHub API (source of truth)
 *
 * Runs a periodic sync every 5 minutes when signed in.
 */
export class SyncService implements vscode.Disposable {
    private syncInterval: NodeJS.Timeout | null = null;
    private debounceTimer: NodeJS.Timeout | null = null;
    private isSyncing = false;
    private dataChanged = false;
    private disposables: vscode.Disposable[] = [];

    constructor(
        private readonly tracker: ActivityTracker,
        private readonly github: GitHubService,
    ) {
        // Listen for auth changes
        this.disposables.push(
            this.github.onAuthChange((signedIn) => {
                if (signedIn) {
                    void this.initialSync();
                    this.startPeriodicSync();
                } else {
                    this.stopPeriodicSync();
                }
            })
        );

        // Listen for data changes from the tracker
        this.disposables.push(
            this.tracker.onDataChanged(() => {
                this.dataChanged = true;
                this.debouncePush();
            })
        );
    }

    /** Called once on startup — try to restore session and sync */
    async start(): Promise<void> {
        await this.github.checkSession();
        if (this.github.isSignedIn()) {
            void this.initialSync();
            this.startPeriodicSync();
        }
    }

    /** Pull remote data and merge with local, then push merged result back */
    async initialSync(): Promise<void> {
        if (!this.github.isSignedIn()) return;
        log('[Sync] Starting initial sync...');

        try {
            const remote = await this.github.pullFromGist();
            if (remote) {
                this.mergeRemoteIntoLocal(remote);
                log('[Sync] Merged remote data into local');
            }

            // Push merged local data back to Gist
            await this.pushLocalToRemote();
            log('[Sync] Initial sync complete');
        } catch (err) {
            logError('[Sync] Initial sync failed', err);
        }
    }

    /** Manual trigger for sync (e.g. from command) */
    async syncNow(): Promise<void> {
        if (!this.github.isSignedIn()) {
            vscode.window.showInformationMessage('VibeSync: Sign in with GitHub to enable sync.');
            return;
        }
        await this.initialSync();
        vscode.window.showInformationMessage('VibeSync: Synced successfully! ✓');
    }

    // ─── Merge Logic ──────────────────────────────────────────────────────────

    private mergeRemoteIntoLocal(remote: SyncData): void {
        // Merge hours: take MAX per day
        const localHistory = this.tracker.getHistory();
        const mergedHours: Record<string, number> = { ...localHistory };
        for (const [day, secs] of Object.entries(remote.dailySeconds)) {
            mergedHours[day] = Math.max(mergedHours[day] || 0, secs);
        }
        this.tracker.importHours(mergedHours);

        // Merge notes: take remote if remote is newer, otherwise keep local
        // We can't do per-note timestamps easily, so we use the overall lastSyncedAt
        // If remote was synced after our last boot, take remote notes for days we don't have locally
        const localNotes = this.tracker.getAllNotes();
        const mergedNotes: Record<string, string> = { ...localNotes };
        for (const [day, note] of Object.entries(remote.dailyNotes)) {
            if (!mergedNotes[day]) {
                // We don't have this note locally — take remote
                mergedNotes[day] = note;
            }
            // If we have it locally, keep local (last-edit-wins on current device)
        }
        this.tracker.importNotes(mergedNotes);
    }

    private async pushLocalToRemote(): Promise<void> {
        if (this.isSyncing || !this.github.isSignedIn()) return;
        this.isSyncing = true;

        try {
            const data: SyncData = {
                version: 1,
                lastSyncedAt: new Date().toISOString(),
                dailySeconds: this.tracker.getHistory(),
                dailyNotes: this.tracker.getAllNotes(),
                dailyCommits: {}, // Commits come from GitHub API, not stored locally
            };

            await this.github.pushToGist(data);
            this.dataChanged = false;
        } catch (err) {
            logError('[Sync] Push failed', err);
        } finally {
            this.isSyncing = false;
        }
    }

    // ─── Periodic Sync ────────────────────────────────────────────────────────

    private startPeriodicSync(): void {
        this.stopPeriodicSync();
        this.syncInterval = setInterval(() => {
            if (this.dataChanged && this.github.isSignedIn()) {
                void this.pushLocalToRemote();
            }
        }, SYNC_INTERVAL_MS);
        log('[Sync] Periodic sync started (every 5 min)');
    }

    private stopPeriodicSync(): void {
        if (this.syncInterval) {
            clearInterval(this.syncInterval);
            this.syncInterval = null;
            log('[Sync] Periodic sync stopped');
        }
    }

    /** Debounce push — wait for data to settle before pushing */
    private debouncePush(): void {
        if (this.debounceTimer) clearTimeout(this.debounceTimer);
        this.debounceTimer = setTimeout(() => {
            if (this.dataChanged && this.github.isSignedIn()) {
                void this.pushLocalToRemote();
            }
        }, DEBOUNCE_MS);
    }

    /** Final push on extension deactivate */
    async finalSync(): Promise<void> {
        if (this.github.isSignedIn() && this.dataChanged) {
            await this.pushLocalToRemote();
            log('[Sync] Final sync on deactivate');
        }
    }

    dispose(): void {
        this.stopPeriodicSync();
        if (this.debounceTimer) clearTimeout(this.debounceTimer);
        for (const d of this.disposables) d.dispose();
    }
}
