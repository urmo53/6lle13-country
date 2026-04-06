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

let specialModeActive = false;
let interstitialPlayedForCurrentTrigger = false;
let switchingWithInterstitial = false;

let interstitialAudio = null;

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

function stopInterstitial() {
  if (interstitialAudio) {
    try {
      interstitialAudio.pause();
      interstitialAudio.src = "";
    } catch (_) {}
    interstitialAudio = null;
  }
}

async function playMainStream(url, forcePlay = false, statusText = "Laen striimi...") {
  if (!url) return;

  const shouldPlay = forcePlay || isPlaying || !player.paused;

  activePlaybackUrl = url;

  if (player.src !== url) {
    player.src = url;
    player.load();
  }

  if (shouldPlay) {
    try {
      streamStatus.textContent = statusText;
      await player.play();
      setPlayingUI(true);
    } catch (err) {
      setPlayingUI(false);
      streamStatus.textContent = "Ei saa striimi laadida";
    }
  }
}

async function playInterstitialThenFallback() {
  if (switchingWithInterstitial) return;

  switchingWithInterstitial = true;

  const shouldResumeAfterJingle = isPlaying || !player.paused;

  try {
    player.pause();
  } catch (_) {}

  stopInterstitial();

  interstitialAudio = new Audio(INTERSTITIAL_MP3_URL);
  interstitialAudio.preload = "auto";
  interstitialAudio.crossOrigin = "anonymous";

  interstitialAudio.addEventListener(
    "ended",
    async () => {
      stopInterstitial();
      switchingWithInterstitial = false;
      await playMainStream(
        FALLBACK_PLAYBACK_URL,
        shouldResumeAfterJingle,
        "Laen uut striimi..."
      );
    },
    { once: true }
  );

  interstitialAudio.addEventListener(
    "error",
    async () => {
      stopInterstitial();
      switchingWithInterstitial = false;
      await playMainStream(
        FALLBACK_PLAYBACK_URL,
        shouldResumeAfterJingle,
        "Laen uut striimi..."
      );
    },
    { once: true }
  );

  try {
    streamStatus.textContent = "Mängin vaheklippi...";
    await interstitialAudio.play();
    setPlayingUI(true);
  } catch (err) {
    stopInterstitial();
    switchingWithInterstitial = false;
    await playMainStream(
      FALLBACK_PLAYBACK_URL,
      shouldResumeAfterJingle,
      "Laen uut striimi..."
    );
  }
}

async function switchToNormalStreamIfNeeded() {
  if (!defaultPlaybackUrl) return;
  if (switchingWithInterstitial) return;
  if (activePlaybackUrl === defaultPlaybackUrl) return;

  stopInterstitial();
  await playMainStream(defaultPlaybackUrl, isPlaying, "Vahetan striimi...");
}

async function switchToFallbackWithInterstitialIfNeeded() {
  if (switchingWithInterstitial) return;
  if (activePlaybackUrl === FALLBACK_PLAYBACK_URL && !interstitialAudio) return;

  await playInterstitialThenFallback();
}

async function loadState() {
  try {
    const res = await fetch("/api/state", { cache: "no-store" });
    const data = await res.json();

    if (data.playbackUrl) {
      defaultPlaybackUrl = data.playbackUrl;
      if (!activePlaybackUrl) {
        activePlaybackUrl = defaultPlaybackUrl;
      }
    }

    if (data.current) {
      trackTitle.textContent =
        data.current.title || data.current.nowPlaying || "Tundmatu lugu";
      trackArtist.textContent = data.current.artist || "";
      mainCover.src = data.current.imageUrl || "/pilt.png";

      const useFallback = shouldUseFallbackStream(data.current);

      if (useFallback) {
        if (!specialModeActive) {
          specialModeActive = true;
          interstitialPlayedForCurrentTrigger = false;
        }

        if (!interstitialPlayedForCurrentTrigger) {
          interstitialPlayedForCurrentTrigger = true;
          await switchToFallbackWithInterstitialIfNeeded();
        } else if (!switchingWithInterstitial && activePlaybackUrl !== FALLBACK_PLAYBACK_URL) {
          await playMainStream(FALLBACK_PLAYBACK_URL, isPlaying, "Vahetan striimi...");
        }
      } else {
        specialModeActive = false;
        interstitialPlayedForCurrentTrigger = false;
        await switchToNormalStreamIfNeeded();
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
    if (interstitialAudio && !interstitialAudio.paused) {
      interstitialAudio.pause();
      stopInterstitial();
      switchingWithInterstitial = false;
      setPlayingUI(false);
      return;
    }

    if (!player.src) {
      const initialUrl = activePlaybackUrl || defaultPlaybackUrl;
      if (initialUrl) {
        player.src = initialUrl;
        player.load();
      }
    }

    if (player.paused) {
      streamStatus.textContent = "Laen striimi...";
      await player.play();
      setPlayingUI(true);
    } else {
      player.pause();
      setPlayingUI(false);
    }
  } catch (err) {
    setPlayingUI(false);
    streamStatus.textContent = "Ei saa striimi laadida";
  }
});

player.addEventListener("play", () => {
  if (!switchingWithInterstitial) {
    setPlayingUI(true);
  }
});

player.addEventListener("playing", () => {
  if (!switchingWithInterstitial) {
    setPlayingUI(true);
  }
});

player.addEventListener("pause", () => {
  if (!switchingWithInterstitial && !(interstitialAudio && !interstitialAudio.paused)) {
    setPlayingUI(false);
  }
});

player.addEventListener("ended", () => {
  if (!switchingWithInterstitial) {
    setPlayingUI(false);
  }
});

player.addEventListener("waiting", () => {
  if (!switchingWithInterstitial) {
    streamStatus.textContent = "Laen striimi...";
  }
});

player.addEventListener("stalled", () => {
  if (!switchingWithInterstitial) {
    streamStatus.textContent = "Striim jäi seisma";
  }
});

player.addEventListener("error", () => {
  if (!switchingWithInterstitial) {
    setPlayingUI(false);
    streamStatus.textContent = "Ei saa striimi laadida";
  }
});

loadState();
setInterval(loadState, 5000);