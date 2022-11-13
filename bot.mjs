import { fetchPrices, getAreaPriceData, getMessage } from "./src/index.mjs";

const [,, areaName] = process.argv;

const data = await fetchPrices();
const areaPriceData = getAreaPriceData(data, areaName);
console.log(getMessage(areaPriceData));
