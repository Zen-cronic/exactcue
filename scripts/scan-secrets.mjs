import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const files = execFileSync(
  "git",
  ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
  { encoding: "utf8" },
).split("\0").filter(Boolean);
const signatures = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /(?:NETLIFY_AUTH_TOKEN|NETLIFY_TOKEN|API_KEY|API_SECRET)\s*=\s*[^\s<#][^\s]*/,
  /(?:netlify|github|openai)[_-]?(?:token|key)["']?\s*[:=]\s*["'][A-Za-z0-9_-]{20,}/i,
];
const findings = [];

for (const file of files) {
  let content;
  try {
    content = readFileSync(file, "utf8");
  } catch {
    continue;
  }
  if (signatures.some((signature) => signature.test(content))) findings.push(file);
}

if (findings.length) {
  process.stderr.write(`Potential secret material found in: ${findings.join(", ")}\n`);
  process.exit(1);
}
process.stdout.write(`Secret scan passed (${files.length} committable files, no credential signatures).\n`);
