#!/usr/bin/env node

import { realpathSync } from "node:fs";
import { readFile } from "node:fs/promises";
import process from "node:process";
import { fileURLToPath } from "node:url";

// This manifest is the project-birth snapshot. Ongoing remediation is owned by
// engineering-playbook's current policies/labels.json and
// scripts/sync-policy-category.mjs; do not treat this copied script as inheritance.
const DEFAULT_LABELS_FILE = ".github/labels.json";
const GITHUB_API = "https://api.github.com";

export function normaliseColor(color) {
  return color.replace(/^#/, "").toLowerCase();
}

export function validateLabels(labels) {
  if (!Array.isArray(labels)) {
    throw new Error("Label manifest must be a JSON array.");
  }

  const seen = new Set();
  for (const label of labels) {
    if (!label || typeof label !== "object") {
      throw new Error("Every label entry must be an object.");
    }

    for (const field of ["name", "color", "description"]) {
      if (typeof label[field] !== "string" || label[field].trim() === "") {
        throw new Error(`Label entry is missing a non-empty ${field}.`);
      }
    }

    if (seen.has(label.name)) {
      throw new Error(`Duplicate label in manifest: ${label.name}`);
    }
    seen.add(label.name);

    if (!/^[0-9a-fA-F]{6}$/.test(normaliseColor(label.color))) {
      throw new Error(`Label ${label.name} has invalid color: ${label.color}`);
    }
  }
}

export function planLabelSync(desiredLabels, currentLabels) {
  validateLabels(desiredLabels);

  const currentByName = new Map(
    currentLabels.map((label) => [
      label.name,
      {
        ...label,
        color: normaliseColor(label.color ?? ""),
        description: label.description ?? "",
      },
    ]),
  );

  return desiredLabels.map((desired) => {
    const normalisedDesired = {
      ...desired,
      color: normaliseColor(desired.color),
    };
    const current = currentByName.get(desired.name);

    if (!current) {
      return { action: "create", desired: normalisedDesired };
    }

    const needsUpdate =
      current.color !== normalisedDesired.color ||
      current.description !== normalisedDesired.description;

    return {
      action: needsUpdate ? "update" : "noop",
      desired: normalisedDesired,
      current,
    };
  });
}

function parseArgs(argv) {
  const args = {
    labelsFile: DEFAULT_LABELS_FILE,
    dryRun: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--repo") {
      args.repo = argv[++i];
    } else if (arg === "--labels-file") {
      args.labelsFile = argv[++i];
    } else if (arg === "--current-labels") {
      args.currentLabelsFile = argv[++i];
    } else if (arg === "--dry-run") {
      args.dryRun = true;
    } else if (arg === "--help" || arg === "-h") {
      args.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return args;
}

function printHelp() {
  console.log(`Usage:
  node scripts/sync-labels.mjs --repo OWNER/REPO [--dry-run]
  node scripts/sync-labels.mjs --current-labels labels.json --dry-run

Options:
  --repo OWNER/REPO          GitHub repository to inspect or update.
  --labels-file PATH         Label manifest path. Defaults to ${DEFAULT_LABELS_FILE}.
  --current-labels PATH      Local JSON file containing current labels for offline dry-runs.
  --dry-run                  Print planned create/update operations without mutating GitHub.

Set GH_TOKEN or GITHUB_TOKEN when using --repo.`);
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function githubRequest({ method = "GET", path, token, body }) {
  const response = await fetch(`${GITHUB_API}${path}`, {
    method,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "User-Agent": "plimmerton-label-sync",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`${method} ${path} failed (${response.status}): ${text}`);
  }

  if (response.status === 204) {
    return undefined;
  }

  return response.json();
}

async function fetchCurrentLabels(repo, token) {
  const labels = [];
  let page = 1;

  while (true) {
    const batch = await githubRequest({
      path: `/repos/${repo}/labels?per_page=100&page=${page}`,
      token,
    });
    labels.push(...batch);
    if (batch.length < 100) {
      return labels;
    }
    page += 1;
  }
}

async function applyPlan(repo, token, plan) {
  for (const item of plan) {
    if (item.action === "create") {
      await githubRequest({
        method: "POST",
        path: `/repos/${repo}/labels`,
        token,
        body: item.desired,
      });
    } else if (item.action === "update") {
      await githubRequest({
        method: "PATCH",
        path: `/repos/${repo}/labels/${encodeURIComponent(item.desired.name)}`,
        token,
        body: {
          new_name: item.desired.name,
          color: item.desired.color,
          description: item.desired.description,
        },
      });
    }
  }
}

function printPlan(plan) {
  for (const item of plan) {
    if (item.action === "noop") {
      console.log(`noop   ${item.desired.name}`);
    } else {
      console.log(`${item.action.padEnd(6)} ${item.desired.name}`);
    }
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  const desiredLabels = await readJson(args.labelsFile);
  validateLabels(desiredLabels);

  let currentLabels = [];
  if (args.currentLabelsFile) {
    currentLabels = await readJson(args.currentLabelsFile);
  } else if (args.repo) {
    const token = process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN;
    if (!token) {
      throw new Error("Set GH_TOKEN or GITHUB_TOKEN when using --repo.");
    }
    currentLabels = await fetchCurrentLabels(args.repo, token);
  } else if (!args.dryRun) {
    throw new Error("Use --repo for GitHub sync, or --current-labels with --dry-run.");
  }

  const plan = planLabelSync(desiredLabels, currentLabels);
  printPlan(plan);

  if (!args.dryRun) {
    const token = process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN;
    await applyPlan(args.repo, token, plan);
  }
}

if (realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1])) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
