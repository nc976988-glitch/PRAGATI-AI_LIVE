# Deploy Pragati AI on Render (free, ~10 minutes)

## 1. Put the code on GitHub
```bash
cd pragati-hackathon
git init && git add . && git commit -m "Pragati AI"
# create an empty repo on github.com, then:
git remote add origin https://github.com/<you>/pragati-ai.git
git branch -M main && git push -u origin main
```
`.gitignore` already keeps `.env` (your key) and `data/` out of git. Never commit your API key.

## 2. Create the service
1. render.com > sign up with GitHub > **New > Blueprint** > select the repo. Render reads `render.yaml`.
   (Manual alternative: New > Web Service, Runtime Node, Build Command `echo ok`, Start Command `node server.js`, Health Check Path `/api/health`.)
2. When asked for `GEMINI_API_KEY`, paste your free key from https://aistudio.google.com/apikey (leave `OPENAI_API_KEY` empty). Click **Apply**.
3. After the build, open the `https://pragati-ai-xxxx.onrender.com` link. The terminal/Logs should show `engine : Gemini · gemini-3.6-flash · live Google Search`.

## 3. Know these before the demo
- **Free instances sleep when idle.** The first visit after a break can take about a minute. Open the link 5 minutes before you present.
- **Data is not permanent on the free plan.** The disk resets on each restart or redeploy, so accounts and notes can disappear. Fine for a demo; use the Demo login. For permanence you need a paid plan with a persistent disk (mount at `/var/data`, set `DATA_DIR=/var/data`).
- **Everyone who clicks "Start talking to Pragati" shares one demo workspace.** Use "Create account" for private spaces.
- HTTPS is automatic, so the microphone and device-lock features work.
- `PRAGATI_SECRET` is generated once so sessions survive restarts.
