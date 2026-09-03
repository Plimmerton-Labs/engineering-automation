#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { readFile } from "node:fs/promises";
import process from "node:process";
import { fileURLToPath } from "node:url";
import YAML from "yaml";

const API = "https://api.github.com";
const OWNER = "Plimmerton-Labs";
const PLAYBOOK = "engineering-playbook";
const COMMITTER = {
  name: "Plimmerton Labs AI Agents",
  email: "296834291+plimmerton-labs-ai-agents[bot]@users.noreply.github.com",
};

export function parseProjectConfig(source) {
  const projectType = /^project_type:\s*["']?([^\s"']+)["']?\s*$/m.exec(source)?.[1];
  if (!projectType || !["product", "template", "documentation", "governance"].includes(projectType)) {
    throw new Error("plimmerton-project.yml must set a concrete supported project_type.");
  }
  const stagesBlock = /^stages:\s*\n((?:^[ \t]+-\s*[^\n]+\n?)*)/m.exec(source)?.[1] ?? "";
  const stages = [...stagesBlock.matchAll(/^\s*-\s*([^\s#]+)\s*$/gm)].map((match) => match[1]);
  if (stages.length === 0) throw new Error("plimmerton-project.yml must list at least one stage.");
  const categories = ["labels"];
  if (stages.includes("stage:in-progress") || stages.includes("stage:in-review")) categories.push("issue-lifecycle");
  return { projectType, stages, categories };
}

export function parseRegistry(source) {
  const registry = YAML.parse(source);
  if (registry?.version !== 1 || !Array.isArray(registry.repositories)) {
    throw new Error("Playbook registry must have version: 1 and a repositories array.");
  }
  return registry.repositories;
}

export function appendRegistryEntry(source, entry) {
  const entries = parseRegistry(source);
  const existing = entries.find((candidate) => candidate.name === entry.name);
  if (existing) {
    const existingCategories = [...(existing.categories ?? [])].sort();
    const requestedCategories = [...entry.categories].sort();
    if (JSON.stringify(existingCategories) === JSON.stringify(requestedCategories)) return { source, changed: false };
    throw new Error(`Repository ${entry.name} is already registered with different categories.`);
  }
  const document = YAML.parseDocument(source);
  const repositories = document.get("repositories", true);
  if (!YAML.isSeq(repositories)) throw new Error("Playbook registry repositories must be a sequence.");
  repositories.add(document.createNode(entry));
  return { source: String(document), changed: true };
}

function parseArgs(argv) {
  const args = { dryRun: false };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--repo") args.repo = argv[++i];
    else if (argv[i] === "--dry-run") args.dryRun = true;
    else throw new Error(`Unknown argument: ${argv[i]}`);
  }
  if (!/^Plimmerton-Labs\/[a-z0-9._-]+$/.test(args.repo ?? "")) {
    throw new Error("Use --repo Plimmerton-Labs/REPOSITORY.");
  }
  return args;
}

async function request(token, path, { method = "GET", body, tolerate404 = false } = {}) {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "User-Agent": "plimmerton-repository-registration",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (response.status === 404 && tolerate404) return null;
  const responseBody = await response.json();
  if (!response.ok) throw new Error(`${method} ${path} failed (${response.status}): ${JSON.stringify(responseBody)}`);
  return responseBody;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const token = process.env.PLIMMERTON_AI_AGENT_TOKEN;
  if (!token) throw new Error("Set PLIMMERTON_AI_AGENT_TOKEN using the Engineering Playbook token helper.");
  const repoName = args.repo.split("/")[1];
  const config = parseProjectConfig(await readFile("plimmerton-project.yml", "utf8"));

  const downstream = await request(token, `/repos/${OWNER}/${repoName}`);
  if (downstream.owner?.login !== OWNER || downstream.name !== repoName) throw new Error("Repository ownership validation failed.");

  const registryFile = await request(token, `/repos/${OWNER}/${PLAYBOOK}/contents/policies/repositories.yml?ref=develop`);
  const registry = Buffer.from(registryFile.content.replace(/\n/g, ""), "base64").toString("utf8");
  const result = appendRegistryEntry(registry, { name: repoName, categories: config.categories });
  if (!result.changed) {
    console.log(`${repoName} is already registered with categories: ${config.categories.join(", ")}`);
    return;
  }

  console.log(`Repository: ${args.repo}`);
  console.log(`Project type: ${config.projectType}`);
  console.log(`Categories: ${config.categories.join(", ")}`);
  if (args.dryRun) return;

  const branch = `agent/codex/register-${repoName}`;
  const encodedBranch = encodeURIComponent(branch);
  const existingRef = await request(token, `/repos/${OWNER}/${PLAYBOOK}/git/ref/heads/${encodedBranch}`, { tolerate404: true });
  if (existingRef) {
    const pulls = await request(token, `/repos/${OWNER}/${PLAYBOOK}/pulls?head=${OWNER}:${encodedBranch}&state=open`);
    if (pulls.length > 0) {
      console.log(`Registration PR already open: ${pulls[0].html_url}`);
      return;
    }
    throw new Error(`Registration branch already exists without an open PR: ${branch}`);
  }

  const develop = await request(token, `/repos/${OWNER}/${PLAYBOOK}/git/ref/heads/develop`);
  await request(token, `/repos/${OWNER}/${PLAYBOOK}/git/refs`, {
    method: "POST",
    body: { ref: `refs/heads/${branch}`, sha: develop.object.sha },
  });
  const baseCommit = await request(token, `/repos/${OWNER}/${PLAYBOOK}/git/commits/${develop.object.sha}`);
  const blob = await request(token, `/repos/${OWNER}/${PLAYBOOK}/git/blobs`, {
    method: "POST",
    body: { content: result.source, encoding: "utf-8" },
  });
  const tree = await request(token, `/repos/${OWNER}/${PLAYBOOK}/git/trees`, {
    method: "POST",
    body: { base_tree: baseCommit.tree.sha, tree: [{ path: "policies/repositories.yml", mode: "100644", type: "blob", sha: blob.sha }] },
  });
  const commit = await request(token, `/repos/${OWNER}/${PLAYBOOK}/git/commits`, {
    method: "POST",
    body: {
      message: `Register ${repoName} for playbook drift detection`,
      tree: tree.sha,
      parents: [develop.object.sha],
      author: COMMITTER,
      committer: COMMITTER,
    },
  });
  await request(token, `/repos/${OWNER}/${PLAYBOOK}/git/refs/heads/${encodedBranch}`, {
    method: "PATCH",
    body: { sha: commit.sha, force: false },
  });
  const pull = await request(token, `/repos/${OWNER}/${PLAYBOOK}/pulls`, {
    method: "POST",
    body: {
      title: `Register ${repoName} for playbook drift detection`,
      head: branch,
      base: "develop",
      draft: false,
      body:
        `Registers \`${repoName}\` through the Repository Template enrollment flow.\n\n` +
        `- Project type: \`${config.projectType}\`\n` +
        `- Categories: ${config.categories.map((item) => `\`${item}\``).join(", ")}\n\n` +
        "Merging this reviewed PR enrolls the repository. Run the targeted detector immediately after merge.",
    },
  });
  console.log(`Opened registration PR: ${pull.html_url}`);
}

if (realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1])) {
  main().catch((error) => {
    console.error(error.stack ?? error.message);
    process.exitCode = 1;
  });
}
