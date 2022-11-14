import { fetchPrices, getAreaPriceData, getMessage, sendStatus } from "./src/index.mjs";
import * as dotenv from "dotenv";

dotenv.config();

const [, , accessToken, areaName] = process.argv;

const data = await fetchPrices(process.env.ENTSOE_TOKEN);
const areaPriceData = getAreaPriceData(data, areaName);
const message = getMessage(areaPriceData)
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

await sendStatus(message, process.env.MASTODON_ACCESS_TOKEN, process.env.MASTODON_API_URL)

