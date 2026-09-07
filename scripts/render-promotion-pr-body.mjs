#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { renderPromotionPrBody } from "./lib/promotion-impact-core.mjs";

const input = readFileSync(0, "utf8").trim();
if (!input) {
  throw new Error("Expected GitHub compare JSON on stdin");
}

const compare = JSON.parse(input);

process.stdout.write(renderPromotionPrBody(compare));
