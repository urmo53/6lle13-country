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
const INTERSTITIAL_MP3_URL = "/vaheklipp.mp3";

let defaultPlaybackUrl = "";
let activePlaybackUrl = "";
let isPlaying = false;
let interstitialPlayedForCurrentTrigger = false;
let waitingForInterstitialToEnd = false;
let pendingStreamAfterInterstitial = "";
let specialModeActive = false;

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

async function playInterstitialThenStream(streamUrl) {
  if (!streamUrl) return;

  const wasPlaying = !player.paused;
  activePlaybackUrl = INTERSTITIAL_MP3_URL;
  pendingStreamAfterInterstitial = streamUrl;
  waitingForInterstitialToEnd = true;

  player.src = INTERSTITIAL_MP3_URL;
  player.load();

  if (wasPlaying) {
    try {
      streamStatus.textContent = "Mängin vaheklippi...";
      await player.play();
    } catch (err) {
      waitingForInterstitialToEnd = false;
      pendingStreamAfterInterstitial = "";
      setPlayingUI(false);
      streamStatus.textContent = "Ei saa vaheklippi laadida";
    }
  }
}

async function switchPlayerSource(nextUrl) {
  if (!nextUrl) return;

  const wasPlaying = !player.paused;

  if (nextUrl === activePlaybackUrl && !waitingForInterstitialToEnd) {
    return;
  }

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

      const shouldUseFallback = shouldUseFallbackStream(data.current);

      if (shouldUseFallback) {
        if (!specialModeActive) {
          specialModeActive = true;
          interstitialPlayedForCurrentTrigger = false;
        }

        if (!interstitialPlayedForCurrentTrigger && !waitingForInterstitialToEnd) {
          interstitialPlayedForCurrentTrigger = true;
          await playInterstitialThenStream(FALLBACK_PLAYBACK_URL);
        } else if (
          !waitingForInterstitialToEnd &&
          activePlaybackUrl !== FALLBACK_PLAYBACK_URL
        ) {
          await switchPlayerSource(FALLBACK_PLAYBACK_URL);
        }
      } else {
        specialModeActive = false;
        interstitialPlayedForCurrentTrigger = false;

        if (!waitingForInterstitialToEnd) {
          await switchPlayerSource(defaultPlaybackUrl);
        }
      }
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
player.addEventListener("pause", () => {
  if (!waitingForInterstitialToEnd) {
    setPlayingUI(false);
  }
});

player.addEventListener("ended", async () => {
  if (waitingForInterstitialToEnd && pendingStreamAfterInterstitial) {
    const nextStream = pendingStreamAfterInterstitial;
    waitingForInterstitialToEnd = false;
    pendingStreamAfterInterstitial = "";
    await switchPlayerSource(nextStream);
    return;
  }

  setPlayingUI(false);
});

player.addEventListener("waiting", () => {
  if (waitingForInterstitialToEnd) {
    streamStatus.textContent = "Laen vaheklippi...";
  } else {
    streamStatus.textContent = "Laen striimi...";
  }
});

player.addEventListener("stalled", () => {
  streamStatus.textContent = "Striim jäi seisma";
});

player.addEventListener("error", () => {
  waitingForInterstitialToEnd = false;
  pendingStreamAfterInterstitial = "";
  setPlayingUI(false);
  streamStatus.textContent = "Ei saa striimi laadida";
});

loadState();
setInterval(loadState, 10000);