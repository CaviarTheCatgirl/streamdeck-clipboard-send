import streamDeck, {
    action,
    type DidReceiveSettingsEvent,
    type KeyAction,
    type KeyDownEvent,
    type KeyUpEvent,
    type PropertyInspectorDidAppearEvent,
    type PropertyInspectorDidDisappearEvent,
    type SendToPluginEvent,
    SingletonAction,
    type WillAppearEvent,
    type WillDisappearEvent
} from "@elgato/streamdeck";

import { bridge, BridgeError, type ContentMode, type JobView, type Snapshot, type TargetKind } from "../bridge";
import {
    busyImage,
    C,
    confirmImage,
    discordConfirmImage,
    idleImage,
    noticeImage,
    offlineImage,
    peekImage,
    pickImage,
    resultImage,
    sendingImage
} from "../render";

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue; };

// ── settings ────────────────────────────────────────────────────────────────

/** "ask" = send, but always show Discord's preview dialog first (whatever the confirmation settings say). */
export type Gesture = "send" | "spoiler" | "ask" | "peek" | "none";

export type Recipient = { id: string; kind?: TargetKind; name?: string; sub?: string; username?: string; avatar?: string; };

export type Settings = {
    recipients?: Recipient[];
    label?: string;
    showLabel?: boolean;

    tapAction?: Gesture;
    doubleTapAction?: Gesture;
    holdAction?: Gesture;

    /** press the key again before sending */
    confirmKey?: boolean;
    /** show Discord's preview dialog before sending */
    confirmDiscord?: boolean;
    /** v1.0 dev builds: one mode instead of the two switches (read for older keys) */
    confirm?: "off" | "key" | "discord";
    /** only ask when sending to at least this many targets */
    confirmMin?: number;
    /** seconds to press again (key confirmation) */
    confirmTimeout?: number;
    /** bring Discord to the front for its confirmation dialog */
    confirmFocus?: boolean;

    content?: ContentMode;
    /** send the message text along (off = only the clipboard content) */
    sendMessage?: boolean;
    message?: string;
    silent?: boolean;
    /** seconds between two people */
    delay?: number;

    holdDelay?: number;
    doubleTapWindow?: number;
};

export const DEFAULTS = {
    showLabel: true,
    tapAction: "send" as Gesture,
    doubleTapAction: "spoiler" as Gesture,
    holdAction: "peek" as Gesture,
    confirmKey: true,
    confirmDiscord: false,
    confirmMin: 1,
    confirmTimeout: 5,
    confirmFocus: true,
    content: "auto" as ContentMode,
    sendMessage: false,
    message: "",
    silent: false,
    delay: 1.5,
    holdDelay: 500,
    doubleTapWindow: 300
};

const ID_RE = /^\d{15,22}$/;
const GESTURES = ["send", "spoiler", "ask", "peek", "none"] as const;
const num = (v: unknown, lo: number, hi: number, d: number) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d;
};
const pick = <T extends string>(v: unknown, allowed: readonly T[], d: T): T => (allowed.includes(v as T) ? v as T : d);
const bool = (v: unknown, d: boolean) => (typeof v === "boolean" ? v : d);

function resolve(s: Settings) {
    const seen = new Set<string>();
    const recipients = (Array.isArray(s.recipients) ? s.recipients : [])
        .filter(r => r && ID_RE.test(String(r.id)))
        .map(r => ({ id: String(r.id), kind: (r.kind === "channel" ? "channel" : "user") as TargetKind, name: typeof r.name === "string" ? r.name : undefined }))
        .filter(r => !seen.has(`${r.kind}:${r.id}`) && !!seen.add(`${r.kind}:${r.id}`));
    // Older settings had one "confirm" mode; the two switches win once they're set.
    const legacy = s.confirm;
    return {
        recipients,
        label: typeof s.label === "string" ? s.label.trim() : "",
        showLabel: bool(s.showLabel, DEFAULTS.showLabel),
        tapAction: pick(s.tapAction, GESTURES, DEFAULTS.tapAction),
        doubleTapAction: pick(s.doubleTapAction, GESTURES, DEFAULTS.doubleTapAction),
        holdAction: pick(s.holdAction, GESTURES, DEFAULTS.holdAction),
        confirmKey: bool(s.confirmKey, legacy ? legacy === "key" : DEFAULTS.confirmKey),
        confirmDiscord: bool(s.confirmDiscord, legacy ? legacy === "discord" : DEFAULTS.confirmDiscord),
        confirmMin: Math.round(num(s.confirmMin, 1, 100, DEFAULTS.confirmMin)),
        confirmTimeout: num(s.confirmTimeout, 2, 30, DEFAULTS.confirmTimeout),
        confirmFocus: bool(s.confirmFocus, DEFAULTS.confirmFocus),
        content: pick(s.content, ["auto", "media", "text"] as const, DEFAULTS.content),
        sendMessage: bool(s.sendMessage, DEFAULTS.sendMessage),
        message: typeof s.message === "string" ? s.message : DEFAULTS.message,
        silent: bool(s.silent, DEFAULTS.silent),
        delay: num(s.delay, 0, 60, DEFAULTS.delay),
        holdDelay: num(s.holdDelay, 250, 2000, DEFAULTS.holdDelay),
        doubleTapWindow: num(s.doubleTapWindow, 120, 800, DEFAULTS.doubleTapWindow)
    };
}
type Resolved = ReturnType<typeof resolve>;

// ── tuning ──────────────────────────────────────────────────────────────────

const POLL_MS = 400;
const OK_FLASH_MS = 3500;
const FAIL_FLASH_MS = 8000;
const NOTICE_MS = 3500;
const PEEK_MS = 3500;
const CONFIRM_TICK_MS = 200;

// ── per-key state ───────────────────────────────────────────────────────────

type Mode =
    | { kind: "idle"; }
    | { kind: "busy"; text: string; }
    | { kind: "confirm"; snapshot: Snapshot; spoiler: boolean; until: number; total: number; timer: NodeJS.Timeout; discord: boolean; }
    | { kind: "job"; job: JobView; timer: NodeJS.Timeout | null; }
    | { kind: "flash"; image: string; timer: NodeJS.Timeout; };

interface Inst {
    id: string;
    action: KeyAction<Settings>;
    raw: Settings;
    s: Resolved;
    mode: Mode;
    drawn: string | null;

    // gestures
    phase: "idle" | "first" | "wait" | "consumed";
    holdTimer: NodeJS.Timeout | null;
    tapTimer: NodeJS.Timeout | null;
    holdFired: boolean;
}

/** Last send and last problem per key, kept while the plugin runs (the settings panel shows them). */
const lastJobs = new Map<string, JobView>();
const lastErrors = new Map<string, string>();

function describeSnapshot(s: Snapshot): string {
    if (s.kind === "text") return `Text, ${s.textLength} chars`;
    if (s.kind === "image") return "Image";
    if (s.kind === "files") return s.count === 1 ? s.items[0]?.name ?? "1 file" : `${s.count} files`;
    return "Nothing";
}

function shortError(msg: string): [string, string] {
    if (/empty/i.test(msg)) return ["Clipboard", "is empty"];
    if (/upload limit/i.test(msg)) return ["Too big", "for your limit"];
    if (/expired/i.test(msg)) return ["Expired", "press again"];
    if (/over your limit/i.test(msg)) return ["Too many", "people"];
    if (/too many files/i.test(msg)) return ["Too many", "files"];
    if (/not reachable|not ready|not running/i.test(msg)) return ["Discord", "not reachable"];
    return ["Didn't send", msg];
}

@action({ UUID: "com.caviarthecatgirl.clipboard-send.send" })
export class ClipboardSendAction extends SingletonAction<Settings> {
    private insts = new Map<string, Inst>();
    /** the key whose settings panel is open */
    private inspected: string | null = null;

    constructor() {
        super();
        bridge.on("status", () => {
            for (const inst of this.insts.values()) this.draw(inst);
            if (this.inspected) void this.sendStatus();
        });
    }

    // ── lifecycle ───────────────────────────────────────────────────────────

    override onWillAppear(ev: WillAppearEvent<Settings>): void {
        if (!ev.action.isKey()) return;
        const raw = ev.payload.settings ?? {};
        const inst: Inst = {
            id: ev.action.id,
            action: ev.action as KeyAction<Settings>,
            raw,
            s: resolve(raw),
            mode: { kind: "idle" },
            drawn: null,
            phase: "idle",
            holdTimer: null,
            tapTimer: null,
            holdFired: false
        };
        this.insts.set(inst.id, inst);
        bridge.use(1);
        // A send started before the page switch keeps going in Discord: pick its progress up again.
        const last = lastJobs.get(inst.id);
        if (last && (last.state === "sending" || last.state === "queued" || last.state === "confirm")) this.follow(inst, last);
        this.draw(inst);
    }

    override onWillDisappear(ev: WillDisappearEvent<Settings>): void {
        const inst = this.insts.get(ev.action.id);
        if (!inst) return;
        this.clearGestures(inst);
        this.setMode(inst, { kind: "idle" }, false);
        this.insts.delete(inst.id);
        bridge.use(-1);
    }

    override onDidReceiveSettings(ev: DidReceiveSettingsEvent<Settings>): void {
        const inst = this.insts.get(ev.action.id);
        if (!inst) return;
        inst.raw = ev.payload.settings ?? {};
        inst.s = resolve(inst.raw);
        this.draw(inst);
    }

    // ── drawing ─────────────────────────────────────────────────────────────

    private label(inst: Inst): string {
        const { recipients, label } = inst.s;
        if (label) return label;
        if (recipients.length === 1) return recipients[0].name || (recipients[0].kind === "channel" ? "1 channel" : "1 person");
        const channels = recipients.filter(r => r.kind === "channel").length;
        const noun = !channels ? "people" : channels === recipients.length ? "channels" : "chats";
        return `${recipients.length} ${noun}`;
    }

    private imageFor(inst: Inst): string {
        const m = inst.mode;
        switch (m.kind) {
            case "flash":
                return m.image;
            case "busy":
                return busyImage(m.text);
            case "confirm":
                return confirmImage({
                    count: m.total,
                    what: describeSnapshot(m.snapshot),
                    spoiler: m.spoiler,
                    left: (m.until - Date.now()) / (inst.s.confirmTimeout * 1000)
                });
            case "job": {
                const j = m.job;
                if (j.state === "confirm") return discordConfirmImage({ spoiler: j.spoiler });
                return sendingImage({ sent: j.sent + j.failed, total: j.total, progress: j.progress, spoiler: j.spoiler, note: j.state === "queued" ? "Waiting…" : j.note });
            }
        }
        if (!inst.s.recipients.length) return pickImage();
        if (bridge.status !== "online") return offlineImage(this.label(inst));
        return idleImage({ count: inst.s.recipients.length, label: this.label(inst), showLabel: inst.s.showLabel });
    }

    private draw(inst: Inst): void {
        if (!this.insts.has(inst.id)) return;
        const img = this.imageFor(inst);
        if (img === inst.drawn) return;
        inst.drawn = img;
        inst.action.setImage(img).catch(e => streamDeck.logger.warn(`Drawing failed: ${e?.message ?? e}`));
    }

    private setMode(inst: Inst, mode: Mode, draw = true): void {
        const old = inst.mode;
        if (old.kind === "confirm" || old.kind === "flash") clearTimeout(old.timer);
        if (old.kind === "job" && old.timer) clearTimeout(old.timer);
        inst.mode = mode;
        if (draw) this.draw(inst);
    }

    private flash(inst: Inst, image: string, ms: number): void {
        this.setMode(inst, { kind: "flash", image, timer: setTimeout(() => this.setMode(inst, { kind: "idle" }), ms) });
    }

    private notice(inst: Inst, msg: string): void {
        lastErrors.set(inst.id, msg);
        const [title, sub] = shortError(msg);
        this.flash(inst, noticeImage(title, sub, /empty/i.test(msg) ? C.dim : C.red), NOTICE_MS);
        inst.action.showAlert().catch(() => { });
        if (this.inspected === inst.id) void this.sendJob(inst.id);
    }

    // ── key gestures ────────────────────────────────────────────────────────

    private clearGestures(inst: Inst): void {
        if (inst.holdTimer) clearTimeout(inst.holdTimer);
        if (inst.tapTimer) clearTimeout(inst.tapTimer);
        inst.holdTimer = inst.tapTimer = null;
        inst.phase = "idle";
        inst.holdFired = false;
    }

    override onKeyDown(ev: KeyDownEvent<Settings>): void {
        const inst = this.insts.get(ev.action.id);
        if (!inst) return;
        if (inst.mode.kind === "flash") this.setMode(inst, { kind: "idle" });
        if (inst.holdTimer) clearTimeout(inst.holdTimer);
        inst.holdFired = false;

        const mode = inst.mode.kind;
        if (mode === "confirm" || mode === "job") {
            // Short press = confirm (key confirmation); hold = cancel.
            inst.phase = "first";
            inst.holdTimer = setTimeout(() => {
                inst.holdTimer = null;
                inst.holdFired = true;
                void this.cancel(inst);
            }, inst.s.holdDelay);
            return;
        }
        if (mode === "busy") return;

        // Second press inside the double-tap window: double tap, right away.
        if (inst.phase === "wait") {
            if (inst.tapTimer) clearTimeout(inst.tapTimer);
            inst.tapTimer = null;
            inst.phase = "consumed";
            void this.perform(inst, inst.s.doubleTapAction);
            return;
        }
        inst.phase = "first";
        inst.holdTimer = setTimeout(() => {
            inst.holdTimer = null;
            inst.holdFired = true;
            void this.perform(inst, inst.s.holdAction);
        }, inst.s.holdDelay);
    }

    override onKeyUp(ev: KeyUpEvent<Settings>): void {
        const inst = this.insts.get(ev.action.id);
        if (!inst) return;
        if (inst.holdTimer) {
            clearTimeout(inst.holdTimer);
            inst.holdTimer = null;
        }
        if (inst.holdFired || inst.phase === "consumed") {
            inst.holdFired = false;
            inst.phase = "idle";
            return;
        }
        if (inst.phase !== "first") return;

        if (inst.mode.kind === "confirm") {
            inst.phase = "idle";
            void this.confirmed(inst);
            return;
        }
        if (inst.mode.kind === "job") {
            inst.phase = "idle";
            return; // a tap while sending does nothing; hold cancels
        }
        // Without a double-tap action there is nothing to wait for.
        if (inst.s.doubleTapAction === "none") {
            inst.phase = "idle";
            void this.perform(inst, inst.s.tapAction);
            return;
        }
        inst.phase = "wait";
        inst.tapTimer = setTimeout(() => {
            inst.tapTimer = null;
            inst.phase = "idle";
            void this.perform(inst, inst.s.tapAction);
        }, inst.s.doubleTapWindow);
    }

    // ── what a gesture does ─────────────────────────────────────────────────

    private async perform(inst: Inst, what: Gesture): Promise<void> {
        if (what === "none") return;
        if (what === "peek") return this.peek(inst);
        return this.start(inst, what === "spoiler", what === "ask");
    }

    private async peek(inst: Inst): Promise<void> {
        if (bridge.status !== "online") bridge.check();
        try {
            const { snapshot } = await bridge.peek(inst.s.content);
            const empty = snapshot.kind === "empty";
            const sub = empty ? (inst.s.content === "text" ? "no text" : inst.s.content === "media" ? "no files / image" : "") : snapshot.kind === "text" ? `${snapshot.textLength} chars` : formatBytes(snapshot.bytes);
            this.flash(inst, peekImage({ title: empty ? "Clipboard empty" : describeSnapshot(snapshot), sub, empty }), PEEK_MS);
            if (this.inspected === inst.id) await streamDeck.ui.sendToPropertyInspector({ type: "peek", ok: true, data: snapshot as unknown as JsonValue });
        } catch (e) {
            this.notice(inst, (e as Error).message);
        }
    }

    /** The confirmation switches only kick in from this many targets on. */
    private enough(inst: Inst): boolean {
        return inst.s.recipients.length >= inst.s.confirmMin;
    }

    private async start(inst: Inst, spoiler: boolean, ask = false): Promise<void> {
        const { recipients } = inst.s;
        if (!recipients.length) {
            inst.action.showAlert().catch(() => { });
            this.flash(inst, pickImage(), NOTICE_MS);
            return;
        }
        lastErrors.delete(inst.id);

        // "Ask in Discord" gesture: the dialog is the confirmation, nothing to press on the key.
        const discord = ask || (inst.s.confirmDiscord && this.enough(inst));
        if (!ask && inst.s.confirmKey && this.enough(inst)) {
            this.setMode(inst, { kind: "busy", text: "Reading…" });
            try {
                const { snapshot } = await bridge.prepare(inst.s.content);
                if (snapshot.kind === "empty" || !snapshot.id) return this.notice(inst, "Clipboard is empty");
                const until = Date.now() + inst.s.confirmTimeout * 1000;
                const timer = setInterval(() => {
                    if (inst.mode.kind !== "confirm") return clearInterval(timer);
                    if (Date.now() >= until) {
                        clearInterval(timer);
                        this.flash(inst, resultImage({ sent: 0, failed: 0, total: 0, cancelled: true, reason: "Not confirmed" }), NOTICE_MS);
                        return;
                    }
                    this.draw(inst);
                }, CONFIRM_TICK_MS);
                this.setMode(inst, { kind: "confirm", snapshot, spoiler, until, total: recipients.length, timer, discord });
            } catch (e) {
                this.notice(inst, (e as Error).message);
            }
            return;
        }

        await this.send(inst, { spoiler, discordConfirm: discord });
    }

    private async confirmed(inst: Inst): Promise<void> {
        const m = inst.mode;
        if (m.kind !== "confirm") return;
        // Both switches on: the key press is followed by Discord's dialog.
        await this.send(inst, { spoiler: m.spoiler, snapshot: m.snapshot.id ?? undefined, discordConfirm: m.discord });
    }

    private async send(inst: Inst, o: { spoiler: boolean; snapshot?: string; discordConfirm?: boolean; }): Promise<void> {
        const s = inst.s;
        this.setMode(inst, { kind: "busy", text: o.discordConfirm ? "Asking…" : "Starting…" });
        try {
            const { job } = await bridge.send({
                recipients: s.recipients,
                snapshot: o.snapshot,
                content: s.content,
                spoiler: o.spoiler,
                message: s.sendMessage ? s.message : "",
                delayMs: Math.round(s.delay * 1000),
                silent: s.silent,
                confirm: o.discordConfirm ? "discord" : "none",
                focus: s.confirmFocus
            });
            this.follow(inst, job);
        } catch (e) {
            this.notice(inst, (e as Error).message);
        }
    }

    private async cancel(inst: Inst): Promise<void> {
        const m = inst.mode;
        if (m.kind === "confirm") {
            this.flash(inst, resultImage({ sent: 0, failed: 0, total: 0, cancelled: true, reason: "Cancelled" }), NOTICE_MS);
            return;
        }
        if (m.kind === "job") {
            try {
                const { job } = await bridge.cancel(m.job.id);
                this.onJob(inst, job);
            } catch (e) {
                streamDeck.logger.warn(`Cancel failed: ${(e as Error).message}`);
            }
        }
    }

    // ── following a send ────────────────────────────────────────────────────

    private follow(inst: Inst, job: JobView): void {
        this.setMode(inst, { kind: "job", job, timer: null });
        this.onJob(inst, job);
    }

    private onJob(inst: Inst, job: JobView): void {
        lastJobs.set(inst.id, job);
        if (this.inspected === inst.id) void this.sendJob(inst.id);
        if (inst.mode.kind !== "job" || inst.mode.job.id !== job.id) return;

        if (job.state === "done" || job.state === "cancelled") {
            const ok = job.state === "done" && !job.failed;
            if (ok) inst.action.showOk().catch(() => { });
            else if (job.failed) inst.action.showAlert().catch(() => { });
            this.flash(inst, resultImage({ sent: job.sent, failed: job.failed, total: job.total, cancelled: job.state === "cancelled", reason: job.error }), ok ? OK_FLASH_MS : FAIL_FLASH_MS);
            return;
        }
        inst.mode.job = job;
        this.draw(inst);
        const mode = inst.mode;
        mode.timer = setTimeout(() => {
            if (inst.mode !== mode || !this.insts.has(inst.id)) return;
            bridge.job(job.id)
                .then(r => this.onJob(inst, r.job))
                .catch(e => {
                    if (inst.mode !== mode) return;
                    if (e instanceof BridgeError && !e.offline && /unknown job/i.test(e.message)) {
                        // Discord was reloaded mid-send: the job is gone.
                        this.notice(inst, "Discord reloaded during the send. Check who got it.");
                        return;
                    }
                    // Keep trying: Discord may just be busy.
                    mode.timer = setTimeout(() => this.onJob(inst, job), 1500);
                });
        }, POLL_MS);
    }

    // ── property inspector ──────────────────────────────────────────────────

    override onPropertyInspectorDidAppear(ev: PropertyInspectorDidAppearEvent<Settings>): void {
        this.inspected = ev.action.id;
        bridge.check();
        void this.sendStatus();
        void this.sendJob(ev.action.id);
    }

    override onPropertyInspectorDidDisappear(ev: PropertyInspectorDidDisappearEvent<Settings>): void {
        if (this.inspected === ev.action.id) this.inspected = null;
    }

    private async sendStatus(): Promise<void> {
        await streamDeck.ui.sendToPropertyInspector({
            type: "status",
            status: bridge.status,
            port: bridge.port,
            info: (bridge.info ?? null) as JsonValue
        });
    }

    private async sendJob(id: string): Promise<void> {
        await streamDeck.ui.sendToPropertyInspector({
            type: "job",
            job: (lastJobs.get(id) ?? null) as unknown as JsonValue,
            error: lastErrors.get(id) ?? null
        });
    }

    override async onSendToPlugin(ev: SendToPluginEvent<JsonValue, Settings>): Promise<void> {
        const msg = (ev.payload ?? {}) as { type?: string; id?: string; q?: string; port?: number; content?: ContentMode; };
        const reply = (p: Record<string, JsonValue>) => streamDeck.ui.sendToPropertyInspector(p);
        const inst = this.insts.get(ev.action.id);
        try {
            switch (msg.type) {
                case "status":
                    return await this.sendStatus();
                case "suggestions": {
                    const data = await bridge.request("GET", "/suggestions");
                    return await reply({ type: "suggestions", ok: true, data });
                }
                case "lookup": {
                    const q = String(msg.id ?? "");
                    try {
                        const data = await bridge.request("GET", `/resolve?q=${encodeURIComponent(q)}`, undefined, 8000);
                        return await reply({ type: "lookup", ok: true, data, q });
                    } catch (e) {
                        return await reply({ type: "lookup", ok: false, error: String((e as Error)?.message ?? e), q });
                    }
                }
                case "channels": {
                    const q = String(msg.q ?? "");
                    const data = await bridge.request("GET", `/channels?q=${encodeURIComponent(q)}`, undefined, 5000);
                    return await reply({ type: "channels", ok: true, data, q });
                }
                case "peek": {
                    const content = (["auto", "media", "text"] as const).includes(msg.content as ContentMode) ? msg.content! : inst?.s.content ?? "auto";
                    const { snapshot } = await bridge.peek(content);
                    return await reply({ type: "peek", ok: true, data: snapshot as unknown as JsonValue });
                }
                case "retry": {
                    const last = lastJobs.get(ev.action.id);
                    if (!last) return;
                    const { job } = await bridge.retry(last.id);
                    if (inst) this.follow(inst, job);
                    else lastJobs.set(ev.action.id, job);
                    return await this.sendJob(ev.action.id);
                }
                case "cancel": {
                    if (inst && (inst.mode.kind === "job" || inst.mode.kind === "confirm")) return await this.cancel(inst);
                    return;
                }
                case "job":
                    return await this.sendJob(ev.action.id);
                case "setPort": {
                    const port = Number(msg.port);
                    const g = await streamDeck.settings.getGlobalSettings<{ port?: number; }>();
                    await streamDeck.settings.setGlobalSettings({ ...g, port });
                    bridge.setPort(port);
                    return await this.sendStatus();
                }
                case "reconnect":
                    bridge.check();
                    return await this.sendStatus();
            }
        } catch (e) {
            await reply({ type: msg.type ?? "error", ok: false, error: String((e as Error)?.message ?? e) });
        }
    }
}

function formatBytes(n: number): string {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
    return `${(n / 1024 / 1024).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}
