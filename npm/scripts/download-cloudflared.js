"use strict";

// Downloads the pinned cloudflared release into npm/bin/ so the public-tunnel
// feature works without a separate `brew install cloudflared` step. Mirrors
// download-binary.js in shape (version pin + SHA256 verification + atomic
// place into bin/) but targets a different upstream and uses a JSON manifest
// instead of a goreleaser checksums.txt because cloudflared's GitHub releases
// publish hashes inline in the release notes rather than as a sibling file.
//
// ---------------------------------------------------------------------------
// Integrity contract
// ---------------------------------------------------------------------------
// Both the version tag AND the per-platform SHA256 live in cloudflared.json
// in this directory. The download flow is:
//
//   1. Map (process.platform, process.arch) -> manifest entry. If the
//      current platform isn't listed, exit 0 silently — wuphf core install
//      should still succeed; tunnels will surface a clear error at runtime.
//   2. Fetch the asset from
//      https://github.com/cloudflare/cloudflared/releases/download/<version>/<asset>
//   3. SHA256 the local copy and compare against the manifest hash. Mismatch
//      is FATAL and scrubs the file — same posture as download-binary.js.
//   4. For .tgz assets, extract the inner `cloudflared` binary; for raw
//      (linux + windows) assets, just rename. Place at npm/bin/cloudflared
//      (or .exe on Windows).
//
// Cloudflare's release pipeline publishes the binary and the release-notes
// hashes from the same atomic process, so a tampered asset would have to
// come with a tampered manifest commit in OUR repo to survive — that is a
// weaker guarantee than goreleaser's signed checksums.txt but matches the
// security model of every npm package that bundles a third-party binary.
// ---------------------------------------------------------------------------

const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");

const MANIFEST_PATH = path.join(__dirname, "cloudflared.json");
const RELEASE_BASE_URL =
  "https://github.com/cloudflare/cloudflared/releases/download";

/**
 * Load and parse the pinned cloudflared manifest from the package's manifest file.
 *
 * @returns {Object} The manifest object parsed from MANIFEST_PATH.
 */
function loadManifest() {
  const text = fs.readFileSync(MANIFEST_PATH, "utf8");
  return JSON.parse(text);
}

// Translate Node's process.platform / process.arch into the cloudflared
// manifest key. Returns null when the arch/platform is unrecognised (e.g.
// Linux 386). For known-but-unpublished combinations like Windows ARM64 it
// returns the key ("windows-arm64") so downloadCloudflared() can fall through
// the "no manifest entry" branch — keeping the error surface in the Go
/**
 * Determine the manifest key for the current platform and architecture.
 *
 * Maps process.platform and process.arch to a Go-style "<os>-<arch>" key used by the manifest (for example, "linux-amd64" or "windows-arm64").
 * @returns {string|null} The manifest key when the platform/architecture combination is recognized, or `null` if unsupported.
 */
function detectManifestKey() {
  const osMap = { darwin: "darwin", linux: "linux", win32: "windows" };
  const archMap = { x64: "amd64", arm64: "arm64" };
  const goOs = osMap[process.platform];
  const goArch = archMap[process.arch];
  if (!goOs || !goArch) return null;
  return `${goOs}-${goArch}`;
}

// Target filename inside npm/bin/. Lower-case "cloudflared" matches the
// upstream binary's name; the .exe suffix is mandatory on Windows so
/**
 * Determine the expected installed cloudflared executable filename for the current platform.
 * @return {string} `cloudflared.exe` on Windows, `cloudflared` on other platforms.
 */
function targetBinaryFilename() {
  return process.platform === "win32" ? "cloudflared.exe" : "cloudflared";
}

/**
 * Get the filesystem path to the package's installed cloudflared binary.
 * @returns {string} The absolute path to the target binary located in this package's `bin/` directory.
 */
function targetBinaryPath() {
  return path.join(__dirname, "..", "bin", targetBinaryFilename());
}

/**
 * Download the resource at `url` and write its full response body to `dest`.
 *
 * @param {string} url - The URL to download.
 * @param {string} dest - Filesystem path where the downloaded bytes will be written.
 * @throws {Error} If the HTTP response has a non-ok status; the error message includes the status and URL.
 */
async function fetchToFile(url, dest) {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) {
    throw new Error(
      `Download failed: ${res.status} ${res.statusText} (${url})`,
    );
  }
  const buf = Buffer.from(await res.arrayBuffer());
  await fsp.writeFile(dest, buf);
}

/**
 * Compute the SHA256 digest of a file and return it as a lowercase hex string.
 * @param {string} filePath - Filesystem path to the input file.
 * @returns {string} Lowercase hex-encoded SHA256 digest of the file's contents.
 */
async function sha256OfFile(filePath) {
  const hash = crypto.createHash("sha256");
  const stream = fs.createReadStream(filePath);
  for await (const chunk of stream) {
    hash.update(chunk);
  }
  return hash.digest("hex");
}

// Extract the `cloudflared` binary from a goreleaser-style .tgz into tmpDir.
// Cloudflared's macOS archives contain a single top-level `cloudflared`
/**
 * Extracts a gzip-compressed tar archive into a target directory using the system `tar` command.
 *
 * Synchronously runs a system `tar -xzf` to unpack `archivePath` into `tmpDir`. Controls subprocess
 * stdio: when `silent` is true the subprocess stdio is ignored; otherwise it inherits the parent
 * stdio. Any underlying `tar` or exec error is propagated.
 *
 * @param {string} archivePath - Path to the `.tgz` archive to extract.
 * @param {string} tmpDir - Destination directory where archive contents will be extracted.
 * @param {boolean} silent - If true, suppresses `tar` output by ignoring subprocess stdio.
 * @throws {Error} If invoking `tar` fails or the extraction process exits with a non-zero code.
 */
function extractTgz(archivePath, tmpDir, silent) {
  const stdio = silent ? "ignore" : "inherit";
  execFileSync("tar", ["-xzf", archivePath, "-C", tmpDir], { stdio });
}

/**
 * Download and install the pinned cloudflared release for the current platform when a manifest entry exists.
 *
 * Attempts to download the asset referenced by the local `cloudflared.json` manifest, verifies its SHA256,
 * and installs the resulting binary into this package's bin directory. Writes progress/error messages to
 * stderr unless suppressed.
 *
 * @param {{ silent?: boolean }} [options] - Installation options.
 * @param {boolean} [options.silent=false] - If `true`, suppresses runtime stderr messages.
 * @returns {string|null} The filesystem path to the installed binary when installation occurred, or `null` if
 *                        no bundled asset is available for the current platform/architecture.
 * @throws {Error} If the downloaded asset's SHA256 does not match the expected hash (the downloaded file is deleted
 *                 and installation is aborted).
 */
async function downloadCloudflared({ silent = false } = {}) {
  const manifestKey = detectManifestKey();
  if (!manifestKey) {
    if (!silent) {
      process.stderr.write(
        `wuphf: cloudflared not bundled for ${process.platform}-${process.arch}; ` +
          `the Public Tunnel feature will report it missing at runtime.\n`,
      );
    }
    return null;
  }
  const manifest = loadManifest();
  const entry = manifest.platforms[manifestKey];
  if (!entry) {
    if (!silent) {
      process.stderr.write(
        `wuphf: no cloudflared asset pinned for ${manifestKey}; ` +
          `the Public Tunnel feature will report it missing at runtime.\n`,
      );
    }
    return null;
  }

  const { asset, sha256: expectedHash } = entry;
  const url = `${RELEASE_BASE_URL}/${manifest.version}/${asset}`;
  const target = targetBinaryPath();
  const binDir = path.dirname(target);
  await fsp.mkdir(binDir, { recursive: true });

  const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), "wuphf-cf-"));
  const downloadPath = path.join(tmpDir, asset);

  try {
    if (!silent) {
      process.stderr.write(
        `wuphf: downloading cloudflared ${manifest.version} (${asset})\n`,
      );
    }
    await fetchToFile(url, downloadPath);

    const actualHash = await sha256OfFile(downloadPath);
    if (actualHash.toLowerCase() !== expectedHash.toLowerCase()) {
      await fsp.rm(downloadPath, { force: true });
      throw new Error(
        `SHA256 mismatch for ${asset}.\n` +
          `  expected: ${expectedHash}\n` +
          `  actual:   ${actualHash}\n` +
          `Refusing to install cloudflared. This may indicate a tampered ` +
          `release asset or a corrupted download.`,
      );
    }

    if (asset.endsWith(".tgz")) {
      extractTgz(downloadPath, tmpDir, silent);
      const extracted = path.join(tmpDir, "cloudflared");
      await fsp.copyFile(extracted, target);
    } else {
      // linux + windows assets are already raw binaries.
      await fsp.copyFile(downloadPath, target);
    }

    if (process.platform !== "win32") {
      await fsp.chmod(target, 0o755);
    }

    // macOS 15+ invalidates the upstream ad-hoc signature after copy+chmod
    // and the kernel SIGKILLs an unsigned exec. Re-sign locally so the
    // first `Start tunnel` click does not fail with code-signing errors.
    if (process.platform === "darwin") {
      try {
        execFileSync("codesign", ["--force", "--sign", "-", target], {
          stdio: "ignore",
        });
      } catch {
        // codesign is best-effort.
      }
    }

    if (!silent) {
      process.stderr.write(
        `wuphf: cloudflared ${manifest.version} installed at ${target}\n`,
      );
    }
    return target;
  } finally {
    await fsp.rm(tmpDir, { recursive: true, force: true });
  }
}

module.exports = {
  downloadCloudflared,
  // Exported for tests:
  detectManifestKey,
  loadManifest,
  targetBinaryFilename,
  sha256OfFile,
};
