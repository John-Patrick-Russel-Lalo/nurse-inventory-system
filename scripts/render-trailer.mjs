// Renders trailer/trailer.html to trailer/medisakto-trailer.mp4.
//
// The page exposes window.renderFrame(t) and draws the whole animation from t alone, so nothing
// depends on wall-clock time: frame N is always the same picture. We step t one frame at a time,
// screenshot each one with the installed Chrome, then let the bundled ffmpeg stitch the PNGs into
// an H.264 mp4. If TRAILER_AUDIO points at a music file it is muxed in as the soundtrack.
//
//   node scripts/render-trailer.mjs            # 1280x720, 30 fps, ~30 s
//   TRAILER_FPS=24 node scripts/render-trailer.mjs
//   TRAILER_AUDIO=trailer/music.mp3 node scripts/render-trailer.mjs

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ffmpegPath from "ffmpeg-static";
import puppeteer from "puppeteer-core";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const htmlPath = path.join(root, "trailer", "trailer.html");
const logoPath = path.join(root, "public", "logo-mark.png");
const outPath = path.join(root, "trailer", "medisakto-trailer.mp4");

const WIDTH = 1280;
const HEIGHT = 720;
const FPS = Number(process.env.TRAILER_FPS || 30);
const DURATION = 30; // seconds, must match TOTAL in trailer.html
const FRAMES = Math.round(FPS * DURATION);
const framesDir = path.join(os.tmpdir(), "medisakto-trailer-frames");

function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
    path.join(process.env.LOCALAPPDATA || "", "Google/Chrome/Application/chrome.exe"),
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  ].filter(Boolean);
  const found = candidates.find((p) => existsSync(p));
  if (!found) {
    throw new Error("No Chrome/Edge found. Set CHROME_PATH to a Chromium browser executable.");
  }
  return found;
}

const frameName = (i) => `frame_${String(i).padStart(5, "0")}.png`;

async function main() {
  if (!ffmpegPath) throw new Error("ffmpeg-static did not resolve a binary.");

  const logoData = "data:image/png;base64," + readFileSync(logoPath).toString("base64");
  const html = readFileSync(htmlPath, "utf8").replaceAll("__LOGO_DATA_URI__", logoData);

  rmSync(framesDir, { recursive: true, force: true });
  mkdirSync(framesDir, { recursive: true });

  console.log(`Rendering ${FRAMES} frames at ${WIDTH}x${HEIGHT}, ${FPS} fps...`);
  const browser = await puppeteer.launch({
    executablePath: findChrome(),
    headless: true,
    args: ["--hide-scrollbars", "--force-device-scale-factor=1", "--force-color-profile=srgb", "--no-sandbox"],
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: WIDTH, height: HEIGHT, deviceScaleFactor: 1 });
    await page.setContent(html, { waitUntil: "load", timeout: 30000 });
    await page.evaluate(() => document.fonts.ready);

    for (let i = 0; i < FRAMES; i++) {
      await page.evaluate((t) => window.renderFrame(t), i / FPS);
      await page.screenshot({ path: path.join(framesDir, frameName(i)) });
      if (i % FPS === 0) process.stdout.write(`  ${i}/${FRAMES}\r`);
    }
    process.stdout.write(`  ${FRAMES}/${FRAMES}\n`);
  } finally {
    await browser.close();
  }

  const input = path.join(framesDir, "frame_%05d.png");
  const args = ["-y", "-framerate", String(FPS), "-i", input, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "medium", "-crf", "20", "-movflags", "+faststart"];
  const audio = process.env.TRAILER_AUDIO;
  if (audio) args.push("-i", audio, "-c:a", "aac", "-b:a", "192k", "-shortest");
  args.push(outPath);

  console.log("Encoding with ffmpeg...");
  const res = spawnSync(ffmpegPath, args, { stdio: "inherit" });
  if (res.status !== 0) throw new Error(`ffmpeg exited with code ${res.status}`);

  rmSync(framesDir, { recursive: true, force: true });
  const kb = Math.round(statSync(outPath).size / 1024);
  console.log(`\nDone: ${path.relative(root, outPath)} (${kb} KB)`);
  if (!audio) console.log("No soundtrack (set TRAILER_AUDIO=path/to/music.mp3 to add one).");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
