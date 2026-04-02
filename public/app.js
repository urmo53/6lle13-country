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

    if (data.current) {
      trackTitle.textContent = data.current.title || data.current.nowPlaying || "Tundmatu lugu";
      trackArtist.textContent = data.current.artist || "";
      mainCover.src = data.current.imageUrl || "/pilt.png";
    }

    if (data.previous) {
      previousTitle.textContent = data.previous.title || data.previous.nowPlaying || "—";
      previousArtist.textContent = data.previous.artist || "";
      previousCover.src = data.previous.imageUrl || "/pilt.png";
    }

    if (data.error && !data.current) {
      trackTitle.textContent = "Metadata pole saadaval";
      trackArtist.textContent = data.error;
      mainCover.src = "/pilt.png";
    }
  } catch (err) {
    trackTitle.textContent = "Andmete laadimine ebaõnnestus";
    trackArtist.textContent = err.message || String(err);
  }
}

playButton.addEventListener("click", async () => {
  try {
    if (player.paused) {
      await player.play();
      setPlayingUI(true);
    } else {
      player.pause();
      setPlayingUI(false);
    }
  } catch (err) {
    streamStatus.textContent = "Esitust ei saanud käivitada";
  }
});

player.addEventListener("play", () => setPlayingUI(true));
player.addEventListener("pause", () => setPlayingUI(false));
player.addEventListener("ended", () => setPlayingUI(false));
player.addEventListener("waiting", () => {
  if (isPlaying) streamStatus.textContent = "Laen striimi...";
});
player.addEventListener("playing", () => {
  if (isPlaying) streamStatus.textContent = "Striim mängib";
});

loadState();
setInterval(loadState, 12000);