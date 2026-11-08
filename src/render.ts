/**
 * Key images (144 × 144 SVG). Plain shapes and text only, so they look the same on every
 * Stream Deck and need nothing from Discord to be drawn.
 */

const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&apos;" })[c]!);
const svgUrl = (svg: string) => `data:image/svg+xml;charset=utf8,${encodeURIComponent(svg)}`;
const FONT = "font-family=\"Segoe UI, Helvetica Neue, Arial, sans-serif\"";

export const C = {
    bg: "#0e0f12",
    track: "#2b2d33",
    text: "#f2f3f5",
    sub: "#b5bac1",
    dim: "#80848e",
    blurple: "#5865f2",
    green: "#3ba55d",
    amber: "#faa61a",
    red: "#ed4245",
    spoiler: "#c9a0ff"
};

export const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

interface Line { text: string; color?: string; size?: number; weight?: number; }

function frame(body: string, border?: string): string {
    const edge = border ? `<rect x="3" y="3" width="138" height="138" rx="14" fill="none" stroke="${border}" stroke-width="5"/>` : "";
    return svgUrl(`<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144"><rect width="144" height="144" fill="${C.bg}"/>${body}${edge}</svg>`);
}

function lines(ls: Line[], top: number): string {
    let y = top;
    return ls.map(l => {
        const size = l.size ?? 17;
        y += size + 3;
        return `<text x="72" y="${y}" ${FONT} font-size="${size}" font-weight="${l.weight ?? 600}" fill="${l.color ?? C.sub}" text-anchor="middle">${esc(l.text)}</text>`;
    }).join("");
}

/** Paper plane, centred on (x, y), size ≈ s. */
function plane(x: number, y: number, s: number, color: string, fill = false): string {
    const k = s / 48;
    return `<g transform="translate(${x - 24 * k} ${y - 24 * k}) scale(${k})" fill="${fill ? color : "none"}" fill-opacity="${fill ? 0.18 : 0}" stroke="${color}" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round">
<path d="M5 22.5 43 6 31.5 42.5 22.5 28.5Z"/><path d="M22.5 28.5 43 6" fill="none"/><path d="M22.5 28.5v10.5l5.2-6" fill="none"/></g>`;
}

/** Clipboard board, centred on (x, y). */
function board(x: number, y: number, s: number, color: string): string {
    const k = s / 48;
    return `<g transform="translate(${x - 24 * k} ${y - 24 * k}) scale(${k})" fill="none" stroke="${color}" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round">
<rect x="9" y="8" width="30" height="36" rx="4"/><rect x="17" y="4" width="14" height="8" rx="2.5" fill="${C.bg}"/><path d="M16 22h16M16 29h16M16 36h9"/></g>`;
}

function badge(n: number, color: string): string {
    const t = n > 99 ? "99+" : String(n);
    const w = t.length > 2 ? 40 : t.length > 1 ? 32 : 28;
    return `<rect x="${136 - w}" y="8" width="${w}" height="28" rx="14" fill="${color}"/>
<text x="${136 - w / 2}" y="28" ${FONT} font-size="17" font-weight="800" fill="#fff" text-anchor="middle">${t}</text>`;
}

function spoilerTag(y = 16): string {
    return `<rect x="8" y="${y - 8}" width="58" height="20" rx="5" fill="${C.spoiler}" fill-opacity="0.22" stroke="${C.spoiler}" stroke-width="1.5"/>
<text x="37" y="${y + 6}" ${FONT} font-size="11" font-weight="800" fill="${C.spoiler}" text-anchor="middle" letter-spacing="0.5">SPOILER</text>`;
}

function bar(progress: number, color: string): string {
    const w = Math.max(0, Math.min(1, progress)) * 112;
    return `<rect x="16" y="122" width="112" height="8" rx="4" fill="${C.track}"/><rect x="16" y="122" width="${w.toFixed(1)}" height="8" rx="4" fill="${color}"/>`;
}

/** Ring that empties as time runs out (fraction left 0..1). */
function ring(left: number, color: string): string {
    const r = 64, c = 2 * Math.PI * r;
    const dash = Math.max(0, Math.min(1, left)) * c;
    return `<circle cx="72" cy="72" r="${r}" fill="none" stroke="${C.track}" stroke-width="6"/>
<circle cx="72" cy="72" r="${r}" fill="none" stroke="${color}" stroke-width="6" stroke-linecap="round" stroke-dasharray="${dash.toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 72 72)"/>`;
}

// ── states ──────────────────────────────────────────────────────────────────

export function idleImage(o: { count: number; label: string; showLabel: boolean; }): string {
    const glyphY = o.showLabel ? 54 : 72;
    const label = o.showLabel ? lines([{ text: clip(o.label, 12), color: C.text, size: 18, weight: 700 }], 92) : "";
    return frame(plane(o.showLabel ? 70 : 70, glyphY, o.showLabel ? 62 : 78, C.blurple, true) + label + (o.count ? badge(o.count, C.blurple) : ""));
}

export function pickImage(): string {
    return frame(plane(70, 50, 56, C.dim) + lines([{ text: "Pick", size: 17 }, { text: "people", size: 17 }], 80));
}

export function offlineImage(label: string): string {
    return frame(plane(70, 50, 56, C.dim) + lines([{ text: clip(label, 11), size: 16 }, { text: "Discord off", color: C.red, size: 16, weight: 700 }], 80));
}

export function busyImage(text: string): string {
    return frame(board(72, 52, 56, C.sub) + lines([{ text, color: C.sub, size: 16 }], 88));
}

export function confirmImage(o: { count: number; what: string; spoiler: boolean; left: number; }): string {
    return frame(
        ring(o.left, C.amber)
        + (o.spoiler ? spoilerTag(30) : "")
        + lines([
            { text: `Send to ${o.count}?`, color: C.text, size: 19, weight: 800 },
            { text: clip(o.what, 13), color: C.sub, size: 14 },
            { text: "Press again", color: C.amber, size: 15, weight: 700 }
        ], 38)
    );
}

export function discordConfirmImage(o: { spoiler: boolean; }): string {
    return frame(
        (o.spoiler ? spoilerTag(18) : "")
        + plane(72, 50, 50, C.amber)
        + lines([{ text: "Confirm", color: C.amber, size: 17, weight: 700 }, { text: "in Discord", color: C.sub, size: 15 }], 80),
        C.amber
    );
}

export function sendingImage(o: { sent: number; total: number; progress: number; spoiler: boolean; note: string; }): string {
    return frame(
        (o.spoiler ? spoilerTag(16) : "")
        + plane(72, 50, 50, C.blurple, true)
        + lines([
            { text: `${o.sent} / ${o.total}`, color: C.text, size: 22, weight: 800 },
            { text: o.note ? clip(o.note, 14) : "Sending…", color: o.note ? C.amber : C.sub, size: 13 }
        ], 76)
        + bar(o.progress, C.blurple)
    );
}

export function resultImage(o: { sent: number; failed: number; total: number; cancelled: boolean; reason?: string; }): string {
    if (o.cancelled && !o.sent && !o.failed) {
        return frame(plane(72, 50, 50, C.dim) + lines([{ text: "Not sent", color: C.sub, size: 18, weight: 700 }, { text: clip(o.reason || "Cancelled", 14), color: C.dim, size: 13 }], 80));
    }
    if (!o.failed && !o.cancelled) {
        const check = `<path d="M44 62 63 81 101 43" fill="none" stroke="${C.green}" stroke-width="11" stroke-linecap="round" stroke-linejoin="round"/>`;
        return frame(check + lines([{ text: o.total === 1 ? "Sent" : `Sent to ${o.total}`, color: C.green, size: 19, weight: 800 }], 92), C.green);
    }
    return frame(
        lines([
            { text: `${o.sent} sent`, color: o.sent ? C.green : C.dim, size: 20, weight: 800 },
            { text: o.failed ? `${o.failed} failed` : "", color: C.red, size: 20, weight: 800 },
            { text: o.cancelled ? "stopped" : "see settings", color: C.dim, size: 13 }
        ], 22),
        o.failed ? C.red : C.amber
    );
}

export function noticeImage(title: string, sub: string, color: string = C.red): string {
    return frame(board(72, 46, 48, color) + lines([{ text: clip(title, 13), color, size: 16, weight: 700 }, { text: clip(sub, 15), color: C.dim, size: 12 }], 76));
}

export function peekImage(o: { title: string; sub: string; empty: boolean; }): string {
    return frame(board(72, 46, 50, o.empty ? C.dim : C.text) + lines([{ text: clip(o.title, 13), color: o.empty ? C.sub : C.text, size: 16, weight: 700 }, { text: clip(o.sub, 15), color: C.dim, size: 13 }], 76));
}
