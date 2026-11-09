import streamDeck from "@elgato/streamdeck";
import { EventEmitter } from "node:events";
import http from "node:http";

/**
 * Connection to the ClipboardSendDeck Vencord plugin (native.ts) on 127.0.0.1:<port>.
 *
 * Plain JSON calls only. Whether Discord is reachable is checked with GET /status every few
 * seconds while at least one key of this plugin is on screen (a refused connection to
 * localhost costs nothing), and right away after a failed call or a port change.
 */

export const DEFAULT_PORT = 37322;

export type ContentMode = "auto" | "media" | "text";

export interface SnapshotItem { name: string; size: number; type: string; width?: number; height?: number; }

export interface Snapshot {
    id: string | null;
    kind: "files" | "image" | "text" | "empty";
    count: number;
    bytes: number;
    items: SnapshotItem[];
    text: string;
    textLength: number;
    skipped: string[];
}

export type JobState = "confirm" | "queued" | "sending" | "done" | "cancelled";

export interface JobView {
    id: string;
    state: JobState;
    spoiler: boolean;
    kind: Snapshot["kind"];
    count: number;
    bytes: number;
    total: number;
    sent: number;
    failed: number;
    skipped: number;
    current: string | null;
    progress: number;
    note: string;
    error: string;
    results: { id: string; kind: TargetKind; name: string; state: "waiting" | "sending" | "sent" | "failed" | "skipped"; error: string | null; }[];
    startedAt: number;
    finishedAt: number | null;
}

export type TargetKind = "user" | "channel";

export interface SendRequest {
    recipients: { id: string; kind: TargetKind; name?: string; }[];
    snapshot?: string;
    content: ContentMode;
    spoiler: boolean;
    message: string;
    delayMs: number;
    silent: boolean;
    confirm: "none" | "discord";
    focus: boolean;
}

export type Status = "offline" | "online";

export class BridgeError extends Error {
    constructor(message: string, readonly offline = false, readonly status = 0) {
        super(message);
    }
}

const POLL_MS = 4000;

class Bridge extends EventEmitter {
    port = DEFAULT_PORT;
    status: Status = "offline";
    /** what /status said last (version, upload limit, …) */
    info: Record<string, unknown> | null = null;

    private timer: NodeJS.Timeout | null = null;
    private agent = new http.Agent({ keepAlive: true, maxSockets: 6 });
    private users = 0;
    private checking = false;

    /** A key appeared (+1) or disappeared (-1): status is only polled while keys are visible. */
    use(delta: number): void {
        this.users = Math.max(0, this.users + delta);
        if (this.users > 0 && !this.timer) {
            this.check();
            this.timer = setInterval(() => this.check(), POLL_MS);
        } else if (this.users === 0 && this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
    }

    setPort(port: number): void {
        const p = Number.isInteger(port) && port > 1024 && port < 65536 ? port : DEFAULT_PORT;
        if (p === this.port) return;
        this.port = p;
        streamDeck.logger.info(`Port changed to ${p}`);
        this.setStatus("offline");
        this.check();
    }

    check(): void {
        if (this.checking) return;
        this.checking = true;
        this.request<Record<string, unknown>>("GET", "/status", undefined, 2500)
            .then(info => {
                this.info = info;
                this.setStatus("online");
                this.emit("info", info);
            })
            .catch(() => this.setStatus("offline"))
            .finally(() => { this.checking = false; });
    }

    private setStatus(s: Status): void {
        if (s === this.status) return;
        this.status = s;
        streamDeck.logger.info(`Discord bridge ${s}`);
        this.emit("status", s);
    }

    request<T = any>(method: "GET" | "POST", path: string, body?: unknown, timeoutMs = 4000): Promise<T> {
        return new Promise<T>((resolve, reject) => {
            const data = body === undefined ? null : Buffer.from(JSON.stringify(body));
            const req = http.request({
                host: "127.0.0.1",
                port: this.port,
                method,
                path,
                agent: this.agent,
                headers: data ? { "Content-Type": "application/json", "Content-Length": data.length } : {}
            }, res => {
                let text = "";
                res.setEncoding("utf8");
                res.on("data", (c: string) => { text += c; });
                res.on("end", () => {
                    let json: any = null;
                    try {
                        json = JSON.parse(text);
                    } catch { /* not JSON */ }
                    const code = res.statusCode ?? 500;
                    if (code >= 400) return reject(new BridgeError(json?.error ?? `HTTP ${code}`, code === 503, code));
                    if (json && typeof json === "object" && "error" in json && json.error) return reject(new BridgeError(String(json.error), false, code));
                    resolve(json as T);
                });
                res.on("error", e => reject(new BridgeError(e.message)));
            });
            req.setTimeout(timeoutMs, () => req.destroy(new Error("Timed out")));
            req.on("error", e => reject(new BridgeError(`Discord not reachable (${(e as NodeJS.ErrnoException).code ?? e.message})`, true)));
            if (data) req.write(data);
            req.end();
        }).catch(e => {
            if (e instanceof BridgeError && e.offline && path !== "/status") this.check();
            throw e;
        });
    }

    /** quick: holding the key; Discord skips work only a send needs (e.g. making the PNG) */
    peek(content: ContentMode, quick = false): Promise<{ snapshot: Snapshot; }> {
        return this.request("GET", `/peek?content=${content}${quick ? "&quick=1" : ""}`, undefined, 8000);
    }

    prepare(content: ContentMode): Promise<{ snapshot: Snapshot; }> {
        return this.request("POST", "/prepare", { content }, 8000);
    }

    send(req: SendRequest): Promise<{ job: JobView; }> {
        return this.request("POST", "/send", req, 10_000);
    }

    job(id: string): Promise<{ job: JobView; }> {
        return this.request("GET", `/job?id=${encodeURIComponent(id)}`);
    }

    cancel(id: string): Promise<{ job: JobView; }> {
        return this.request("POST", "/cancel", { job: id });
    }

    retry(id: string): Promise<{ job: JobView; }> {
        return this.request("POST", "/retry", { job: id });
    }
}

export const bridge = new Bridge();
