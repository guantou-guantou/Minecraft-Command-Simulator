import type { World } from './world.ts';

export const DAY_TICKS = 24000;

/** Tick of the day each name stands for (taken from the Bedrock wiki; not verified on the NetEase edition). */
export const TIME_NAMES: Record<string, number> = { day: 1000, noon: 6000, sunset: 12000, night: 13000, midnight: 18000, sunrise: 23000 };

export const daytime = (w: World) => w.time % DAY_TICKS;
export const dayNumber = (w: World) => Math.floor(w.time / DAY_TICKS);

/** Moves the time of day to `value` (0 to 23999) inside the day the world is in now. */
export function setDaytime(w: World, value: number): void {
  w.time = dayNumber(w) * DAY_TICKS + (((value % DAY_TICKS) + DAY_TICKS) % DAY_TICKS);
}

/** 0 ticks is 06:00, as in the game. */
export function clockText(ticks: number): string {
  const minutes = Math.floor((((ticks % DAY_TICKS) / DAY_TICKS) * 24 * 60 + 6 * 60) % (24 * 60));
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

/** One game tick of the world clock and the weather timer. */
export function tickWorld(w: World): void {
  w.gameTime++;
  if (w.gamerules.dodaylightcycle !== false) w.time++;
  if (w.weatherTicks > 0 && --w.weatherTicks === 0) w.weather = 'clear';
}