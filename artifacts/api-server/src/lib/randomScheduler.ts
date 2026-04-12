import { logger } from "./logger.js";

const MOUNTAIN_TZ = "America/Edmonton";

interface DayWindow {
  startHour: number;
  startMinute: number;
  endHour: number;
  endMinute: number;
}

const WEEKDAY_WINDOW: DayWindow = { startHour: 8, startMinute: 30, endHour: 19, endMinute: 0 };
const WEEKEND_WINDOW: DayWindow = { startHour: 10, startMinute: 0, endHour: 16, endMinute: 0 };

interface MountainTime {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  dayOfWeek: number;
}

function getMountainComponents(d: Date = new Date()): MountainTime {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: MOUNTAIN_TZ,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
    hour12: false,
    weekday: "short",
  }).formatToParts(d);

  const get = (type: string) => {
    const val = parts.find(p => p.type === type)?.value ?? "0";
    return parseInt(val, 10);
  };

  const weekdayStr = parts.find(p => p.type === "weekday")?.value ?? "";
  const dowMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour") === 24 ? 0 : get("hour"),
    minute: get("minute"),
    second: get("second"),
    dayOfWeek: dowMap[weekdayStr] ?? 0,
  };
}

export function toMountainDateStr(d: Date = new Date()): string {
  const mt = getMountainComponents(d);
  return `${mt.year}-${String(mt.month).padStart(2, "0")}-${String(mt.day).padStart(2, "0")}`;
}

function getWindowForDow(dow: number): DayWindow {
  return (dow === 0 || dow === 6) ? WEEKEND_WINDOW : WEEKDAY_WINDOW;
}

function mtMinutesSinceMidnight(mt: MountainTime): number {
  return mt.hour * 60 + mt.minute;
}

function windowStartMinutes(w: DayWindow): number {
  return w.startHour * 60 + w.startMinute;
}

function windowEndMinutes(w: DayWindow): number {
  return w.endHour * 60 + w.endMinute;
}

function randomInRange(min: number, max: number): number {
  return min + Math.floor(Math.random() * (max - min));
}

function minutesToMs(minutes: number): number {
  return minutes * 60 * 1000;
}

export interface ScheduleOptions {
  name: string;
  hasRunToday: () => Promise<boolean> | boolean;
  execute: (reason: string) => void;
}

export function scheduleRandomDaily(opts: ScheduleOptions): void {
  const { name, hasRunToday, execute } = opts;

  const scheduleForDay = async () => {
    const alreadyRan = await hasRunToday();
    const mt = getMountainComponents();
    const w = getWindowForDow(mt.dayOfWeek);
    const nowMinutes = mtMinutesSinceMidnight(mt);
    const wStartMin = windowStartMinutes(w);
    const wEndMin = windowEndMinutes(w);

    if (alreadyRan) {
      logger.info({ name }, `${name}: already ran today — scheduling for next eligible day`);
      scheduleNextDay(mt);
      return;
    }

    if (nowMinutes >= wEndMin) {
      logger.info({ name }, `${name}: past today's window — scheduling for next eligible day`);
      scheduleNextDay(mt);
      return;
    }

    const effectiveStartMin = Math.max(wStartMin, nowMinutes + 1);
    if (effectiveStartMin >= wEndMin) {
      logger.info({ name }, `${name}: window too narrow — scheduling for next eligible day`);
      scheduleNextDay(mt);
      return;
    }

    const chosenMinute = randomInRange(effectiveStartMin, wEndMin);
    const delayMs = minutesToMs(chosenMinute - nowMinutes);

    const chosenHour = Math.floor(chosenMinute / 60);
    const chosenMin = chosenMinute % 60;
    const period = chosenHour >= 12 ? "PM" : "AM";
    const displayHour = chosenHour > 12 ? chosenHour - 12 : chosenHour === 0 ? 12 : chosenHour;
    const timeStr = `${displayHour}:${String(chosenMin).padStart(2, "0")} ${period}`;

    logger.info({ name, scheduledFor: timeStr, delayMs }, `${name}: scheduled for ${timeStr} MT today`);

    setTimeout(async () => {
      const stillNeeded = !(await hasRunToday());
      if (!stillNeeded) {
        logger.info({ name }, `${name}: already ran (manual trigger?) — skipping scheduled fire`);
        scheduleNextDay(getMountainComponents());
        return;
      }
      logger.info({ name }, `${name}: randomized schedule firing now`);
      execute("randomized schedule");
      scheduleNextDay(getMountainComponents());
    }, delayMs);
  };

  const scheduleNextDay = (mt: MountainTime) => {
    const nextDow = (mt.dayOfWeek + 1) % 7;
    const nextW = getWindowForDow(nextDow);
    const nextWStartMin = windowStartMinutes(nextW);

    const minutesUntilMidnight = (24 * 60) - mtMinutesSinceMidnight(mt);
    const delayMs = minutesToMs(minutesUntilMidnight + nextWStartMin);
    const safeDelayMs = Math.max(delayMs, 60_000);

    const tomorrow = new Date(Date.now() + safeDelayMs);
    const nextDate = toMountainDateStr(tomorrow);
    logger.info({ name, nextDate, delayMs: safeDelayMs }, `${name}: will re-evaluate on ${nextDate}`);

    setTimeout(() => scheduleForDay(), safeDelayMs);
  };

  setTimeout(() => scheduleForDay(), 5_000);
}
