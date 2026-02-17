import { DateTime } from "luxon";
import type { Settings } from "./types";

export function calculateSendTime(
  triggerReceivedAt: Date,
  settings: Settings,
  existingScheduledTimes: Date[] = [],
  replyWindowMinHours: number = 4,
  replyWindowMaxHours: number = 6,
): Date {
  const zone = settings.ceo_timezone;
  const triggerTime = DateTime.fromJSDate(triggerReceivedAt).setZone(zone);

  // Random offset within the trigger's reply window
  const offsetHours = replyWindowMinHours + Math.random() * (replyWindowMaxHours - replyWindowMinHours);
  let sendTime = triggerTime.plus({ hours: offsetHours });

  // Parse business hours
  const [startH, startM] = settings.business_hours_start.split(":").map(Number);
  const [endH, endM] = settings.business_hours_end.split(":").map(Number);

  // Roll forward to business hours
  sendTime = rollToBusinessHours(sendTime, startH, startM, endH, endM, settings.holidays, zone);

  // Space out: no two sends within 15 minutes
  sendTime = spaceSends(sendTime, existingScheduledTimes, startH, startM, endH, endM, settings.holidays, zone);

  return sendTime.toJSDate();
}

export function calculateSendTimeAfterApproval(
  settings: Settings,
  existingScheduledTimes: Date[] = [],
): Date {
  const zone = settings.ceo_timezone;
  // Small random offset: 2-10 minutes from now
  const offsetMinutes = 2 + Math.random() * 8;
  let sendTime = DateTime.now().setZone(zone).plus({ minutes: offsetMinutes });

  const [startH, startM] = settings.business_hours_start.split(":").map(Number);
  const [endH, endM] = settings.business_hours_end.split(":").map(Number);

  sendTime = rollToBusinessHours(sendTime, startH, startM, endH, endM, settings.holidays, zone);
  sendTime = spaceSends(sendTime, existingScheduledTimes, startH, startM, endH, endM, settings.holidays, zone);

  return sendTime.toJSDate();
}

function rollToBusinessHours(
  dt: DateTime,
  startH: number,
  startM: number,
  endH: number,
  endM: number,
  holidays: string[],
  zone: string,
): DateTime {
  let result = dt;
  let iterations = 0;

  while (iterations < 30) {
    // Skip weekends
    if (result.weekday === 6 || result.weekday === 7) {
      result = result.plus({ days: result.weekday === 6 ? 2 : 1 }).set({
        hour: startH,
        minute: startM + Math.floor(Math.random() * 30),
        second: 0,
      });
      iterations++;
      continue;
    }

    // Skip holidays
    const dateStr = result.toFormat("yyyy-MM-dd");
    if (holidays.includes(dateStr)) {
      result = result.plus({ days: 1 }).set({
        hour: startH,
        minute: startM + Math.floor(Math.random() * 30),
        second: 0,
      });
      iterations++;
      continue;
    }

    const startOfBusiness = result.set({ hour: startH, minute: startM, second: 0 });
    const endOfBusiness = result.set({ hour: endH, minute: endM, second: 0 });

    // Before business hours — move to start
    if (result < startOfBusiness) {
      result = startOfBusiness.plus({ minutes: Math.floor(Math.random() * 30) });
      break;
    }

    // After business hours — move to next business day
    if (result >= endOfBusiness) {
      result = result.plus({ days: 1 }).set({
        hour: startH,
        minute: startM + Math.floor(Math.random() * 30),
        second: 0,
      });
      iterations++;
      continue;
    }

    // Within business hours
    break;
  }

  return result;
}

function spaceSends(
  dt: DateTime,
  existingTimes: Date[],
  startH: number,
  startM: number,
  endH: number,
  endM: number,
  holidays: string[],
  zone: string,
): DateTime {
  let result = dt;

  for (const existing of existingTimes) {
    const existingDt = DateTime.fromJSDate(existing).setZone(zone);
    const diff = Math.abs(result.diff(existingDt, "minutes").minutes);
    if (diff < 15) {
      result = result.plus({ minutes: 15 - diff + Math.floor(Math.random() * 5) });
      result = rollToBusinessHours(result, startH, startM, endH, endM, holidays, zone);
    }
  }

  return result;
}
