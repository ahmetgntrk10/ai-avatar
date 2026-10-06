import express from "express";

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
        model: process.env.CHAT_MODEL || "llama-3.3-70b-versatile",
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
    if (!tts.ok) throw new Error("Ses üretilemedi");
    const audio = Buffer.from(await tts.arrayBuffer()).toString("base64");

    res.json({ user: userText, text: reply, audio });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "hata" });
  }
});

app.listen(process.env.PORT || 3000);
