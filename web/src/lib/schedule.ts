// Automation schedules are five-field cron in the server's local time
// (Workbench.Cron). The dialog offers the common shapes and falls back to cron.

export type ScheduleKind = "hourly" | "daily" | "weekdays" | "weekly" | "custom";

export interface ScheduleForm {
  kind: ScheduleKind;
  /** "HH:MM", for daily, weekdays and weekly */
  time: string;
  /** 0 Sunday … 6 Saturday, for weekly */
  weekday: number;
  /** for custom */
  cron: string;
}

export const SCHEDULE_KINDS: { id: ScheduleKind; label: string }[] = [
  { id: "hourly", label: "Every hour" },
  { id: "daily", label: "Every day" },
  { id: "weekdays", label: "Weekdays" },
  { id: "weekly", label: "Every week" },
  { id: "custom", label: "Custom (cron)" },
];

export const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export const DEFAULT_SCHEDULE: ScheduleForm = { kind: "daily", time: "03:00", weekday: 1, cron: "0 3 * * *" };

const pad = (n: number) => String(n).padStart(2, "0");
const num = (s: string) => (/^\d{1,2}$/.test(s) ? Number(s) : null);

export function toCron(f: ScheduleForm): string {
  if (f.kind === "custom") return f.cron.trim().split(/\s+/).join(" ");
  if (f.kind === "hourly") return "0 * * * *";
  const [h, m] = f.time.split(":").map(Number);
  const days = f.kind === "weekdays" ? "1-5" : f.kind === "weekly" ? String(f.weekday) : "*";
  return `${m || 0} ${h || 0} * * ${days}`;
}

/** The form for a cron expression: one of the shapes above, or custom. */
export function fromCron(cron: string): ScheduleForm {
  const parts = cron.trim().split(/\s+/);
  const base = { ...DEFAULT_SCHEDULE, cron };
  if (parts.length !== 5) return { ...base, kind: "custom" };
  const [mi, hr, day, month, weekday] = parts;
  if (cron === "0 * * * *") return { ...base, kind: "hourly" };
  const m = num(mi);
  const h = num(hr);
  if (m === null || h === null || m > 59 || h > 23 || day !== "*" || month !== "*") return { ...base, kind: "custom" };
  const time = `${pad(h)}:${pad(m)}`;
  if (weekday === "*") return { ...base, kind: "daily", time };
  if (weekday === "1-5") return { ...base, kind: "weekdays", time };
  const w = num(weekday);
  if (w !== null && w <= 7) return { ...base, kind: "weekly", time, weekday: w % 7 };
  return { ...base, kind: "custom" };
}

/** "Every day at 03:00", "Mondays at 09:30", or the cron itself. */
export function describeSchedule(cron: string): string {
  const f = fromCron(cron);
  switch (f.kind) {
    case "hourly":
      return "Every hour";
    case "daily":
      return `Every day at ${f.time}`;
    case "weekdays":
      return `Weekdays at ${f.time}`;
    case "weekly":
      return `${WEEKDAYS[f.weekday]}s at ${f.time}`;
    default:
      return cron;
  }
}

/** "Today 03:00", "Tomorrow 03:00", "Fri 03:00" within a week, else "Oct 12 03:00". */
export function when(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(d) - day(new Date())) / 86_400_000);
  if (diff === 0) return `Today ${time}`;
  if (diff === 1) return `Tomorrow ${time}`;
  if (diff === -1) return `Yesterday ${time}`;
  if (diff > 1 && diff < 7) return `${d.toLocaleDateString(undefined, { weekday: "short" })} ${time}`;
  return `${d.toLocaleDateString(undefined, { month: "short", day: "numeric" })} ${time}`;
}
