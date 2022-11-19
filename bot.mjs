import {
  fetchPrices,
  getAreaPriceData,
  getMessage,
  sendStatus,
} from "./src/index.mjs";
import * as dotenv from "dotenv";
import minimist from "minimist";
import { addDays } from "date-fns";

const argv = minimist(process.argv.slice(2));

dotenv.config();

const now = new Date();
const costDate = now.getUTCHours() < 13 ? now : addDays(now, 1);

const data = await fetchPrices(process.env.ENTSOE_TOKEN, costDate);
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

if (argv.send) {
  await sendStatus(
    message,
    process.env.MASTODON_ACCESS_TOKEN,
    process.env.MASTODON_API_URL
  );
}
