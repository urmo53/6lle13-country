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

let isPlaying = false;

function setPlayingUI(playing) {
  isPlaying = playing;
  playIcon.textContent = playing ? "❚❚" : "▶";
  visualizer.classList.toggle("playing", playing);
  streamStatus.textContent = playing ? "Striim mängib" : "Striim peatatud";
}

async function loadState() {
  try {
    const res = await fetch("/api/state");
    const data = await res.json();

    if (data.playbackUrl && !player.src) {
      player.src = data.playbackUrl;
    }

    if (data.current) {
      trackTitle.textContent =
        data.current.title || data.current.nowPlaying || "Tundmatu lugu";
      trackArtist.textContent = data.current.artist || "";
    } else {
      trackTitle.textContent = "Lugu puudub";
      trackArtist.textContent = "";
    }

    if (data.previous) {
      previousTitle.textContent =
        data.previous.title || data.previous.nowPlaying || "—";
      previousArtist.textContent = data.previous.artist || "";
    } else {
      previousTitle.textContent = "—";
      previousArtist.textContent = "";
    }

    if (!mainCover.getAttribute("src")) {
      mainCover.src = "/pilt.png";
    }
    if (!previousCover.getAttribute("src")) {
      previousCover.src = "/pilt.png";
    }
  } catch (err) {
    trackTitle.textContent = "Andmete laadimine ebaõnnestus";
    trackArtist.textContent = "";
  }
}

playButton.addEventListener("click", async () => {
  try {
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
  if (isPlaying) {
    streamStatus.textContent = "Laen striimi...";
  }
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