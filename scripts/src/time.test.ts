import { test } from "node:test";
import assert from "node:assert/strict";
import { hourEndingToUtcIso, localTimeToUtcIso, marketDate, parseHourEnding } from "./time.js";

// 2026 US DST: spring forward Sun Mar 8, fall back Sun Nov 1.

test("summer (CDT, UTC-5) SCED timestamp", () => {
  assert.equal(localTimeToUtcIso("2026-09-22T14:05:17"), "2026-09-22T19:05:17.000Z");
});

test("winter (CST, UTC-6) SCED timestamp", () => {
  assert.equal(localTimeToUtcIso("2026-01-15T14:05:17"), "2026-01-15T20:05:17.000Z");
});

test("strings with an explicit zone pass through", () => {
  assert.equal(localTimeToUtcIso("2026-09-22T14:05:17Z"), "2026-09-22T14:05:17.000Z");
});

test("hour ending: normal summer and winter hours, all input forms", () => {
  // HE15 = 14:00–15:00 local, ends 15:00 CDT = 20:00Z
  assert.equal(hourEndingToUtcIso("2026-09-22", "15:00"), "2026-09-22T20:00:00.000Z");
  assert.equal(hourEndingToUtcIso("2026-09-22", 15), "2026-09-22T20:00:00.000Z");
  // "H:MM" and "HH:MM" forms agree
  assert.equal(hourEndingToUtcIso("2026-09-22", "1:00"), hourEndingToUtcIso("2026-09-22", "01:00"));
  assert.equal(hourEndingToUtcIso("2026-09-22", "1:00"), "2026-09-22T06:00:00.000Z");
  // Winter: ends 15:00 CST = 21:00Z
  assert.equal(hourEndingToUtcIso("2026-01-15", "15:00"), "2026-01-15T21:00:00.000Z");
});

test("hour ending 24 rolls over to next-day midnight (no T24)", () => {
  assert.equal(hourEndingToUtcIso("2026-09-22", "24:00"), "2026-09-23T05:00:00.000Z");
  assert.equal(hourEndingToUtcIso("2026-09-22", 24), "2026-09-23T05:00:00.000Z");
  assert.equal(hourEndingToUtcIso("2026-01-15", 24), "2026-01-16T06:00:00.000Z");
  // Month/year rollover
  assert.equal(hourEndingToUtcIso("2026-12-31", "24:00"), "2027-01-01T06:00:00.000Z");
});

test("spring forward: missing 02:00 hour", () => {
  // Wall clock 02:30 doesn't exist; it is shifted forward to 03:30 CDT.
  assert.equal(localTimeToUtcIso("2026-03-08T02:30:00"), "2026-03-08T08:30:00.000Z");
  // ERCOT labels the 23-hour day HE1, HE3, HE4... Hours stay contiguous.
  assert.equal(hourEndingToUtcIso("2026-03-08", 1), "2026-03-08T07:00:00.000Z"); // 01:00 CST
  assert.equal(hourEndingToUtcIso("2026-03-08", 3), "2026-03-08T08:00:00.000Z"); // 03:00 CDT
  assert.equal(hourEndingToUtcIso("2026-03-08", 4), "2026-03-08T09:00:00.000Z");
});

test("fall back: repeated 01:00 hour with and without the flag", () => {
  // SCED timestamp in the ambiguous hour
  assert.equal(localTimeToUtcIso("2026-11-01T01:30:00"), "2026-11-01T06:30:00.000Z"); // CDT (first)
  assert.equal(
    localTimeToUtcIso("2026-11-01T01:30:00", { isRepeatHour: true }),
    "2026-11-01T07:30:00.000Z" // CST (second)
  );
  assert.equal(
    localTimeToUtcIso("2026-11-01T01:30:00", { preferLater: true }),
    "2026-11-01T07:30:00.000Z"
  );
  // Flag has no effect outside the ambiguous hour
  assert.equal(
    localTimeToUtcIso("2026-11-01T03:30:00", { isRepeatHour: true }),
    "2026-11-01T09:30:00.000Z"
  );

  // Hour ending: 25-hour day has HE2 twice; the flagged one is the CST hour.
  assert.equal(hourEndingToUtcIso("2026-11-01", 1), "2026-11-01T06:00:00.000Z");
  assert.equal(hourEndingToUtcIso("2026-11-01", "02:00"), "2026-11-01T07:00:00.000Z");
  assert.equal(
    hourEndingToUtcIso("2026-11-01", "02:00", { isRepeatHour: true }),
    "2026-11-01T08:00:00.000Z"
  );
  assert.equal(hourEndingToUtcIso("2026-11-01", 3), "2026-11-01T09:00:00.000Z");
});

test("parseHourEnding rejects junk", () => {
  assert.equal(parseHourEnding("0:00"), null);
  assert.equal(parseHourEnding("25:00"), null);
  assert.equal(parseHourEnding("01:15"), null);
  assert.equal(parseHourEnding(null), null);
  assert.equal(parseHourEnding("7"), 7);
});

test("marketDate uses the Central calendar date", () => {
  // 03:00Z on Sep 23 is still Sep 22 in Texas
  assert.equal(marketDate(new Date("2026-09-23T03:00:00Z")), "2026-09-22");
});
