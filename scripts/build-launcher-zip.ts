// Build the launcher zip: the browser build once more with a RELATIVE base
// path, so it runs from any mount point, zipped as play/ + assets/.
//
// The Pages site is built at /shmup-party-ps2/ (vite.config.js) and every
// asset URL in it is absolute, so that build cannot be unpacked anywhere
// else. Launchers install the game under a folder of their own — shmupX /
// the cmg launcher's eShop serves it from /eshop/shmup-party-ps2/ — and a
// build at base "./" resolves everything against its own files instead.
// The deploy publishes the result beside the site, so the launcher's catalog
// can point at https://easierbycode.com/shmup-party-ps2/shmup-party-ps2-web.zip
// and every install is the build the site itself is running.
//
//   deno run --allow-read --allow-write --allow-run --allow-env \
//     scripts/build-launcher-zip.ts [out.zip]     (default dist/shmup-party-ps2-web.zip)
//
// Pure Deno zip writer (deflate through CompressionStream) — nothing to
// install on the runner or on a dev box.

const out = Deno.args[0] ?? "dist/shmup-party-ps2-web.zip";
const stage = "dist-launcher";
const ROOTS = ["play", "assets"];

// 1. the relative-base build. node + vite's own bin: no npx shim to resolve
//    per platform.
const build = new Deno.Command("node", {
  args: ["node_modules/vite/bin/vite.js", "build", "--outDir", stage, "--emptyOutDir"],
  env: { BASE_PATH: "./" },
  stdout: "inherit",
  stderr: "inherit",
}).output();
if ((await build).code !== 0) {
  console.error("[launcher-zip] vite build failed");
  Deno.exit(1);
}

// 2. every file under play/ and assets/, paths relative to the stage dir
interface Entry {
  path: string;
  data: Uint8Array;
}
const entries: Entry[] = [];
async function walk(dir: string, rel: string) {
  const names: string[] = [];
  for await (const e of Deno.readDir(dir)) names.push(e.name);
  names.sort();
  for (const name of names) {
    const full = `${dir}/${name}`;
    const relPath = rel ? `${rel}/${name}` : name;
    const info = await Deno.stat(full);
    if (info.isDirectory) await walk(full, relPath);
    else entries.push({ path: relPath, data: await Deno.readFile(full) });
  }
}
for (const root of ROOTS) await walk(`${stage}/${root}`, root);
if (!entries.some((e) => e.path === "play/index.html")) {
  console.error("[launcher-zip] play/index.html is not in the build");
  Deno.exit(1);
}
// The game's own codemonkey.json (its release status, …) rides at the archive
// root, where the shmupX installer records it with the install — the same
// file the launcher reads off the repo for a game it has not installed yet.
try {
  entries.push({ path: "codemonkey.json", data: await Deno.readFile("codemonkey.json") });
} catch {
  console.warn("[launcher-zip] no codemonkey.json at the repo root — the zip ships without one");
}

// 3. write the zip
const CRC = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC[n] = c >>> 0;
}
function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
async function deflate(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

const now = new Date();
const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();

const parts: Uint8Array[] = [];
const central: Uint8Array[] = [];
let offset = 0;
const enc = new TextEncoder();
let rawTotal = 0;

for (const e of entries) {
  const name = enc.encode(e.path);
  const crc = crc32(e.data);
  const packed = await deflate(e.data);
  // stored when deflate does not pay (PNG, WAV): cheaper for the installer
  const store = packed.length >= e.data.length;
  const body = store ? e.data : packed;
  const method = store ? 0 : 8;
  rawTotal += e.data.length;

  const local = new DataView(new ArrayBuffer(30));
  local.setUint32(0, 0x04034b50, true);
  local.setUint16(4, 20, true);
  local.setUint16(6, 0x0800, true); // UTF-8 names
  local.setUint16(8, method, true);
  local.setUint16(10, dosTime, true);
  local.setUint16(12, dosDate, true);
  local.setUint32(14, crc, true);
  local.setUint32(18, body.length, true);
  local.setUint32(22, e.data.length, true);
  local.setUint16(26, name.length, true);
  local.setUint16(28, 0, true);
  parts.push(new Uint8Array(local.buffer), name, body);

  const cd = new DataView(new ArrayBuffer(46));
  cd.setUint32(0, 0x02014b50, true);
  cd.setUint16(4, 20, true);
  cd.setUint16(6, 20, true);
  cd.setUint16(8, 0x0800, true);
  cd.setUint16(10, method, true);
  cd.setUint16(12, dosTime, true);
  cd.setUint16(14, dosDate, true);
  cd.setUint32(16, crc, true);
  cd.setUint32(20, body.length, true);
  cd.setUint32(24, e.data.length, true);
  cd.setUint16(28, name.length, true);
  cd.setUint16(30, 0, true);
  cd.setUint16(32, 0, true);
  cd.setUint16(34, 0, true);
  cd.setUint16(36, 0, true);
  cd.setUint32(38, 0, true);
  cd.setUint32(42, offset, true);
  central.push(new Uint8Array(cd.buffer), name);

  offset += 30 + name.length + body.length;
}

const cdSize = central.reduce((n, p) => n + p.length, 0);
const eocd = new DataView(new ArrayBuffer(22));
eocd.setUint32(0, 0x06054b50, true);
eocd.setUint16(4, 0, true);
eocd.setUint16(6, 0, true);
eocd.setUint16(8, entries.length, true);
eocd.setUint16(10, entries.length, true);
eocd.setUint32(12, cdSize, true);
eocd.setUint32(16, offset, true);
eocd.setUint16(20, 0, true);

const total = offset + cdSize + 22;
const zip = new Uint8Array(total);
let at = 0;
for (const p of [...parts, ...central, new Uint8Array(eocd.buffer)]) {
  zip.set(p, at);
  at += p.length;
}
const outDir = out.replace(/[\\/][^\\/]*$/, "");
if (outDir && outDir !== out) await Deno.mkdir(outDir, { recursive: true });
await Deno.writeFile(out, zip);
console.log(
  `[launcher-zip] ${entries.length} files, ${(rawTotal / 1048576).toFixed(1)} MB → ${out} (${
    (total / 1048576).toFixed(1)
  } MB)`,
);
