const express = require("express");
const axios = require("axios");
const path = require("path");
const puppeteer = require("puppeteer");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, "public")));

const station = {
  name: "Õlle13-Country",
  stream: process.env.STREAM_URL || "https://router.euddn.net/duo/country/playlist.m3u8",
  fallbackImage: process.env.FALLBACK_IMAGE || "/images/pilt.png",
};

const REQUEST_TIMEOUT_MS = Number(process.env.REQUEST_TIMEOUT_MS || 12000);
const PLEIER_URL = "https://duocountry.pleier.ee/";
const RDS_SELECTOR = "div.jsx-2908452177.title.h2 > div";

const artworkCache = new Map();
let browser;
let lastMetadata = {
  station: station.name,
  artist: station.name,
  title: "Hetkel eetris",
  album: "",
  artwork: "",
  rawRds: "",
  updatedAt: new Date().toISOString(),
};

function cleanText(raw) {
  return String(raw || "")
    .replace(/–|—/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanSearchText(raw) {
  return String(raw || "")
    .replace(/–|—/g, "-")
    .replace(/\(.*?\)|\[.*?\]/g, "")
    .replace(/[|–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

function splitArtistTitle(input = "") {
  const raw = cleanText(input);
  if (!raw) return { artist: "", title: "" };

  const separators = [" - ", " – ", " — ", " | "];
  for (const sep of separators) {
    if (raw.includes(sep)) {
      const [artist, ...rest] = raw.split(sep);
      return {
        artist: artist?.trim() || "",
        title: rest.join(sep).trim() || "",
      };
    }
  }

  return { artist: "", title: raw };
}

function getTrackMeta(rawTitle) {
  const cleaned = cleanText(rawTitle);
  const parsed = splitArtistTitle(cleaned);

  return {
    artist: parsed.artist || station.name,
    title: parsed.title || cleaned || "Hetkel eetris",
  };
}

function buildSearchVariants(artist, title) {
  const variants = [];
  const seen = new Set();

  function push(v) {
    const value = cleanSearchText(v);
    if (!value) return;
    const key = value.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    variants.push(value);
  }

  push(`${artist} ${title}`);
  push(`${artist} - ${title}`);
  push(`${title} ${artist}`);

  const primaryArtist = String(artist || "")
    .split(/\s+(?:&|feat\.?|ft\.?|x|,)\s+/i)[0]
    .trim();

  if (primaryArtist && primaryArtist !== artist) {
    push(`${primaryArtist} ${title}`);
    push(`${primaryArtist} - ${title}`);
  }

  return variants;
}

async function searchITunesByVariant(variant) {
  const cacheKey = `itunes:${variant}`;
  if (artworkCache.has(cacheKey)) return artworkCache.get(cacheKey);

  try {
    const res = await axios.get(
      `https://itunes.apple.com/search?term=${encodeURIComponent(variant)}&media=music&entity=song&limit=8`,
      { timeout: REQUEST_TIMEOUT_MS }
    );

    const art =
      res.data?.results?.[0]?.artworkUrl100?.replace(/100x100bb/g, "1200x1200bb") ||
      res.data?.results?.[0]?.artworkUrl100?.replace("100x100", "600x600") ||
      null;

    artworkCache.set(cacheKey, art);
    return art;
  } catch {
    artworkCache.set(cacheKey, null);
    return null;
  }
}

async function searchDeezerByVariant(variant) {
  const cacheKey = `deezer:${variant}`;
  if (artworkCache.has(cacheKey)) return artworkCache.get(cacheKey);

  try {
    const res = await axios.get(
      `https://api.deezer.com/search?q=${encodeURIComponent(variant)}`,
      { timeout: REQUEST_TIMEOUT_MS }
    );

    const art =
      res.data?.data?.[0]?.album?.cover_xl ||
      res.data?.data?.[0]?.album?.cover_big ||
      res.data?.data?.[0]?.album?.cover_medium ||
      null;

    artworkCache.set(cacheKey, art);
    return art;
  } catch {
    artworkCache.set(cacheKey, null);
    return null;
  }
}

async function getArtwork(artist, title, upstreamArtwork) {
  if (upstreamArtwork) return upstreamArtwork;

  if (!artist || !title || title === "Hetkel eetris") {
    return station.fallbackImage;
  }

  const variants = buildSearchVariants(artist, title);

  for (const variant of variants) {
    const art = await searchITunesByVariant(variant);
    if (art) return art;
  }

  for (const variant of variants) {
    const art = await searchDeezerByVariant(variant);
    if (art) return art;
  }

  return station.fallbackImage;
}

async function getBrowser() {
  if (browser) return browser;

  browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  return browser;
}

async function fetchMetadataFromPleier() {
  const browserInstance = await getBrowser();
  const page = await browserInstance.newPage();

  try {
    await page.goto(PLEIER_URL, {
      waitUntil: "domcontentloaded",
      timeout: REQUEST_TIMEOUT_MS,
    });

    await page.waitForSelector(RDS_SELECTOR, {
      timeout: REQUEST_TIMEOUT_MS,
    });

    const rawRds = await page.$eval(RDS_SELECTOR, (el) => el.textContent.trim());

    const parsed = splitArtistTitle(rawRds);

    return {
      station: station.name,
      artist: parsed.artist || station.name,
      title: parsed.title || "Hetkel eetris",
      album: "",
      artwork: "",
      rawRds: rawRds || "",
      updatedAt: new Date().toISOString(),
    };
  } finally {
    await page.close();
  }
}

app.get("/api/station", async (_req, res) => {
  try {
    const metadata = await fetchMetadataFromPleier();
    const meta = getTrackMeta(
      [metadata.artist, metadata.title].filter(Boolean).join(" - ") || metadata.rawRds
    );

    const artwork = await getArtwork(
      metadata.artist || meta.artist,
      metadata.title || meta.title,
      metadata.artwork
    );

    lastMetadata = {
      name: metadata.station || station.name,
      stream: station.stream,
      artist: metadata.artist || meta.artist,
      title: metadata.title || meta.title,
      album: metadata.album || "",
      rawRds: metadata.rawRds || [metadata.artist, metadata.title].filter(Boolean).join(" - "),
      artwork,
      updatedAt: metadata.updatedAt || new Date().toISOString(),
    };

    res.set({
      "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
      Pragma: "no-cache",
      Expires: "0",
      "Surrogate-Control": "no-store",
    });

    res.json(lastMetadata);
  } catch (err) {
    console.log("API error:", err.message);

    res.set({
      "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
      Pragma: "no-cache",
      Expires: "0",
      "Surrogate-Control": "no-store",
    });

    res.status(200).json({
      ...lastMetadata,
      artwork: lastMetadata.artwork || station.fallbackImage,
    });
  }
});

process.on("SIGINT", async () => {
  if (browser) await browser.close();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  if (browser) await browser.close();
  process.exit(0);
});

app.listen(PORT, () => {
  console.log("Server töötab: http://localhost:" + PORT);
});