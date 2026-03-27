import * as vscode from 'vscode';
import * as https from 'https';
import { log, logError } from '../utils/logger.js';

const SCOPES = ['read:user', 'repo', 'gist'];
const GIST_FILENAME = 'vibesync-data.json';
const GIST_DESCRIPTION = 'VibeSync — Time Tracker Cloud Sync (do not delete)';
const API_HOST = 'api.github.com';
const REQUEST_TIMEOUT_MS = 10_000;

/**
 * Handles all GitHub interactions:
 * - OAuth sign-in/out via VS Code's built-in GitHub auth provider
 * - Fetching commit history from the Events API
 * - CRUD operations on a private Gist for cloud sync
 */
export class GitHubService implements vscode.Disposable {
    private session: vscode.AuthenticationSession | null = null;
    private resolvedUsername: string | null = null;
    private commitCache: Record<string, number> = {};
    private commitCacheExpiry = 0;
    private gistId: string | null = null;
    private disposables: vscode.Disposable[] = [];
    private _onAuthChange = new vscode.EventEmitter<boolean>();
    readonly onAuthChange = this._onAuthChange.event;

    constructor() {
        // Listen for external sign-in/out (e.g. user clicks Accounts menu)
        this.disposables.push(
            vscode.authentication.onDidChangeSessions((e) => {
                if (e.provider.id === 'github') {
                    void this.checkSession();
                }
            })
        );
    }

    // ─── Auth ──────────────────────────────────────────────────────────────────

    async signIn(): Promise<boolean> {
        try {
            this.session = await vscode.authentication.getSession('github', SCOPES, { createIfNone: true });
            if (this.session) {
                log(`[GitHub] Signed in as ${this.session.account.label}`);
                this._onAuthChange.fire(true);
                return true;
            }
        } catch (err) {
            // User cancelled the OAuth popup
            log('[GitHub] Sign-in cancelled or failed');
        }
        return false;
    }

    async signOut(): Promise<void> {
        this.session = null;
        this.resolvedUsername = null;
        this.gistId = null;
        this.commitCache = {};
        this.commitCacheExpiry = 0;
        this._onAuthChange.fire(false);
        log('[GitHub] Signed out');
        vscode.window.showInformationMessage('VibeSync: Signed out of GitHub. Local data preserved.');
    }

    isSignedIn(): boolean {
        return this.session !== null;
    }

    getUsername(): string {
        return this.resolvedUsername || this.session?.account.label || '';
    }

    /** Fetch the actual GitHub login via /user API (account.label may be display name) */
    private async resolveUsername(): Promise<string> {
        if (this.resolvedUsername) return this.resolvedUsername;
        if (!this.session) return '';

        try {
            const res = await this.apiGet('/user');
            if (res.ok && res.data?.login) {
                this.resolvedUsername = String(res.data.login);
                log(`[GitHub] Resolved username: ${this.resolvedUsername} (account.label was: ${this.session.account.label})`);
                return this.resolvedUsername;
            }
        } catch (err) {
            logError('[GitHub] Failed to resolve username', err);
        }
        // Fallback to account.label
        return this.session.account.label;
    }

    /** Silently check if we already have a session (on startup) */
    async checkSession(): Promise<void> {
        try {
            const session = await vscode.authentication.getSession('github', SCOPES, { createIfNone: false });
            const wasSignedIn = this.session !== null;
            this.session = session ?? null;
            const isNowSignedIn = this.session !== null;
            if (wasSignedIn !== isNowSignedIn) {
                this._onAuthChange.fire(isNowSignedIn);
                if (isNowSignedIn) {
                    log(`[GitHub] Session restored for ${this.session!.account.label}`);
                } else {
                    log('[GitHub] Session expired');
                    this.gistId = null;
                }
            }
        } catch {
            // Silently ignore — auth provider may not be available
        }
    }

    // ─── Commits ───────────────────────────────────────────────────────────────

    /**
     * Fetch commit counts per day from GitHub Events API.
     * Returns { "2026-03-05": 12, "2026-03-04": 5, ... }
     * Cached for 10 minutes to avoid excessive API calls.
     */
    /**
     * Fetch contribution counts per day using GitHub's GraphQL API.
     * This is the same data shown on your GitHub profile contribution graph.
     * Cached for 10 minutes to avoid excessive API calls.
     */
    async fetchCommitHistory(): Promise<Record<string, number>> {
        if (!this.session) {
            log('[GitHub] fetchCommitHistory: no session, returning empty');
            return {};
        }

        // Return cache if fresh (10 min)
        if (Date.now() < this.commitCacheExpiry && Object.keys(this.commitCache).length > 0) {
            log(`[GitHub] fetchCommitHistory: returning cached data (${Object.keys(this.commitCache).length} days)`);
            return this.commitCache;
        }

        try {
            const username = await this.resolveUsername();
            log(`[GitHub] Fetching contributions via GraphQL for user: "${username}"`);

            const query = `query($login: String!) {
                user(login: $login) {
                    contributionsCollection {
                        contributionCalendar {
                            weeks {
                                contributionDays {
                                    date
                                    contributionCount
                                }
                            }
                        }
                    }
                }
            }`;

            const res = await this.apiRequest('POST', '/graphql', {
                query,
                variables: { login: username },
            });

            if (!res.ok) {
                if (res.status === 401) {
                    log('[GitHub] GraphQL 401 — re-authenticating');
                    await this.handleAuthError();
                    return this.commitCache;
                }
                log(`[GitHub] GraphQL returned ${res.status}: ${JSON.stringify(res.data)?.slice(0, 300)}`);
                return this.commitCache;
            }

            // Check for GraphQL errors
            if (res.data?.errors) {
                log(`[GitHub] GraphQL errors: ${JSON.stringify(res.data.errors).slice(0, 300)}`);
                return this.commitCache;
            }

            const weeks = res.data?.data?.user?.contributionsCollection?.contributionCalendar?.weeks;
            if (!Array.isArray(weeks)) {
                log(`[GitHub] GraphQL: unexpected response shape, keys: ${JSON.stringify(Object.keys(res.data || {}))}`);
                return this.commitCache;
            }

            const commits: Record<string, number> = {};
            for (const week of weeks) {
                for (const day of week.contributionDays) {
                    if (day.contributionCount > 0) {
                        commits[day.date] = day.contributionCount;
                    }
                }
            }

            this.commitCache = commits;
            this.commitCacheExpiry = Date.now() + 10 * 60 * 1000; // 10 min
            log(`[GitHub] Fetched contributions: ${Object.keys(commits).length} days, total ${Object.values(commits).reduce((a, b) => a + b, 0)} contributions`);
            return commits;
        } catch (err) {
            logError('[GitHub] Failed to fetch contribution history', err);
            return this.commitCache;
        }
    }

    // ─── Gist Sync ─────────────────────────────────────────────────────────────

    /**
     * Find or create the sync Gist. Returns the Gist ID.
     */
    async findOrCreateSyncGist(): Promise<string | null> {
        if (!this.session) return null;
        if (this.gistId) return this.gistId;

        try {
            // Search user's gists for our sync file
            const res = await this.apiGet('/gists?per_page=100');
            if (!res.ok) {
                if (res.status === 401) { await this.handleAuthError(); return null; }
                logError('[GitHub] Failed to list gists', res.status);
                return null;
            }

            const gists = res.data as any[];
            if (!Array.isArray(gists)) {
                logError('[GitHub] gists response is not an array');
                return null;
            }

            // Find the most recently updated gist containing our file
            let bestGist: any = null;
            for (const gist of gists) {
                if (gist.files && gist.files[GIST_FILENAME]) {
                    if (!bestGist || gist.updated_at > bestGist.updated_at) {
                        bestGist = gist;
                    }
                }
            }

            if (bestGist) {
                this.gistId = bestGist.id;
                log(`[GitHub] Found sync Gist: ${this.gistId}`);
                return this.gistId;
            }

            // Create new Gist
            return await this.createSyncGist();
        } catch (err) {
            logError('[GitHub] Failed to find/create sync Gist', err);
            return null;
        }
    }

    private async createSyncGist(): Promise<string | null> {
        const emptyData = {
            version: 1,
            lastSyncedAt: new Date().toISOString(),
            dailySeconds: {},
            dailyNotes: {},
            dailyCommits: {},
        };

        try {
            const res = await this.apiRequest('POST', '/gists', {
                description: GIST_DESCRIPTION,
                public: false,
                files: {
                    [GIST_FILENAME]: { content: JSON.stringify(emptyData, null, 2) },
                },
            });

            if (!res.ok) {
                logError('[GitHub] Failed to create sync Gist', res.status);
                return null;
            }

            const gist = res.data as any;
            this.gistId = gist.id;
            log(`[GitHub] Created sync Gist: ${this.gistId}`);
            return this.gistId;
        } catch (err) {
            logError('[GitHub] Failed to create sync Gist', err);
            return null;
        }
    }

    /**
     * Pull data from the sync Gist.
     */
    async pullFromGist(): Promise<SyncData | null> {
        const gistId = await this.findOrCreateSyncGist();
        if (!gistId) return null;

        try {
            const res = await this.apiGet(`/gists/${gistId}`);
            if (!res.ok) {
                if (res.status === 404) {
                    log('[GitHub] Sync Gist was deleted, recreating...');
                    this.gistId = null;
                    return null;
                }
                if (res.status === 401) { await this.handleAuthError(); return null; }
                return null;
            }

            const gist = res.data as any;
            const file = gist?.files?.[GIST_FILENAME];
            if (!file?.content) {
                log('[GitHub] Gist file empty or missing');
                return null;
            }

            const data = JSON.parse(file.content) as SyncData;
            if (!data || typeof data !== 'object' || !data.version) {
                log('[GitHub] Gist data corrupted, ignoring');
                return null;
            }

            log(`[GitHub] Pulled sync data (last synced: ${data.lastSyncedAt})`);
            return data;
        } catch (err) {
            logError('[GitHub] Failed to pull from Gist', err);
            return null;
        }
    }

    /**
     * Push data to the sync Gist.
     */
    async pushToGist(data: SyncData): Promise<boolean> {
        const gistId = await this.findOrCreateSyncGist();
        if (!gistId) return false;

        try {
            data.lastSyncedAt = new Date().toISOString();
            const res = await this.apiRequest('PATCH', `/gists/${gistId}`, {
                files: {
                    [GIST_FILENAME]: { content: JSON.stringify(data, null, 2) },
                },
            });

            if (!res.ok) {
                if (res.status === 404) {
                    log('[GitHub] Sync Gist was deleted, recreating...');
                    this.gistId = null;
                    const newId = await this.createSyncGist();
                    if (newId) {
                        return this.pushToGist(data); // Retry once
                    }
                    return false;
                }
                if (res.status === 401) { await this.handleAuthError(); return false; }
                logError('[GitHub] Failed to push to Gist', res.status);
                return false;
            }

            log('[GitHub] Pushed sync data to Gist');
            return true;
        } catch (err) {
            logError('[GitHub] Failed to push to Gist', err);
            return false;
        }
    }

    // ─── HTTP helpers (Node.js https — works in all VS Code versions) ─────────

    private apiGet(path: string): Promise<ApiResponse> {
        return this.apiRequest('GET', path);
    }

    private apiRequest(method: string, path: string, body?: any): Promise<ApiResponse> {
        return new Promise((resolve) => {
            const token = this.session?.accessToken;
            const bodyStr = body ? JSON.stringify(body) : undefined;

            const options: https.RequestOptions = {
                hostname: API_HOST,
                path,
                method,
                headers: {
                    'Accept': 'application/vnd.github+json',
                    'Authorization': `Bearer ${token}`,
                    'X-GitHub-Api-Version': '2022-11-28',
                    'User-Agent': 'vibesync-vscode',
                    ...(bodyStr ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(bodyStr) } : {}),
                },
                timeout: REQUEST_TIMEOUT_MS,
            };

            const req = https.request(options, (res) => {
                let data = '';
                res.on('data', (chunk: Buffer) => { data += chunk.toString(); });
                res.on('end', () => {
                    try {
                        const parsed = data ? JSON.parse(data) : null;
                        resolve({ ok: (res.statusCode ?? 0) >= 200 && (res.statusCode ?? 0) < 300, status: res.statusCode ?? 0, data: parsed });
                    } catch {
                        logError(`[GitHub] JSON parse error on ${method} ${path}`, data.slice(0, 200));
                        resolve({ ok: false, status: res.statusCode ?? 0, data: null });
                    }
                });
            });

            req.on('error', (err) => {
                logError(`[GitHub] Request error on ${method} ${path}`, err);
                resolve({ ok: false, status: 0, data: null });
            });

            req.on('timeout', () => {
                req.destroy();
                log(`[GitHub] Request timeout on ${method} ${path}`);
                resolve({ ok: false, status: 0, data: null });
            });

            if (bodyStr) req.write(bodyStr);
            req.end();
        });
    }

    private async handleAuthError(): Promise<void> {
        log('[GitHub] Auth error — attempting re-auth');
        try {
            this.session = await vscode.authentication.getSession('github', SCOPES, { forceNewSession: true });
            if (this.session) {
                log(`[GitHub] Re-authenticated as ${this.session.account.label}`);
                this._onAuthChange.fire(true);
            }
        } catch {
            this.session = null;
            this._onAuthChange.fire(false);
            vscode.window.showWarningMessage('VibeSync: GitHub session expired. Please sign in again.');
        }
    }

    dispose(): void {
        this._onAuthChange.dispose();
        for (const d of this.disposables) d.dispose();
    }

    /** Returns diagnostic info for debugging */
    async debugInfo(): Promise<string> {
        const lines: string[] = ['=== VibeSync GitHub Debug ==='];
        lines.push(`Session: ${this.session ? 'YES' : 'NO'}`);
        lines.push(`account.label: ${this.session?.account.label ?? 'N/A'}`);
        lines.push(`resolvedUsername: ${this.resolvedUsername ?? 'not yet resolved'}`);
        lines.push(`commitCache keys: ${Object.keys(this.commitCache).length}`);
        lines.push(`gistId: ${this.gistId ?? 'none'}`);

        if (this.session) {
            // Test /user endpoint
            lines.push('\n--- Testing /user endpoint ---');
            try {
                const userRes = await this.apiGet('/user');
                lines.push(`Status: ${userRes.status}`);
                if (userRes.ok) {
                    lines.push(`login: ${userRes.data?.login}`);
                    lines.push(`name: ${userRes.data?.name}`);
                    lines.push(`id: ${userRes.data?.id}`);
                } else {
                    lines.push(`Error: ${JSON.stringify(userRes.data)?.slice(0, 200)}`);
                }
            } catch (e) {
                lines.push(`Exception: ${e}`);
            }

            // Test GraphQL contributions endpoint
            const login = this.resolvedUsername || this.session.account.label;
            lines.push(`\n--- Testing GraphQL contributions for ${login} ---`);
            try {
                const contributions = await this.fetchCommitHistory();
                lines.push(`Days with contributions: ${Object.keys(contributions).length}`);
                lines.push(`Total contributions: ${Object.values(contributions).reduce((a, b) => a + b, 0)}`);
                const recent = Object.entries(contributions).sort((a, b) => b[0].localeCompare(a[0])).slice(0, 5);
                for (const [date, count] of recent) {
                    lines.push(`  • ${date}: ${count} contributions`);
                }
            } catch (e) {
                lines.push(`Exception: ${e}`);
            }
        }

        return lines.join('\n');
    }
}

// ─── Types ─────────────────────────────────────────────────────────────────

interface ApiResponse {
    ok: boolean;
    status: number;
    data: any;
}

export interface SyncData {
    version: 1;
    lastSyncedAt: string;
    dailySeconds: Record<string, number>;
    dailyNotes: Record<string, string>;
    dailyCommits: Record<string, number>;
}
