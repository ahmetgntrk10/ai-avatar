import express from "express";

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

const app = express();
app.use(express.static("public"));
app.use("/api/talk", express.raw({ type: "*/*", limit: "10mb" }));

app.post("/api/talk", async (req, res) => {
  try {
    // 1. Sesi yazıya çevir
    const form = new FormData();
    form.append("file", new Blob([req.body], { type: "audio/webm" }), "ses.webm");
    form.append("model", "whisper-large-v3-turbo");
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
    const tts = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini-tts",
        voice: "alloy",
        input: reply,
      }),
    });
    console.log("TTS:", tts.status, tts.ok ? "tamam" : (await tts.clone().text()).slice(0, 200));
    let audio = "";
    if (tts.ok) audio = Buffer.from(await tts.arrayBuffer()).toString("base64");

    res.json({ user: userText, text: reply, audio });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "hata" });
  }
});

app.listen(process.env.PORT || 3000);
