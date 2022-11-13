import { format } from "date-fns";
import { extent, mean, standardDeviation } from "simple-statistics";
import Masto from "mastodon";
import sv from "date-fns/locale/sv/index.js";
import p from "phin";

const EUR_TO_SEK = 1 / 10.73;

function capitalize(s) {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.substring(1);
}

export default async function bot(area) {
  const priceResponse = await fetchPrices();
  const areaPriceData = getAreaPriceData(priceResponse, area);

  const status = `${capitalize(
    format(new Date(areaPriceData[0].startTime), "EEEE yyyy-MM-dd", {
      locale: sv,
    })
  )}:\n\n${getMessage(areaPriceData)}`;

  sendStatus(status);
}

export async function fetchPrices() {
  const res = await p(
    "https://www.nordpoolgroup.com/api/marketdata/page/10?currency=,,,EUR"
  );

  if (res.statusCode !== 200) {
    throw new Error(`Unexpected HTTP response ${res.statusCode}.`);
  }

  return JSON.parse(res.body);
}

export function sendStatus(status) {
  const M = new Masto({
    access_token: process.env.MASTODON_ACCESS_TOKEN,
    api_url: process.env.MASTODON_API_URL,
  });

  M.post("statuses", { status });
}

export function getAreaPriceData(priceResponse, area) {
  return priceResponse.data.Rows.filter(({ Name: name }) =>
    /[0-9]+&nbsp;-&nbsp;[0-9]+/.exec(name)
  ).map(({ StartTime: startTime, EndTime: endTime, Columns: columns }) => {
    const areaColumn = columns.find(({ Name: name }) => name === area);
    if (!areaColumn) {
      throw new Error(`No column matches area name "${area}".`);
    }
    return {
      startTime,
      endTime,
      price: Number(areaColumn.Value.replace(",", ".")),
    };
  });
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

  if (avg < 20 && peakHours.length === 0 && lowHours === 0) {
    return "🥰 Billigt hela dagen, kör på.";
  } else {
    return [
      `${
        avg < 10
          ? "🥰 Extremt billigt"
          : avg < 20
          ? "😊 Mycket billigt"
          : avg < 40
          ? "🙂 Billigt"
          : avg < 80
          ? "Ok pris"
          : avg < 120
          ? "🙁 Ganska dyrt"
          : avg < 160
          ? "😟 Dyrt"
          : avg < 200
          ? "😞 Mycket dyrt"
          : "😭 Extremt dyrt"
      }, ${avg.toFixed(0)} öre/kWh`,
      "",
      peakHours.length > 0 &&
        `🚫 Undvik ${peakHours.map(periodToHours).join(", ")}`,
      "",
      lowHours.length > 0 &&
        `✅ Föredra ${lowHours.map(periodToHours).join(", ")}`,
      "",
    ]
      .filter((l) => l !== false)
      .join("\n");
  }

  function periodToHours({ start, end }) {
    const a = areaPriceData[start];
    const b = areaPriceData[end];
    return `${format(new Date(a.startTime), "HH")}-${format(
      new Date(b.endTime),
      "HH"
    )}`;
  }
}

function findPeakPeriods(points) {
  const [min] = extent(points);
  const stdDev = standardDeviation(points);
  const hiPeriods = [];
  let currentPeriod;
  for (let i = 0; i < points.length; i++) {
    const pricePoint = points[i];
    if (pricePoint > min + 1.7 * stdDev) {
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

const priceDataToPricePoint = ({ price }) => ((price * EUR_TO_SEK) / 10) * 100;
