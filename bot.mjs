import { fetchPrices, getAreaPriceData, getMessage } from "./src/index.mjs";
import data from "./test/data/221113.json" assert { type: "json" };

const [, , areaName] = process.argv;

// const data = await fetchPrices();
const areaPriceData = getAreaPriceData(data, areaName);
console.log(`
<html>
  <head>
    <style>
      body {
        background-color: #111128;
        font-size: 48px;
        color: #48486f;
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
      ${getMessage(areaPriceData)
        .split("\n")
        .map((l) => `<li>${l}</li>`)
        .join("\n")}
    </ul>
  </body>
</html>`);
