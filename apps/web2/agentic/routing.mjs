import { readFile } from "node:fs/promises";
import { createWeb2Routing } from "./routing-core.mjs";

const json = async path => JSON.parse(await readFile(new URL(path, import.meta.url), "utf8"));

export async function loadWeb2Routing() {
  const [area, incidents] = await Promise.all([
    json("../../../data/areas/siam.json"), json("../../../data/incidents/bangkok.json"),
  ]);
  return createWeb2Routing(area, incidents);
}
