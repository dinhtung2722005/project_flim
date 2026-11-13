import { chromium } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
async function main() {
  const browser = await chromium.launch({
    executablePath:
      process.env.PJ_FLIM_CHROME_PATH ??
      "C:/Program Files/Google/Chrome/Application/chrome.exe",
    headless: true,
    args: ["--autoplay-policy=no-user-gesture-required"],
  });
  try {
    const page = await browser.newPage();
    await page.goto("about:blank");
    const data = await page.evaluate(async () => {
      const canvas = document.createElement("canvas");
      canvas.width = 1920;
      canvas.height = 1080;
      const ctx = canvas.getContext("2d")!,
        audio = new AudioContext({ sampleRate: 48000 }),
        dest = audio.createMediaStreamDestination(),
        osc = audio.createOscillator(),
        gain = audio.createGain();
      gain.gain.value = 0.01;
      osc.connect(gain);
      gain.connect(dest);
      osc.start();
      await audio.resume();
      const stream = canvas.captureStream(24);
      dest.stream.getAudioTracks().forEach((t) => stream.addTrack(t));
      const recorder = new MediaRecorder(stream, {
        mimeType: "video/webm;codecs=vp8,opus",
        videoBitsPerSecond: 3000000,
      });
      const chunks: BlobPart[] = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size) chunks.push(e.data);
      };
      const result = new Promise<string>((resolve) => {
        recorder.onstop = () => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result).split(",")[1]);
          reader.readAsDataURL(new Blob(chunks, { type: "video/webm" }));
        };
      });
      let frame = 0;
      const draw = () => {
        ctx.fillStyle = "#182332";
        ctx.fillRect(0, 0, 1920, 1080);
        for (let i = 0; i < 8; i++) {
          ctx.fillStyle = ["#bd392f", "#e3b73b", "#2eab65", "#3189cf"][i % 4];
          ctx.fillRect((frame * 20 + i * 240) % 1920, 160 + i * 70, 200, 70);
        }
        ctx.fillStyle = "white";
        ctx.font = "64px sans-serif";
        ctx.fillText("pj-Flim 1920 x 1080 encoding fixture", 80, 90);
        frame++;
      };
      draw();
      const timer = setInterval(draw, 1000 / 24);
      recorder.start(500);
      await new Promise((r) => setTimeout(r, 8000));
      recorder.stop();
      clearInterval(timer);
      stream.getTracks().forEach((t) => t.stop());
      osc.stop();
      await audio.close();
      return result;
    });
    await mkdir(".local/encoding/full-hd", { recursive: true });
    await writeFile(
      ".local/encoding/full-hd/source.webm",
      Buffer.from(data, "base64"),
    );
    console.log(
      JSON.stringify({
        event: "encoding.fixture.created",
        width: 1920,
        height: 1080,
        synthetic: true,
      }),
    );
  } finally {
    await browser.close();
  }
}
main().catch(() => {
  console.error(JSON.stringify({ event: "encoding.fixture.failed" }));
  process.exitCode = 1;
});
