/** A short "how long ago": now, 5m, 3h, 2d, 3w, or a date. */
export function ago(iso: string | null, now = Date.now()): string {
  if (!iso) return "";
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return "";
  const minutes = Math.max(0, Math.round((now - then) / 60_000));
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  if (days < 28) return days < 7 ? `${days}d` : `${Math.round(days / 7)}w`;
  return new Date(then).toLocaleDateString(undefined, { day: "numeric", month: "short", year: new Date(then).getFullYear() === new Date(now).getFullYear() ? undefined : "numeric" });
}

/** ago in a sentence: "just now", "3h ago", "on 3 Nov". */
export function agoText(iso: string | null, now = Date.now()): string {
  const short = ago(iso, now);
  if (short === "") return "";
  if (short === "now") return "just now";
  return /^\d+[mhdw]$/.test(short) ? `${short} ago` : `on ${short}`;
}

/** The day an entry falls on, as a heading: Today, Yesterday, or the date. */
export function dayOf(iso: string, now = Date.now()) {
  const day = new Date(iso);
  const today = new Date(now);
  const daysBetween = Math.round((new Date(today.toDateString()).getTime() - new Date(day.toDateString()).getTime()) / 86_400_000);
  if (daysBetween === 0) return "Today";
  if (daysBetween === 1) return "Yesterday";
  return day.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "short" });
}
