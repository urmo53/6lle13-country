const express = require("express");
const http = require("http");
const https = require("https");
const path = require("path");
const { URL } = require("url");

const app = express();
const PORT = process.env.PORT || 3000;

// Metadata loeme HTTP MP3 striimist
const METADATA_STREAM_URL =
  "http://router.euddn.net/8103046e16b71d15d692b57c187875c7/dc_duocountry.mp3";

// Mängimiseks kasutame HTTPS AAC striimi
const PLAYBACK_STREAM_URL =
  "https://router.euddn.net/8103046e16b71d15d692b57c187875c7/dc_duocountry.aac";

const PLACEHOLDER_IMAGE = "/pilt.png";
const POLL_INTERVAL_MS = 12000;

app.use(express.static(path.join(__dirname, "public")));

const state = {
  playbackUrl: PLAYBACK_STREAM_URL,
  current: null,
  previous: null,
  lastUpdated: null,
  error: null,
  updating: false,
};

function splitArtistTitle(streamTitle) {
  if (!streamTitle) return { artist: null, title: null };
  if (!streamTitle.includes(" - ")) {
    return { artist: null, title: streamTitle.trim() || null };
  }

  const parts = streamTitle.split(" - ");
  return {
    artist: parts.shift()?.trim() || null,
    title: parts.join(" - ").trim() || null,
  };
}

function parseMetaBuffer(buf) {
  const utf8 = buf.toString("utf8").replace(/\0+$/g, "");
  const latin1 = buf.toString("latin1").replace(/\0+$/g, "");

  const pick = (text) => {
    const match = text.match(/StreamTitle='([^']*)';?/i);
    return match ? match[1]?.trim() || null : null;
  };

  const streamTitle = pick(utf8) || pick(latin1) || null;
  const { artist, title } = splitArtistTitle(streamTitle);

  return {
    nowPlaying: streamTitle,
    artist,
    title,
  };
}

function fetchIcyMetadata(streamUrl, timeoutMs = 15000, redirectsLeft = 5) {
  return new Promise((resolve) => {
    let finished = false;

    const finish = (payload) => {
      if (!finished) {
        finished = true;
        resolve(payload);
      }
    };

    const urlObj = new URL(streamUrl);
    const client = urlObj.protocol === "https:" ? https : http;

    const req = client.get(
      {
        protocol: urlObj.protocol,
        hostname: urlObj.hostname,
        port: urlObj.port || undefined,
        path: urlObj.pathname + urlObj.search,
        headers: {
          "Icy-MetaData": "1",
          "User-Agent": "Mozilla/5.0 Node Metadata Probe",
          "Accept": "*/*",
          "Connection": "close",
        },
      },
      (res) => {
        const status = res.statusCode || 0;

        if (
          [301, 302, 303, 307, 308].includes(status) &&
          res.headers.location &&
          redirectsLeft > 0
        ) {
          const nextUrl = new URL(res.headers.location, streamUrl).toString();
          res.resume();
          return finish(fetchIcyMetadata(nextUrl, timeoutMs, redirectsLeft - 1));
        }

        const headers = res.headers || {};
        const metaint = parseInt(headers["icy-metaint"], 10);

        const baseInfo = {
          ok: true,
          streamUrl,
          name: headers["icy-name"] || "ÕLLE 13 Country",
          genre: headers["icy-genre"] || null,
          bitrate: headers["icy-br"] || null,
          metaint: Number.isFinite(metaint) ? metaint : null,
          nowPlaying: null,
          artist: null,
          title: null,
        };

        if (!Number.isFinite(metaint) || metaint <= 0) {
          res.destroy();
          return finish({
            ...baseInfo,
            ok: false,
            error: "icy-metaint puudub",
          });
        }

        let audioBytesUntilMeta = metaint;
        let awaitingMetaLength = true;
        let metaRemaining = 0;
        let metaChunks = [];

        const timer = setTimeout(() => {
          res.destroy();
          finish({
            ...baseInfo,
            ok: false,
            error: "Metadata timeout",
          });
        }, timeoutMs);

        res.on("data", (chunk) => {
          let offset = 0;

          while (offset < chunk.length) {
            if (audioBytesUntilMeta > 0) {
              const consume = Math.min(audioBytesUntilMeta, chunk.length - offset);
              audioBytesUntilMeta -= consume;
              offset += consume;
              continue;
            }

            if (awaitingMetaLength) {
              const metaLengthBytes = chunk[offset] * 16;
              offset += 1;
              awaitingMetaLength = false;

              if (metaLengthBytes === 0) {
                audioBytesUntilMeta = metaint;
                awaitingMetaLength = true;
              } else {
                metaRemaining = metaLengthBytes;
                metaChunks = [];
              }
              continue;
            }

            if (metaRemaining > 0) {
              const consume = Math.min(metaRemaining, chunk.length - offset);
              metaChunks.push(chunk.subarray(offset, offset + consume));
              metaRemaining -= consume;
              offset += consume;

              if (metaRemaining === 0) {
                clearTimeout(timer);
                const parsed = parseMetaBuffer(Buffer.concat(metaChunks));
                res.destroy();
                return finish({
                  ...baseInfo,
                  ...parsed,
                });
              }
            }
          }
        });

        res.on("end", () => {
          clearTimeout(timer);
          finish({
            ...baseInfo,
            ok: false,
            error: "Stream lõppes enne metadata blokki",
          });
        });

        res.on("error", (err) => {
          clearTimeout(timer);
          finish({
            ...baseInfo,
            ok: false,
            error: err.message || "Stream read error",
          });
        });
      }
    );

    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error("Connection timeout"));
    });

    req.on("error", (err) => {
      finish({
        ok: false,
        streamUrl,
        error: err.message || "Request failed",
      });
    });
  });
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 ÕLLE13 Country",
      "Accept": "application/json, text/plain, */*",
      ...(options.headers || {}),
    },
    ...options,
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  return response.json();
}

function upgradeAppleArtwork(url) {
  if (!url) return null;
  return url.replace(/\/[0-9]+x[0-9]+[a-z0-9-]*\.(jpg|png)$/i, "/600x600bb.jpg");
}

async function findArtwork(artist, title) {
  if (!artist && !title) {
    return { imageUrl: PLACEHOLDER_IMAGE, source: "fallback" };
  }

  const term = encodeURIComponent([artist, title].filter(Boolean).join(" "));
  try {
    const appleUrl = `https://itunes.apple.com/search?term=${term}&media=music&entity=song&limit=1`;
    const apple = await fetchJson(appleUrl);
    const item = Array.isArray(apple.results) ? apple.results[0] : null;
    if (item?.artworkUrl100) {
      return {
        imageUrl: upgradeAppleArtwork(item.artworkUrl100),
        source: "apple",
        link: item.trackViewUrl || item.collectionViewUrl || null,
      };
    }
  } catch {}

  try {
    const deezerQuery = encodeURIComponent([artist, title].filter(Boolean).join(" "));
    const deezerUrl = `https://api.deezer.com/search/track?q=${deezerQuery}&limit=1&output=jsonp`;
    const text = await fetch(deezerUrl, {
      headers: { "User-Agent": "Mozilla/5.0 ÕLLE13 Country" },
    }).then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.text();
    });

    const match = text.match(/\(([\s\S]+)\)\s*;?\s*$/);
    if (match) {
      const data = JSON.parse(match[1]);
      const item = Array.isArray(data.data) ? data.data[0] : null;
      const cover =
        item?.album?.cover_xl ||
        item?.album?.cover_big ||
        item?.album?.cover_medium ||
        item?.album?.cover ||
        null;

      if (cover) {
        return {
          imageUrl: cover,
          source: "deezer",
          link: item?.link || null,
        };
      }
    }
  } catch {}

  return { imageUrl: PLACEHOLDER_IMAGE, source: "fallback" };
}

async function hydrateTrack(meta) {
  if (!meta?.nowPlaying) return null;

  const artwork = await findArtwork(meta.artist, meta.title);

  return {
    nowPlaying: meta.nowPlaying,
    artist: meta.artist,
    title: meta.title,
    imageUrl: artwork.imageUrl || PLACEHOLDER_IMAGE,
    artworkSource: artwork.source || "fallback",
    artworkLink: artwork.link || null,
  };
}

async function updateState() {
  if (state.updating) return state;
  state.updating = true;

  try {
    const meta = await fetchIcyMetadata(METADATA_STREAM_URL);

    if (!meta.ok || !meta.nowPlaying) {
      state.error = meta.error || "Metadata puudub";
      state.lastUpdated = new Date().toISOString();
      return state;
    }

    const currentTrack = await hydrateTrack(meta);

    if (currentTrack?.nowPlaying) {
      const isDifferent = state.current?.nowPlaying !== currentTrack.nowPlaying;
      if (isDifferent && state.current) {
        state.previous = state.current;
      }
      state.current = currentTrack;
    }

    state.error = null;
    state.lastUpdated = new Date().toISOString();
    return state;
  } catch (err) {
    state.error = err.message || "Unknown error";
    state.lastUpdated = new Date().toISOString();
    return state;
  } finally {
    state.updating = false;
  }
}

app.get("/api/state", async (_req, res) => {
  if (!state.current && !state.error) {
    await updateState();
  }
  res.json(state);
});

app.post("/api/refresh", async (_req, res) => {
  await updateState();
  res.json(state);
});

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

setInterval(() => {
  updateState().catch(() => {});
}, POLL_INTERVAL_MS);

updateState().catch(() => {});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});