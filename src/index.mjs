import { addDays, addHours, format, startOfDay } from "date-fns";
import { extent, mean, standardDeviation } from "simple-statistics";
import Masto from "mastodon";
import sv from "date-fns/locale/sv/index.js";
import p from "phin";
import { DOMParser, XMLSerializer } from "xmldom";

const EUR_TO_SEK = 10.73;

const PRICE_DESCRIPTION = [
  [10, "🥰 Extremt billigt"],
  [20, "😊 Mycket billigt"],
  [40, "🙂 Billigt"],
  [80, "Ok pris"],
  [120, "🙁 Ganska dyrt"],
  [160, "😟 Dyrt"],
  [200, "😞 Mycket dyrt"],
  [Number.MAX_SAFE_INTEGER, "😭 Extremt dyrt"],
];

export function priceDescription(x) {
  let i;
  for (i = 0; x >= PRICE_DESCRIPTION[i][0]; i++);
  return PRICE_DESCRIPTION[i][1];
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

export async function fetchPrices(securityToken, date) {
  const start = startOfDay(date);
  const end = addDays(start, 1);
  const url = `https://web-api.tp.entsoe.eu/api?securityToken=${securityToken}&documentType=A44&in_Domain=10Y1001A1001A46L&out_Domain=10Y1001A1001A46L&periodStart=${format(
    start,
    "yyyyMMddHHmm"
  )}&periodEnd=${format(end, "yyyyMMddHHmm")}`;
  const res = await p(url);

  if (res.statusCode !== 200) {
    throw new Error(`Unexpected HTTP response ${res.statusCode}.`);
  }

  return new DOMParser().parseFromString(res.body.toString());
}

export function sendStatus(status, accessToken, apiUrl) {
  const M = new Masto({
    access_token: accessToken,
    api_url: apiUrl,
  });

  M.post("statuses", { status });
}

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
  const resolution =
    priceResponseDoc.getElementsByTagName("resolution")[0].textContent;

  if (resolution !== "PT60M") {
    throw new Error(`Unexpected resolution "${resolution}".`);
  }

  const pointEls = priceResponseDoc.getElementsByTagName("Point");
  return Array.from(pointEls).map((pointEl, i) => ({
    start: addHours(start, i),
    end: addHours(start, i + 1),
    price: Number(pointEl.getElementsByTagName("price.amount")[0].textContent),
  }));
}

export function getMessage(areaPriceData) {
  if (areaPriceData.length !== 24) {
    throw new Error(`Unexpected time series length: ${areaPriceData.length}`);
  }

  // Recalculate to swedish öre / kWh
  const pricePoints = areaPriceData.map(priceDataToPricePoint);
  const [min, max] = extent(pricePoints);
  const avg = mean(pricePoints);

  const peakHours = findPeakPeriods(pricePoints);
  const lowHours = findPeakPeriods(pricePoints.map((x) => -x));
  const header = `${capitalize(
    format(areaPriceData[0].start, "EEEE yyyy-MM-dd", {
      locale: sv,
    })
  )}:\n\n`;

  if (avg < 20 && peakHours.length === 0 && lowHours === 0) {
    return header + "🥰 Billigt hela dagen, kör på.";
  } else {
    return (
      header +
      [
        `${priceDescription(avg)}, ${avg.toFixed(0)} öre/kWh`,
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
    const a = areaPriceData[start];
    const b = areaPriceData[end];
    return `${format(new Date(a.start), "HH")}-${format(
      new Date(b.end),
      "HH"
    )}`;
  }
}

function findPeakPeriods(points) {
  const [min] = extent(points);
  const avg = mean(points);
  const stdDev = standardDeviation(points);
  const minDiff = Math.max(avg * 0.25, 1.7 * stdDev);
  const hiPeriods = [];
  let currentPeriod;
  for (let i = 0; i < points.length; i++) {
    const pricePoint = points[i];
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

const priceDataToPricePoint = ({ price }) =>
  ((price * EUR_TO_SEK) / 1000) * 100;
