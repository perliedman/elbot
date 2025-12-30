import {
  addDays,
  addMinutes,
  format,
  intervalToDuration,
  startOfDay,
} from "date-fns";
import { extent, mean, standardDeviation } from "simple-statistics";
import sv from "date-fns/locale/sv/index.js";
import p from "phin";
import { DOMParser, XMLSerializer } from "xmldom";
import { login } from "masto";
import { createReadStream } from "fs";

const PRICE_DESCRIPTION = [
  [10, "🥰 Extremt billigt"],
  [20, "😊 Mycket billigt"],
  [40, "🙂 Billigt"],
  [80, "Ok pris"],
  [120, "🙁 Ganska dyrt"],
  [160, "😟 Dyrt"],
  [200, "😞 Mycket dyrt"],
  [500, "😭 Extremt dyrt"],
  [Number.MAX_SAFE_INTEGER, "🤯 Katastrofdyrt"],
];

// Energiskatt + elöverföringsavgift
// https://www.eon.se/content/dam/eon-se/swe-documents/swe-prislista-lag-syd-220701.pdf
const PRICE_OVERHEAD_KWH = 45 + 39;

export function priceDescription(x) {
  let i;
  for (i = 0; x >= PRICE_DESCRIPTION[i][0]; i++);
  return PRICE_DESCRIPTION[i][1];
}

export function priceOfShower(pricePerKWh) {
  return (10 / 60) * 25 * (pricePerKWh + PRICE_OVERHEAD_KWH);
}

function capitalize(s) {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.substring(1);
}

function humanList(items) {
  if (items.length === 0) {
    return "";
  } else if (items.length === 1) {
    return items[0];
  } else {
    return (
      items.slice(0, items.length - 1).join(",") +
      " och " +
      items[items.length - 1]
    );
  }
}

const areaToDomain = {
  SE1: "10Y1001A1001A44P",
  SE2: "10Y1001A1001A45N",
  SE3: "10Y1001A1001A46L",
  SE4: "10Y1001A1001A47J",
};

export async function getEuroConversionRates() {
  const res = await p(
    "https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/eur.json"
  );

  if (res.statusCode !== 200) {
    throw new Error(`Unexpected HTTP response ${res.statusCode}.`);
  }

  return JSON.parse(res.body.toString()).eur;
}

export async function fetchPrices(securityToken, date, area) {
  const domain = areaToDomain[area];
  if (!domain) {
    throw new Error(`Unknown area "${area}".`);
  }

  const start = startOfDay(date);
  const end = addDays(start, 1);
  const url = `https://web-api.tp.entsoe.eu/api?securityToken=${securityToken}&documentType=A44&in_Domain=${domain}&out_Domain=${domain}&periodStart=${format(
    start,
    "yyyyMMddHHmm"
  )}&periodEnd=${format(end, "yyyyMMddHHmm")}`;
  const res = await p(url);

  if (res.statusCode !== 200) {
    throw new Error(`Unexpected HTTP response ${res.statusCode}.`);
  }

  return new DOMParser().parseFromString(res.body.toString());
}

export async function sendStatus(status, chartFile, accessToken, apiUrl) {
  const client = await login({ url: apiUrl, accessToken });
  const { id } = await client.mediaAttachments.create({
    file: createReadStream(chartFile),
  });
  await client.statuses.create({ status, mediaIds: [id] });
}

/**
 *
 * @param {Document} priceResponseDoc a parsed XML document from entsoe.eu containing price information for a selected area
 * @returns {{start: Date, end: Date, price: number}[]} parsed price points with start and end times, prices are same currency as input document (EUR) and unit (MWh)
 */
export function getAreaPriceData(priceResponseDoc) {
  const timeEls = priceResponseDoc.getElementsByTagName("timeInterval");

  if (timeEls.length < 1) {
    throw new Error(
      `Could not find timeInterval element in XML: ${new XMLSerializer().serializeToString(
        priceResponseDoc
      )}`
    );
  }

  const timeIntervalEl = timeEls[0];
  const start = new Date(
    timeIntervalEl.getElementsByTagName("start")[0].textContent
  );
  const end = new Date(
    timeIntervalEl.getElementsByTagName("end")[0].textContent
  );
  const resolution =
    priceResponseDoc.getElementsByTagName("resolution")[0].textContent;

  const match = /PT(\d+)M/.exec(resolution);
  if (!match) {
    throw new Error(`Unexpected resolution "${resolution}".`);
  }
  const minuteRes = Number(match[1]);

  const pointEls = priceResponseDoc.getElementsByTagName("Point");
  return Array.from(pointEls).map((pointEl, i) => {
    const startPosition = Number(
      pointEl.getElementsByTagName("position")[0].textContent
    );
    const endPosition =
      i < pointEls.length - 1
        ? Number(
            pointEls[i + 1].getElementsByTagName("position")[0].textContent
          )
        : null;
    return {
      start: addMinutes(start, (startPosition - 1) * minuteRes),
      end:
        endPosition != null
          ? addMinutes(start, (endPosition - 1) * minuteRes)
          : end,
      price: Number(
        pointEl.getElementsByTagName("price.amount")[0].textContent
      ),
    };
  });
}

export function getIntervalMinutes(data) {
  const resolutionEl = data.getElementsByTagName("resolution");
  if (resolutionEl.length !== 1)
    throw new Error(
      `Ambiguous or missing <resolution>, found ${resolutionEl.length}, expected exactly 1.`
    );
  const resolutionDef = resolutionEl[0].textContent;
  const resolutionMatch = /PT(\d+)M/.exec(resolutionDef);
  if (!resolutionMatch)
    throw new Error(
      `Resolution (\"${resolutionDef}\") did not match expected pattern`
    );
  return Number(resolutionMatch[1]);
}

/**
 * Given prices with (possibly) irregular start/end points, creates time points with evenly space points
 * @param {{start:Date, end:Date, price:number}[]} areaPriceData Price points, possibly irregular intervals
 * @param {number} intervalMinutes Output price point interval length in minutes
 * @returns {{start:Date, end:Date, price:number}[]} price points where interval is same for every point
 */
export function toPricePoints(areaPriceData, intervalMinutes) {
  const result = [];
  for (const priceData of areaPriceData) {
    const duration = intervalToDuration(priceData);
    const minutes = duration.hours * 60 + duration.minutes;
    const nIntervals = minutes / intervalMinutes;
    if (nIntervals !== Math.floor(nIntervals))
      throw new Error("Price points use non-matching intervals");
    for (let i = 0; i < nIntervals; i++) {
      result.push({
        start: addMinutes(priceData.start, intervalMinutes * i),
        end: addMinutes(priceData.start, intervalMinutes * (i + 1)),
        price: priceData.price,
      });
    }
  }

  return result;
}

/**
 *
 * @param {{start:Date, end:Date, price:number}[]} pricePoints Price points in EUR/MWh, where all
 * intervals are of the same length (as returned by `toPricePoints`)
 * @returns {string} describing the day's prices
 */
export function getMessage(pricePoints, eurToSek) {
  // Recalculate to swedish öre / kWh
  const sekPrices = pricePoints.map((p) => priceDataToPricePoint(eurToSek, p));
  const avg = mean(sekPrices);

  const peakHours = findPeakPeriods(sekPrices);
  const lowHours = findPeakPeriods(sekPrices.map((x) => -x));
  const header = `${capitalize(
    format(pricePoints[0].start, "EEEE yyyy-MM-dd", {
      locale: sv,
    })
  )}:\n\n`;

  if (avg < 20 && peakHours.length === 0 && lowHours === 0) {
    return header + "🥰 Billigt hela dagen, kör på.";
  } else {
    return (
      header +
      [
        `${priceDescription(avg)}, ${avg.toFixed(0)} öre/kWh (ca ${(
          priceOfShower(avg) / 100
        ).toFixed(0)} kr för en dusch)`,
        "",
        peakHours.length > 0 &&
          `🚫 Undvik klockan ${humanList(peakHours.map(periodToHours))}`,
        "",
        lowHours.length > 0 &&
          `✅ Föredra klockan ${humanList(lowHours.map(periodToHours))}`,
        "",
      ]
        .filter((l) => l !== false)
        .join("\n")
    );
  }

  function periodToHours({ start, end }) {
    const a = pricePoints[start];
    const b = pricePoints[end];
    return `${format(new Date(a.start), "HH")}-${format(
      new Date(b.end),
      "kk"
    )}`;
  }
}

export function findPeakPeriods(points, windowSize = 4) {
  if (!Array.isArray(points) || points.length === 0) return [];

  // Clamp window size
  windowSize = Math.max(1, Math.min(windowSize, points.length));

  // Build rolling average series
  const rolling = new Array(points.length);
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    sum += points[i];
    if (i >= windowSize) {
      sum -= points[i - windowSize];
    }
    const denom = Math.min(windowSize, i + 1);
    rolling[i] = sum / denom;
  }

  // Compute thresholds on the smoothed series
  const [min] = extent(rolling);
  const avg = mean(rolling);
  const stdDev = standardDeviation(rolling);
  const minDiff = Math.max(avg * 0.8, 2 * stdDev);

  const hiPeriods = [];
  let currentPeriod;

  for (let i = 0; i < rolling.length; i++) {
    const pricePoint = rolling[i];
    if (pricePoint > min + minDiff) {
      if (currentPeriod) {
        currentPeriod.end = i;
      } else {
        currentPeriod = { start: i, end: i };
        hiPeriods.push(currentPeriod);
      }
    } else {
      currentPeriod = undefined;
    }
  }

  return hiPeriods;
}

const priceDataToPricePoint = (eurToSek, { price }) =>
  ((price * eurToSek) / 1000) * 100;
