// SPDX-License-Identifier: MIT
/** SCORM time formats. */

/** SCORM 1.2 CMITimespan: HHHH:MM:SS.SS (hours 2–4 digits). */
export function formatScorm12Time(totalSeconds: number): string {
  const centis = Math.max(0, Math.round(totalSeconds * 100));
  const hours = Math.min(9999, Math.floor(centis / 360000));
  const minutes = Math.floor((centis % 360000) / 6000);
  const seconds = (centis % 6000) / 100;
  const pad = (n: number, len: number) => String(n).padStart(len, '0');
  const [whole, frac = '0'] = seconds.toFixed(2).split('.');
  return `${pad(hours, 2)}:${pad(minutes, 2)}:${pad(Number(whole), 2)}.${frac}`;
}

/** SCORM 2004 timeinterval (ISO 8601 duration), e.g. "PT1H2M3.45S". */
export function formatIsoDuration(totalSeconds: number): string {
  const centis = Math.max(0, Math.round(totalSeconds * 100));
  const hours = Math.floor(centis / 360000);
  const minutes = Math.floor((centis % 360000) / 6000);
  const seconds = (centis % 6000) / 100;
  let out = 'PT';
  if (hours) out += `${hours}H`;
  if (minutes) out += `${minutes}M`;
  out += `${Number(seconds.toFixed(2))}S`;
  return out;
}
