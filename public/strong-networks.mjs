// The networks 最強 plays with, by board size. The build fetches each pinned
// file, checks its SHA-256 and publishes it in parts under /models/<key>/,
// since Cloudflare serves files of at most 25 MiB. The page loads one only
// once a game against 最強 on that board starts.
export const STRONG_NETWORKS = Object.freeze({
  // KataGo's 9x9 finetune. Its author advises against other board sizes.
  kata9x9: {
    name: "kata9x9-b18c384nbt-20231025",
    url: "https://github.com/lightvector/KataGo/releases/download/v1.13.2-kata9x9/kata9x9-b18c384nbt-20231025.bin.gz",
    sha256: "a1298ce1adc1dad7bd868ca962b2384cc8388ed373a00e6bae1114fa6f9e2d61",
  },
  // KataGo's main-run b18 network, as Web KaTrain recommends for browsers.
  // The hash is the one Homebrew's katago formula pins for this file.
  b18: {
    name: "kata1-b18c384nbt-s9996604416-d4316597426",
    url: "https://media.katagotraining.org/uploaded/networks/models/kata1/kata1-b18c384nbt-s9996604416-d4316597426.bin.gz",
    sha256: "9d7a6afed8ff5b74894727e156f04f0cd36060a24824892008fbb6e0cba51f1d",
  },
});
export const strongNetworkFor = size => size===9 ? "kata9x9" : "b18";
