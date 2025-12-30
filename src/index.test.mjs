import fs from "node:fs";
import { DOMParser } from "xmldom";
import { expect, test } from "vitest";
import {
  findPeakPeriods,
  getAreaPriceData,
  getEuroConversionRates,
  getIntervalMinutes,
  getMessage,
  toPricePoints,
} from "./index.mjs";

test("getAreaPriceData", () => {
  const xml = fs.readFileSync("test/testdata-1.xml", "utf-8");
  const doc = new DOMParser().parseFromString(xml);
  expect(doc).not.toBeUndefined();
  const priceData = getAreaPriceData(doc);
  expect(priceData.length).toBe(87);
  expect(priceData[0].start.getTime()).toBe(
    new Date("2025-12-27T23:00Z").getTime()
  );
  expect(priceData[priceData.length - 1].end.getTime()).toBe(
    new Date("2025-12-28T23:00Z").getTime()
  );
  expect(priceData[0].end.getTime()).toBe(
    new Date("2025-12-27T23:15Z").getTime()
  );
  expect(priceData[1].start.getTime()).toBe(
    new Date("2025-12-27T23:15Z").getTime()
  );
  expect(priceData[1].end.getTime()).toBe(
    new Date("2025-12-28T00:45Z").getTime()
  );
  expect(priceData[1].price).toBe(-0.12);
});

test("getIntervalMinutes", () => {
  const xml = fs.readFileSync("test/testdata-1.xml", "utf-8");
  const doc = new DOMParser().parseFromString(xml);
  expect(getIntervalMinutes(doc)).toBe(15);
});

test("toPricePoints", () => {
  const xml = fs.readFileSync("test/testdata-1.xml", "utf-8");
  const doc = new DOMParser().parseFromString(xml);
  const priceData = getAreaPriceData(doc);
  const pricePoints = toPricePoints(priceData, 15);
  expect(pricePoints.length).toBe(96);
  expect(pricePoints[0].start.getTime()).toBe(
    new Date("2025-12-27T23:00Z").getTime()
  );
  expect(pricePoints[0].end.getTime()).toBe(
    new Date("2025-12-27T23:15Z").getTime()
  );
  expect(pricePoints[3].start.getTime()).toBe(
    new Date("2025-12-27T23:45Z").getTime()
  );
  expect(pricePoints[3].price).toBe(-0.12);
  expect(pricePoints[95].start.getTime()).toBe(
    new Date("2025-12-28T22:45Z").getTime()
  );
  expect(pricePoints[95].end.getTime()).toBe(
    new Date("2025-12-28T23:00Z").getTime()
  );
});

test("getMessage", () => {
  const xml = fs.readFileSync("test/testdata-1.xml", "utf-8");
  const doc = new DOMParser().parseFromString(xml);
  const priceData = getAreaPriceData(doc);
  const pricePoints = toPricePoints(priceData, 15);

  const message = getMessage(pricePoints, 11.03);
  expect(message).toContain("😊");
  expect(message).toContain("12 öre/kWh");
  expect(message).toContain("6 kr");
  expect(message).toContain("Undvik klockan 16-20");
  expect(message).toContain("Föredra klockan 00-15 och 22-24");
});

test("getEuroConversionRates", async () => {
  const rates = await getEuroConversionRates();
  expect(rates).toBeDefined();
  expect(rates.sek).toBeDefined();
  expect(rates.sek).toBeTypeOf("number");
  expect(rates.sek).toBeGreaterThan(5);
  expect(rates.sek).toBeLessThan(15);
});

test("getPeakHours", () => {
  const xml = fs.readFileSync("test/testdata-1.xml", "utf-8");
  const doc = new DOMParser().parseFromString(xml);
  const priceData = getAreaPriceData(doc);
  const pricePoints = toPricePoints(priceData, 15);
  const sekPrices = pricePoints.map(({ price }) => price * 11.03);
  const peakHours = findPeakPeriods(sekPrices);
  expect(peakHours.length).toBe(1);
  expect(peakHours[0].start).toBe(64);
  expect(peakHours[0].end).toBe(82);
});
