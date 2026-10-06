import express from "express";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

let secilenModel = null;
let secimZamani = 0;
async function chatModeli() {
  if (process.env.CHAT_MODEL) return process.env.CHAT_MODEL;
  if (secilenModel && Date.now() - secimZamani < 3600000) return secilenModel;
  const liste = await fetch("https://api.groq.com/openai/v1/models", {
    headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}` },
  }).then((r) => r.json());
  const adlar = (liste.data || [])
    .map((m) => m.id)
    .filter((id) => !/whisper|tts|guard|embed|playai|orpheus/i.test(id));
  const tercih = ["8b", "20b", "scout", "llama-3.3", "gpt-oss", "qwen"];
  let bulunan = null;
  for (const t of tercih) {
    bulunan = adlar.find((id) => id.includes(t));
    if (bulunan) break;
  }
  secilenModel = bulunan || adlar[0];
  secimZamani = Date.now();
  console.log("MODEL:", secilenModel);
  return secilenModel;
}

const PIPER_DIR = process.env.PIPER_DIR || "/opt/piper";
const SESLER = {
  tr: process.env.PIPER_TR || "/opt/piper/voices/tr_TR-dfki-medium.onnx",
  en: process.env.PIPER_EN || "/opt/piper/voices/en_US-lessac-medium.onnx",
};
function piperSes(metin, dilAdi) {
  return new Promise((coz) => {
    const dil = String(dilAdi || "").toLowerCase().startsWith("tur") ? "tr" : "en";
    const dosya = path.join(os.tmpdir(), "ses-" + Date.now() + "-" + Math.random().toString(36).slice(2) + ".wav");
    let bitti = false;
    const bitir = (v) => {
      if (bitti) return;
      bitti = true;
      clearTimeout(zaman);
      fs.promises.unlink(dosya).catch(() => {});
      coz(v);
    };
    const p = spawn(PIPER_DIR + "/piper", ["--model", SESLER[dil], "--output_file", dosya], {
      cwd: PIPER_DIR,
      env: { ...process.env, LD_LIBRARY_PATH: PIPER_DIR },
    });
    const zaman = setTimeout(() => { p.kill(); bitir(null); }, 20000);
    p.on("error", (e) => { console.error("PIPER:", e.message); bitir(null); });
    p.stdin.on("error", () => {});
    p.stderr.on("data", () => {});
    p.on("close", async (kod) => {
      try {
        if (kod !== 0) throw new Error("cikis kodu " + kod);
        const buf = await fs.promises.readFile(dosya);
        bitir(buf);
      } catch (e) {
        console.error("PIPER:", e.message);
        bitir(null);
      }
    });
    p.stdin.write(String(metin).replace(/\s+/g, " ").trim() + "\n");
    p.stdin.end();
  });
}

const app = express();
app.use(express.static("public"));
app.use("/api/talk", express.raw({ type: "*/*", limit: "10mb" }));

app.post("/api/talk", async (req, res) => {
  try {
    // 1. Sesi yazıya çevir
    const form = new FormData();
    form.append("file", new Blob([req.body], { type: "audio/webm" }), "ses.webm");
    form.append("model", "whisper-large-v3-turbo");
    form.append("response_format", "verbose_json");
    const stt = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}` },
      body: form,
    }).then((r) => r.json());
    console.log("STT:", JSON.stringify(stt));
    const userText = stt.text || "";
    if (!userText) return res.json({ user: "", text: "", audio: "" });

    // 2. Cevap üret
    const chat = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: await chatModeli(),
        messages: [
          {
            role: "system",
            content:
              "Sen sıcakkanlı, samimi bir arkadaşsın. Kullanıcı hangi dilde konuşursa o dilde cevap ver. Cevapların en fazla 2-3 kısa cümle olsun.",
          },
          { role: "user", content: userText },
        ],
      }),
    }).then((r) => r.json());
    console.log("CHAT:", JSON.stringify(chat).slice(0, 300));
    const reply = chat.choices?.[0]?.message?.content || "";

    // 3. Cevabı sese çevir
    const ses = await piperSes(reply, stt.language);
    let audio = "";
    if (ses) audio = ses.toString("base64");

    res.json({ user: userText, text: reply, audio, mime: "audio/wav" });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "hata" });
  }
});

app.listen(process.env.PORT || 3000);
