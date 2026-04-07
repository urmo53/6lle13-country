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

const DEFAULT_STREAM_VOLUME = 0.92;
const FALLBACK_STREAM_VOLUME = 1.0;

const INTERSTITIAL_COOLDOWN = 30000; // 30 sekundit

let defaultPlaybackUrl = "";
let activePlaybackUrl = "";
let isPlaying = false;

let specialModeActive = false;
let interstitialPlayedForCurrentTrigger = false;
let switchingWithInterstitial = false;
let interstitialAudio = null;

let latestShouldUseFallback = false;
let lastInterstitialTime = 0;

function fadeVolume(audio, from, to, duration = 1000) {
  return new Promise((resolve) => {
    const steps = 20;
    const stepTime = duration / steps;
    let currentStep = 0;

    audio.volume = from;

    const interval = setInterval(() => {
      currentStep++;
      const progress = currentStep / steps;
      const value = from + (to - from) * progress;

      audio.volume = Math.max(0, Math.min(1, value));

      if (currentStep >= steps) {
        clearInterval(interval);
        audio.volume = to;
        resolve();
      }
    }, stepTime);
  });
}

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

function setPlayingUI(playing, statusText) {
  isPlaying = playing;
  playIcon.textContent = playing ? "❚❚" : "▶";
  visualizer.classList.toggle("playing", playing);
  streamStatus.textContent =
    statusText || (playing ? "Striim mängib" : "Striim peatatud");
}

function stopInterstitial() {
  if (!interstitialAudio) return;

  try {
    interstitialAudio.pause();
    interstitialAudio.src = "";
  } catch (_) {}

  interstitialAudio = null;
}

function getTargetVolume(url) {
  if (!url) return 1;
  return url === defaultPlaybackUrl ? DEFAULT_STREAM_VOLUME : FALLBACK_STREAM_VOLUME;
}

async function playMainStream(url, forcePlay = true) {
  if (!url) return;

  const isSwitching = player.src && player.src !== url;

  if (isSwitching && !player.paused) {
    try {
      await fadeVolume(player, player.volume || 1, 0, 500);
    } catch (_) {}
  }

  activePlaybackUrl = url;

  if (player.src !== url) {
    player.src = url;
    player.load();
  }

  if (!forcePlay) {
    player.volume = getTargetVolume(url);
    return;
  }

  try {
    const targetVolume = getTargetVolume(url);
    player.volume = 0;
    setPlayingUI(true, "Laen striimi...");
    await player.play();
    await fadeVolume(player, 0, targetVolume, 1000);
    setPlayingUI(true, "Striim mängib");
  } catch (_) {
    setPlayingUI(false, "Ei saa striimi laadida");
  }
}

async function playAfterInterstitial() {
  const targetUrl = latestShouldUseFallback
    ? FALLBACK_PLAYBACK_URL
    : defaultPlaybackUrl;

  await playMainStream(targetUrl, true);
}

async function playInterstitialThenSwitch() {
  const now = Date.now();

  if (switchingWithInterstitial) return;

  if (now - lastInterstitialTime < INTERSTITIAL_COOLDOWN) {
    const targetUrl = latestShouldUseFallback
      ? FALLBACK_PLAYBACK_URL
      : defaultPlaybackUrl;

    await playMainStream(targetUrl, true);
    return;
  }

  lastInterstitialTime = now;
  switchingWithInterstitial = true;

  try {
    player.pause();
  } catch (_) {}

  stopInterstitial();

  interstitialAudio = new Audio(INTERSTITIAL_MP3_URL);
  interstitialAudio.preload = "auto";

  interstitialAudio.addEventListener(
    "ended",
    async () => {
      stopInterstitial();
      switchingWithInterstitial = false;
      await playAfterInterstitial();
    },
    { once: true }
  );

  interstitialAudio.addEventListener(
    "error",
    async () => {
      stopInterstitial();
      switchingWithInterstitial = false;
      await playAfterInterstitial();
    },
    { once: true }
  );

  try {
    setPlayingUI(true, "Mängin vaheklippi...");
    await interstitialAudio.play();
  } catch (_) {
    stopInterstitial();
    switchingWithInterstitial = false;
    await playAfterInterstitial();
  }
}

async function switchToNormalStreamIfNeeded() {
  if (!defaultPlaybackUrl) return;
  if (switchingWithInterstitial) return;
  if (activePlaybackUrl === defaultPlaybackUrl) return;

  stopInterstitial();
  await playInterstitialThenSwitch();
}

async function switchToFallbackWithInterstitialIfNeeded() {
  if (switchingWithInterstitial) return;
  if (activePlaybackUrl === FALLBACK_PLAYBACK_URL && !interstitialAudio) return;

  await playInterstitialThenSwitch();
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
      latestShouldUseFallback = useFallback;

      if (useFallback) {
        if (!specialModeActive) {
          specialModeActive = true;
          interstitialPlayedForCurrentTrigger = false;
        }

        if (!interstitialPlayedForCurrentTrigger) {
          interstitialPlayedForCurrentTrigger = true;
          await switchToFallbackWithInterstitialIfNeeded();
        } else if (
          !switchingWithInterstitial &&
          activePlaybackUrl !== FALLBACK_PLAYBACK_URL
        ) {
          await playInterstitialThenSwitch();
        }
      } else {
        specialModeActive = false;
        interstitialPlayedForCurrentTrigger = false;

        if (!switchingWithInterstitial) {
          await switchToNormalStreamIfNeeded();
        }
      }
    } else {
      latestShouldUseFallback = false;
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
  } catch (_) {
    trackTitle.textContent = "Andmete laadimine ebaõnnestus";
    trackArtist.textContent = "";
    mainCover.src = "/pilt.png";
    streamStatus.textContent = "Andmete laadimine ebaõnnestus";
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
        activePlaybackUrl = initialUrl;
        player.volume = getTargetVolume(initialUrl);
        player.load();
      }
    }

    if (player.paused) {
      setPlayingUI(true, "Laen striimi...");
      await player.play();
      player.volume = getTargetVolume(activePlaybackUrl || player.src);
      setPlayingUI(true, "Striim mängib");
    } else {
      player.pause();
      setPlayingUI(false, "Striim peatatud");
    }
  } catch (_) {
    setPlayingUI(false, "Ei saa striimi laadida");
  }
});

player.addEventListener("play", () => {
  if (!switchingWithInterstitial) {
    player.volume = getTargetVolume(activePlaybackUrl || player.src);
    setPlayingUI(true, "Striim mängib");
  }
});

player.addEventListener("playing", () => {
  if (!switchingWithInterstitial) {
    player.volume = getTargetVolume(activePlaybackUrl || player.src);
    setPlayingUI(true, "Striim mängib");
  }
});

player.addEventListener("pause", () => {
  if (!switchingWithInterstitial && !(interstitialAudio && !interstitialAudio.paused)) {
    setPlayingUI(false, "Striim peatatud");
  }
});

player.addEventListener("ended", () => {
  if (!switchingWithInterstitial) {
    setPlayingUI(false, "Striim peatatud");
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
    setPlayingUI(false, "Ei saa striimi laadida");
  }
});

loadState();
setInterval(loadState, 5000);