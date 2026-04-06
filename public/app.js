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

async function setSourceAndMaybePlay(url, forcePlay = false, statusText = "Laen striimi...") {
  if (!url) return;

  const shouldPlay = forcePlay || !player.paused || isPlaying;

  activePlaybackUrl = url;
  player.src = url;
  player.load();

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

async function playInterstitialThenStream(streamUrl) {
  if (!streamUrl) return;

  pendingStreamAfterInterstitial = streamUrl;
  waitingForInterstitialToEnd = true;

  await setSourceAndMaybePlay(
    INTERSTITIAL_MP3_URL,
    true,
    "Mängin vaheklippi..."
  );
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

      const useFallback = shouldUseFallbackStream(data.current);

      if (useFallback) {
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
          await setSourceAndMaybePlay(
            FALLBACK_PLAYBACK_URL,
            false,
            "Vahetan striimi..."
          );
        }
      } else {
        specialModeActive = false;
        interstitialPlayedForCurrentTrigger = false;

        if (!waitingForInterstitialToEnd && defaultPlaybackUrl && activePlaybackUrl !== defaultPlaybackUrl) {
          await setSourceAndMaybePlay(
            defaultPlaybackUrl,
            false,
            "Vahetan striimi..."
          );
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
        await setSourceAndMaybePlay(initialUrl, false, "Laen striimi...");
        return;
      }
    }

    if (player.paused) {
      streamStatus.textContent = waitingForInterstitialToEnd
        ? "Mängin vaheklippi..."
        : "Laen striimi...";
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

    await setSourceAndMaybePlay(nextStream, true, "Laen uut striimi...");
    return;
  }

  setPlayingUI(false);
});

player.addEventListener("waiting", () => {
  streamStatus.textContent = waitingForInterstitialToEnd
    ? "Laen vaheklippi..."
    : "Laen striimi...";
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
setInterval(loadState, 5000);