# PRAGATI AI — your personal AI, like JARVIS but family

A ChatGPT / Gemini-style assistant with a futuristic UI that also **does things**: calls, SMS, WhatsApp, opens apps, searches Google and YouTube, and plans your day. It understands **137 languages** (plus Hinglish), works out by itself which language to answer in, has a **hands-free voice mode** with live captions, gives personal advice, and remembers your family.

## Run it (30 seconds, zero dependencies)
```bash
node server.js          # Node 18+, no npm install
# open http://localhost:3000   (PORT=4000 node server.js to change)
```
Click **Start talking to Pragati** (demo workspace), then try the suggestion cards or press **▶ Demo** in the top bar.

### Turn on the full AI brain (free)
1. Get a free Gemini key: https://aistudio.google.com/apikey
2. Copy `.env.example` to `.env` and paste it after `GEMINI_API_KEY=`
3. Restart `node server.js`. The terminal and the top-bar chip show `Gemini · … · live Google Search`.

With Gemini, Pragati answers open questions with **live Google Search and source links**, reads **photos** (homework, diagrams, bills), solves problems step by step, and writes the WhatsApp/SMS messages for you. Groq, OpenAI and Claude also work (see `.env.example`).
Without a key it still works offline. It answers facts from Wikipedia, does maths (including linear and quadratic equations with steps), handles all the device actions, and keeps memory and plans.

## What you can say
| Say / type | What happens |
|---|---|
| `call Mummy` / `mummy ko call karo` | Looks up Mummy in your contacts and opens the phone dialer after a 3-second countdown you can cancel. If the number isn't saved, it asks for it inline. |
| `Papa ko WhatsApp karo ki main late aaunga` | Opens WhatsApp to Papa with the message pre-filled |
| `Didi ko birthday wish karo` | Writes a birthday wish and opens WhatsApp |
| `SMS Rahul I'm outside` | Opens SMS with the text pre-filled |
| `play Kesariya on YouTube` · `search IPL score on Google` | Opens YouTube / Google |
| `open Instagram` · `Zomato kholo` | Opens the app on Android (about 50 apps known: Instagram, Spotify, Swiggy, PhonePe, PW, …), or the website on desktop |
| `navigate to India Gate` · `petrol pump near me` | Opens Google Maps |
| `remember that my exam is on 15 Feb` · `forget that…` | Saves or forgets personal memory, which Pragati uses in its advice |
| `save Bhai's number as 98765 43210` | Saves a contact |
| `Plan my study for 2 hours and remind me at 7 pm` | Shows an approvable plan that creates tasks, notes and reminders |
| Any question: study, coding, health, career, life advice | Streams an answer with markdown, LaTeX maths, code highlighting and sources |

Modes in the composer: **Assistant** (JARVIS-style, personal), **Study** (CBSE/ICSE/state boards, JEE/NEET/UPSC/SSC, college, step by step) and **Web** (fresh facts with sources).

## Hands-free voice mode
Tap **Voice** in the composer (or press **Shift+H**, or say **"Hey Pragati"** once the wake word is on). A full-screen Gemini-Live-style mode opens:
- Pragati listens, answers out loud, and listens again, with **no tapping**. Live captions show what you said and highlight each sentence as it speaks. Tap the orb to interrupt, or say "bye" or "band karo" to close.
- **Type** keeps working inside voice mode; typed messages are still answered out loud.
- **Hands-free texting:** say `Papa ko WhatsApp karo`. Pragati asks "Papa ko kya bolna hai?", you speak the message, and it opens WhatsApp with a 6-second countdown. Say "cancel"/"ruko" to stop it, or "send"/"haan" to go right away.
- **Hands-free calling:** say `call Mummy`. If the number isn't saved, Pragati asks for it, you say the digits, and it saves the contact and dials.
- **Hey Pragati** wake word: switch it on from the voice-mode bar or the Ctrl+K palette. The chip in the top bar shows when it's listening.

## Every language, auto-detected
- **137 languages**, from Hindi, Tamil, Bengali, Marathi, Urdu and the other Indian languages to Spanish, Arabic, Chinese, Japanese, Swahili, Yoruba and more, plus Hinglish (Roman Hindi). See `public/js/lang-core.js`.
- **Auto (the default):** Pragati detects the language of every message from its script and common words, and replies in it. Switch any time by saying "reply in Tamil" or "Japanese mein bolo". Use the 🌐 button to pin one language instead.
- **AI ears:** with a Gemini key (or OpenAI/Groq Whisper), voice is recorded and transcribed by the AI, which understands **any spoken language** and reports which one it was. Without a key, the browser's speech recognition is used for the chosen language.
- Without a key, greetings and Wikipedia answers still come back in your language. With a key, every answer does.

## Honest limits
- **Calls, SMS and WhatsApp open on your phone, pre-filled, and you tap call or send.** A website is not allowed to dial or send silently; that would need a native Android app (it's on the roadmap). Calling works on a phone (or a laptop linked to one).
- Opening apps works best in **Android Chrome**. On iPhone and desktop, Pragati opens the app's website.
- No AI is perfect. Pragati can make mistakes, so double-check important facts (medical, legal, money). Free Gemini keys have daily limits; if you hit one, Pragati falls back to the offline answer.
- Reminders fire while Pragati is open (SSE + optional browser notification).
- **Wake word and browser speech recognition need Chrome or Edge,** and only work while the Pragati tab is open. A web page can't listen in the background.
- **Speaking a language aloud needs that voice installed on the device** (Android/Windows have many). If a voice is missing, Pragati shows the answer as captions instead of speaking it badly.
- Hands-free texting still ends with your tap on **Send** in WhatsApp/SMS, for the same reason as above.

## Also inside
Study AI (your own docs: summary, flashcards, grounded explain), Life manager (board, reminders, notes), Work AI (email, agenda, report), Smart agent (saved workflows), Family & memory, Trust center (scrypt passwords, HMAC sessions, rate limits, a **hash-chained audit ledger**, WebAuthn device lock, export/erase), and the original command console.

## Layout
- `server.js`: HTTP + SSE API.
- `lib/`: the code behind the server.
  - `assistant.js`: chat endpoint and conversations.
  - `llm.js`: Gemini, Claude and OpenAI-compatible streaming.
  - `brain.js`: persona and system prompt.
  - `actions.js`: intent detection for calls, WhatsApp and apps.
  - `knowledge.js`: Wikipedia, calculator and equation solver.
  - Also: engine, NLU, study, auth, store.
- `public/`: ES-module frontend, no build step.
  - `js/view-chat.js`: the chat view.
  - `js/actions.js`: device launcher.
  - `js/handsfree.js`: voice mode, language picker and wake word. `js/ears.js`: recording, voice detection and AI transcription. `js/speech.js`: multilingual text-to-speech. `js/lang-core.js`: 137 languages and detection (shared with the server).
  - `css/theme.css`: the v2 skin.
- `test/api.test.js`: end-to-end test (`npm test`).

See `PITCH.md` for the demo script.
