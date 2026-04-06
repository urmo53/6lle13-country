const player = document.getElementById("player");
const playButton = document.getElementById("playButton");
const playIcon = document.getElementById("playIcon");
const visualizer = document.getElementById("visualizer");
const streamStatus = document.getElementById("streamStatus");

const trackTitle = document.getElementById("trackTitle");
const trackArtist = document.getElementById("trackArtist");
const mainCover = document.getElementById("mainCover");

const previousTitle = document.getElementById("previousTitle");
const previousArtist = document.getElementById("previousArtist");
const previousCover = document.getElementById("previousCover");

const SPECIAL_TEXT = "kantrimuusika kodu";
const FALLBACK_PLAYBACK_URL = "https://www.tuneintoradio1.com:8050/radio.mp3";

let defaultPlaybackUrl = "";
let activePlaybackUrl = "";
let isPlaying = false;

function normalizeText(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function shouldUseFallbackStream(track) {
  const title = normalizeText(track?.title);
  const nowPlaying = normalizeText(track?.nowPlaying);
  return title.includes(SPECIAL_TEXT) || nowPlaying.includes(SPECIAL_TEXT);
}

function setPlayingUI(playing) {
  isPlaying = playing;
  playIcon.textContent = playing ? "❚❚" : "▶";
  visualizer.classList.toggle("playing", playing);
  streamStatus.textContent = playing ? "Striim mängib" : "Striim peatatud";
}

async function switchPlayerSource(nextUrl) {
  if (!nextUrl || nextUrl === activePlaybackUrl) return;

  const wasPlaying = !player.paused;

  activePlaybackUrl = nextUrl;
  player.src = nextUrl;
  player.load();

  if (wasPlaying) {
    try {
      streamStatus.textContent = "Vahetan striimi...";
      await player.play();
    } catch (err) {
      setPlayingUI(false);
      streamStatus.textContent = "Ei saa striimi laadida";
    }
  }
}

async function loadState() {
  try {
    const res = await fetch("/api/state", { cache: "no-store" });
    const data = await res.json();

    if (data.playbackUrl) {
      defaultPlaybackUrl = data.playbackUrl;
    }

    if (data.current) {
      trackTitle.textContent =
        data.current.title || data.current.nowPlaying || "Tundmatu lugu";
      trackArtist.textContent = data.current.artist || "";
      mainCover.src = data.current.imageUrl || "/pilt.png";

      const wantedPlaybackUrl = shouldUseFallbackStream(data.current)
        ? FALLBACK_PLAYBACK_URL
        : defaultPlaybackUrl;

      await switchPlayerSource(wantedPlaybackUrl);
    } else {
      trackTitle.textContent = "Laen...";
      trackArtist.textContent = "";
      mainCover.src = "/pilt.png";
    }

    if (data.previous) {
      previousTitle.textContent =
        data.previous.title || data.previous.nowPlaying || "—";
      previousArtist.textContent = data.previous.artist || "";
      previousCover.src = data.previous.imageUrl || "/pilt.png";
    } else {
      previousTitle.textContent = "—";
      previousArtist.textContent = "";
      previousCover.src = "/pilt.png";
    }

    if (data.error && !data.current) {
      streamStatus.textContent = data.error;
    }
  } catch (err) {
    trackTitle.textContent = "Andmete laadimine ebaõnnestus";
    trackArtist.textContent = "";
    mainCover.src = "/pilt.png";
  }
}

playButton.addEventListener("click", async () => {
  try {
    if (!player.src) {
      const initialUrl = activePlaybackUrl || defaultPlaybackUrl;
      if (initialUrl) {
        player.src = initialUrl;
        activePlaybackUrl = initialUrl;
        player.load();
      }
    }

    if (player.paused) {
      streamStatus.textContent = "Laen striimi...";
      await player.play();
    } else {
      player.pause();
    }
  } catch (err) {
    setPlayingUI(false);
    streamStatus.textContent = "Ei saa striimi laadida";
  }
});

player.addEventListener("play", () => setPlayingUI(true));
player.addEventListener("playing", () => setPlayingUI(true));
player.addEventListener("pause", () => setPlayingUI(false));
player.addEventListener("ended", () => setPlayingUI(false));

player.addEventListener("waiting", () => {
  streamStatus.textContent = "Laen striimi...";
});

player.addEventListener("stalled", () => {
  streamStatus.textContent = "Striim jäi seisma";
});

player.addEventListener("error", () => {
  setPlayingUI(false);
  streamStatus.textContent = "Ei saa striimi laadida";
});

loadState();
setInterval(loadState, 10000);