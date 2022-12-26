import {
  fetchPrices,
  getAreaPriceData,
  getMessage,
  sendStatus,
} from "./src/index.mjs";
import * as dotenv from "dotenv";
import minimist from "minimist";
import { addDays, format } from "date-fns";
import fs from "fs/promises";
import chart from "./src/chart.mjs";
import sharp from "sharp";

const argv = minimist(process.argv.slice(2));

dotenv.config();

const now = new Date();
const costDate = now.getUTCHours() < 13 ? now : addDays(now, 1);

const data = await fetchPrices(process.env.ENTSOE_TOKEN, costDate, argv.area);
const areaPriceData = getAreaPriceData(data);
const message = getMessage(areaPriceData);

if (argv.html) {
  console.log(`
<html>
  <head>
    <meta charset="utf-8" />
    <style>
      body {
        background-color: #111128;
        font-size: 48px;
        color: #525278;
      }
      ul {
        list-style: none;
        margin-top: 25vh;
        text-align: center;
        font-family: sans-serif;
      }
      li {
        line-height: 2;
      }
    </style>
  </head>
  <body>
    <ul>
      ${message
        .split("\n")
        .map((l) => `<li>${l}</li>`)
        .join("\n")}
    </ul>
  </body>
</html>`);
} else {
  console.log(message);
}

const chartName = `${format(costDate, "yyyy-MM-dd")}`;
const chartPng = chartName + ".png";
if (argv.chart || argv.send) {
  const chartSvg = chart(areaPriceData);
  await fs.writeFile(chartName + ".svg", chartSvg);
  sharp(Buffer.from(chartSvg)).toFile(chartPng);
}

if (argv.send) {
  const mastodonConfig = JSON.parse(await fs.readFile("mastodon.json"));
  const accountConfig = mastodonConfig[argv.send];
  if (!accountConfig) {
    throw new Error(`Unknown mastodon config ${argv.send}.`);
  }
  const { accessToken, apiUrl } = accountConfig;

  await sendStatus(message, chartPng, accessToken, apiUrl);
}
