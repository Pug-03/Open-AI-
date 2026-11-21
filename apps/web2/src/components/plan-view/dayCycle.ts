import { sunTimes, type LatLng } from '@walkwe/core';

// One day as a loop the page can scroll through. The lit part of the day,
// when shadows move, gets three quarters of the loop; the night gets the last
// quarter. `u` is the position on the loop, 0..1.

const HOUR = 3_600_000;
const DAY_SHARE = 0.75;

export interface DayCycle {
  /** Start and end of the lit part (a little before sunrise, a little after sunset). */
  dayStart: number;
  dayEnd: number;
  sunrise: Date;
  sunset: Date;
}

export function cycleFor(now: Date, where: LatLng): DayCycle {
  const { sunrise, sunset } = sunTimes(now, where);
  return { dayStart: sunrise.getTime() - 0.5 * HOUR, dayEnd: sunset.getTime() + 0.75 * HOUR, sunrise, sunset };
}

export function timeAt(c: DayCycle, u: number): Date {
  const v = ((u % 1) + 1) % 1;
  const dayLen = c.dayEnd - c.dayStart;
  if (v <= DAY_SHARE) return new Date(c.dayStart + (v / DAY_SHARE) * dayLen);
  return new Date(c.dayEnd + ((v - DAY_SHARE) / (1 - DAY_SHARE)) * (24 * HOUR - dayLen));
}

export function uAt(c: DayCycle, at: Date): number {
  const dayLen = c.dayEnd - c.dayStart;
  let t = at.getTime();
  // Before today's first light: the same hour on the loop's night side.
  while (t < c.dayStart) t += 24 * HOUR;
  while (t >= c.dayStart + 24 * HOUR) t -= 24 * HOUR;
  if (t <= c.dayEnd) return ((t - c.dayStart) / dayLen) * DAY_SHARE;
  return DAY_SHARE + ((t - c.dayEnd) / (24 * HOUR - dayLen)) * (1 - DAY_SHARE);
}

export const DAY_END_U = DAY_SHARE;
