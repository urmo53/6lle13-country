const debugBox = document.getElementById("debugBox");

function debug(msg) {
  console.log(msg);

  if (!debugBox) return;

  const line = document.createElement("div");
  line.textContent = `${new Date().toLocaleTimeString()} - ${msg}`;
  debugBox.appendChild(line);
  debugBox.scrollTop = debugBox.scrollHeight;
}

debug("APP START");

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
  const match =
    title.includes(SPECIAL_TEXT) || nowPlaying.includes(SPECIAL_TEXT);

  debug(`CHECK SPECIAL: title="${title}" nowPlaying="${nowPlaying}" match=${match}`);
  return match;
}

function setPlayingUI(playing, statusText) {
  isPlaying = playing;
  playIcon.textContent = playing ? "❚❚" : "▶";
  visualizer.classList.toggle("playing", playing);
  streamStatus.textContent = statusText || (playing ? "Striim mängib" : "Striim peatatud");
}

function stopInterstitial() {
  if (!interstitialAudio) return;

  debug("STOP INTERSTITIAL");
  try {
    interstitialAudio.pause();
    interstitialAudio.src = "";
  } catch (e) {
    debug("STOP INTERSTITIAL ERROR");
  }
  interstitialAudio = null;
}

async function playMainStream(url, forcePlay = true) {
  if (!url) {
    debug("NO MAIN STREAM URL");
    return;
  }

  debug(`PLAY MAIN STREAM: ${url} forcePlay=${forcePlay}`);
  activePlaybackUrl = url;

  if (player.src !== url) {
    player.src = url;
    player.load();
    debug("PLAYER SRC SET");
  }

  if (!forcePlay) {
    debug("SKIP AUTO PLAY MAIN STREAM");
    return;
  }

  try {
    setPlayingUI(true, "Laen striimi...");
    await player.play();
    debug("MAIN STREAM PLAY OK");
    setPlayingUI(true, "Striim mängib");
  } catch (err) {
    debug(`MAIN STREAM PLAY ERROR: ${err?.message || err}`);
    setPlayingUI(false, "Ei saa striimi laadida");
  }
}

async function playInterstitialThenFallback() {
  if (switchingWithInterstitial) {
    debug("INTERSTITIAL ALREADY RUNNING");
    return;
  }

  switchingWithInterstitial = true;
  debug("START INTERSTITIAL FLOW");

  try {
    player.pause();
    debug("MAIN PLAYER PAUSED");
  } catch (e) {
    debug("MAIN PLAYER PAUSE ERROR");
  }

  stopInterstitial();

  interstitialAudio = new Audio(INTERSTITIAL_MP3_URL);
  interstitialAudio.preload = "auto";
  interstitialAudio.crossOrigin = "anonymous";

  interstitialAudio.addEventListener("play", () => {
    debug("INTERSTITIAL EVENT: play");
  });

  interstitialAudio.addEventListener("playing", () => {
    debug("INTERSTITIAL EVENT: playing");
    setPlayingUI(true, "Mängin vaheklippi...");
  });

  interstitialAudio.addEventListener("pause", () => {
    debug("INTERSTITIAL EVENT: pause");
  });

  interstitialAudio.addEventListener("ended", async () => {
    debug("INTERSTITIAL EVENT: ended");
    stopInterstitial();
    switchingWithInterstitial = false;
    await playMainStream(FALLBACK_PLAYBACK_URL, true);
  }, { once: true });

  interstitialAudio.addEventListener("error", async () => {
    debug("INTERSTITIAL EVENT: error");
    stopInterstitial();
    switchingWithInterstitial = false;
    await playMainStream(FALLBACK_PLAYBACK_URL, true);
  }, { once: true });

  try {
    setPlayingUI(true, "Mängin vaheklippi...");
    debug(`INTERSTITIAL SRC: ${INTERSTITIAL_MP3_URL}`);
    await interstitialAudio.play();
    debug("INTERSTITIAL PLAY STARTED");
  } catch (err) {
    debug(`INTERSTITIAL PLAY FAIL: ${err?.message || err}`);
    stopInterstitial();
    switchingWithInterstitial = false;
    await playMainStream(FALLBACK_PLAYBACK_URL, true);
  }
}

async function switchToNormalStreamIfNeeded() {
  if (!defaultPlaybackUrl) {
    debug("NO DEFAULT PLAYBACK URL");
    return;
  }

  if (switchingWithInterstitial) {
    debug("SKIP NORMAL SWITCH, INTERSTITIAL RUNNING");
    return;
  }

  if (activePlaybackUrl === defaultPlaybackUrl) {
    debug("ALREADY ON DEFAULT STREAM");
    return;
  }

  debug("SWITCH BACK TO DEFAULT STREAM");
  stopInterstitial();
  await playMainStream(defaultPlaybackUrl, isPlaying);
}

async function switchToFallbackWithInterstitialIfNeeded() {
  if (switchingWithInterstitial) {
    debug("SKIP FALLBACK SWITCH, INTERSTITIAL RUNNING");
    return;
  }

  if (activePlaybackUrl === FALLBACK_PLAYBACK_URL && !interstitialAudio) {
    debug("ALREADY ON FALLBACK STREAM");
    return;
  }

  await playInterstitialThenFallback();
}

async function loadState() {
  debug("FETCH /api/state");

  try {
    const res = await fetch("/api/state", { cache: "no-store" });
    debug(`STATE RESPONSE STATUS: ${res.status}`);

    const data = await res.json();
    debug(`STATE JSON OK: current=${!!data.current} previous=${!!data.previous}`);

    if (data.playbackUrl) {
      defaultPlaybackUrl = data.playbackUrl;
      if (!activePlaybackUrl) {
        activePlaybackUrl = defaultPlaybackUrl;
      }
      debug(`DEFAULT PLAYBACK URL: ${defaultPlaybackUrl}`);
    }

    if (data.current) {
      trackTitle.textContent =
        data.current.title || data.current.nowPlaying || "Tundmatu lugu";
      trackArtist.textContent = data.current.artist || "";
      mainCover.src = data.current.imageUrl || "/pilt.png";

      debug(`CURRENT TRACK: ${data.current.nowPlaying || data.current.title || "?"}`);
      debug(`CURRENT IMAGE: ${data.current.imageUrl || "/pilt.png"}`);

      const useFallback = shouldUseFallbackStream(data.current);

      if (useFallback) {
        if (!specialModeActive) {
          debug("ENTER SPECIAL MODE");
          specialModeActive = true;
          interstitialPlayedForCurrentTrigger = false;
        }

        if (!interstitialPlayedForCurrentTrigger) {
          debug("PLAY INTERSTITIAL FOR CURRENT SPECIAL TRIGGER");
          interstitialPlayedForCurrentTrigger = true;
          await switchToFallbackWithInterstitialIfNeeded();
        } else if (!switchingWithInterstitial && activePlaybackUrl !== FALLBACK_PLAYBACK_URL) {
          debug("SPECIAL MODE ACTIVE, SWITCH DIRECT TO FALLBACK");
          await playMainStream(FALLBACK_PLAYBACK_URL, isPlaying);
        }
      } else {
        if (specialModeActive) {
          debug("EXIT SPECIAL MODE");
        }

        specialModeActive = false;
        interstitialPlayedForCurrentTrigger = false;
        await switchToNormalStreamIfNeeded();
      }
    } else {
      debug("NO CURRENT TRACK");
      trackTitle.textContent = "Laen...";
      trackArtist.textContent = "";
      mainCover.src = "/pilt.png";
    }

    if (data.previous) {
      previousTitle.textContent =
        data.previous.title || data.previous.nowPlaying || "—";
      previousArtist.textContent = data.previous.artist || "";
      previousCover.src = data.previous.imageUrl || "/pilt.png";

      debug(`PREVIOUS TRACK: ${data.previous.nowPlaying || data.previous.title || "?"}`);
    } else {
      previousTitle.textContent = "—";
      previousArtist.textContent = "";
      previousCover.src = "/pilt.png";
      debug("NO PREVIOUS TRACK");
    }

    if (data.error && !data.current) {
      debug(`STATE ERROR: ${data.error}`);
      streamStatus.textContent = data.error;
    }
  } catch (err) {
    debug(`FETCH ERROR: ${err?.message || err}`);
    trackTitle.textContent = "Andmete laadimine ebaõnnestus";
    trackArtist.textContent = "";
    mainCover.src = "/pilt.png";
    streamStatus.textContent = "Andmete laadimine ebaõnnestus";
  }
}

playButton.addEventListener("click", async () => {
  debug("USER CLICK PLAY/PAUSE");

  try {
    if (interstitialAudio && !interstitialAudio.paused) {
      debug("USER STOPPED INTERSTITIAL");
      interstitialAudio.pause();
      stopInterstitial();
      switchingWithInterstitial = false;
      setPlayingUI(false, "Striim peatatud");
      return;
    }

    if (!player.src) {
      const initialUrl = activePlaybackUrl || defaultPlaybackUrl;
      debug(`INIT PLAYER SRC: ${initialUrl || "missing"}`);

      if (initialUrl) {
        player.src = initialUrl;
        activePlaybackUrl = initialUrl;
        player.load();
      }
    }

    if (player.paused) {
      setPlayingUI(true, "Laen striimi...");
      await player.play();
      debug("USER PLAY OK");
      setPlayingUI(true, "Striim mängib");
    } else {
      player.pause();
      debug("USER PAUSE OK");
      setPlayingUI(false, "Striim peatatud");
    }
  } catch (err) {
    debug(`USER PLAY ERROR: ${err?.message || err}`);
    setPlayingUI(false, "Ei saa striimi laadida");
  }
});

player.addEventListener("play", () => {
  debug("PLAYER EVENT: play");
  if (!switchingWithInterstitial) {
    setPlayingUI(true, "Striim mängib");
  }
});

player.addEventListener("playing", () => {
  debug("PLAYER EVENT: playing");
  if (!switchingWithInterstitial) {
    setPlayingUI(true, "Striim mängib");
  }
});

player.addEventListener("pause", () => {
  debug("PLAYER EVENT: pause");
  if (!switchingWithInterstitial && !(interstitialAudio && !interstitialAudio.paused)) {
    setPlayingUI(false, "Striim peatatud");
  }
});

player.addEventListener("ended", () => {
  debug("PLAYER EVENT: ended");
  if (!switchingWithInterstitial) {
    setPlayingUI(false, "Striim peatatud");
  }
});

player.addEventListener("waiting", () => {
  debug("PLAYER EVENT: waiting");
  if (!switchingWithInterstitial) {
    streamStatus.textContent = "Laen striimi...";
  }
});

player.addEventListener("stalled", () => {
  debug("PLAYER EVENT: stalled");
  if (!switchingWithInterstitial) {
    streamStatus.textContent = "Striim jäi seisma";
  }
});

player.addEventListener("error", () => {
  const mediaError = player.error
    ? ` code=${player.error.code} message=${player.error.message || ""}`
    : "";
  debug(`PLAYER EVENT: error${mediaError}`);

  if (!switchingWithInterstitial) {
    setPlayingUI(false, "Ei saa striimi laadida");
  }
});

window.addEventListener("load", () => {
  debug("WINDOW LOAD");
});

loadState();
setInterval(loadState, 5000);