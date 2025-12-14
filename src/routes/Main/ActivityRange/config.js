'use strict';

//------------------------------------------------------
const wRealness = Number(0.5);
const wQuality = Number(0.3);
const wAbsence = Number(0.2);
export const weights = {
  realness: Number.isFinite(wRealness) ? wRealness : 0.5,
  quality: Number.isFinite(wQuality) ? wQuality : 0.3,
  absence: Number.isFinite(wAbsence) ? wAbsence : 0.2,
};
//------------------------------------------------------

export const attribution = 'shared'.toString().toLowerCase(); // 'author' | 'shared'
export const NOTES_CONCURRENCY = Math.max(1, 10);
