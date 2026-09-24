# Custom Model Builder + Local Models Provider

Add a way to build your own AI models from a Hugging Face-style source folder, store the built model files in `agent/models/`, and use them as a first-class chat provider ("localmodel") with auto-tuned performance so replies stay lightning fast on alt account, terminal, and panel.

## What you get

1. **Model Builder tool** (new panel tab under AI / Providers, plus terminal command):
   - Pick a source folder (a path on your computer, e.g. an unpacked HF repo with `config.json` + weights, or a `.gguf` file, or a folder containing one).
   - Optional model name (defaults to the folder name, slugified).
   - Optional base model override + custom system prompt.
   - Click **Build** — YORU converts / registers the model and writes the runnable artifact into `agent/models/<name>/`.
   - Progress and logs stream into the panel.

2. **`agent/models/` folder** — created automatically by `npm install`. Every built model lands in its own subfolder with:
   - the runnable model file (`.gguf` for llama.cpp, or an Ollama tag reference),
   - a `Modelfile` (regenerable),
   - a `model.json` manifest (name, source path, size bytes, param count if known, quant, built-at, runtime).

3. **New `.env` section — Local Models**:
   ```
   LOCALMODEL_ENABLED=false
   LOCALMODEL_DIR=agent/models          # folder scanned for built models
   LOCALMODEL_ACTIVE=                   # name of the model to use for chat (blank = auto-pick smallest that fits)
   LOCALMODEL_RUNTIME=auto              # auto | ollama | llamacpp
   LOCALMODEL_LATENCY_BUDGET_MS=9000
   LOCALMODEL_MIN_PREDICT=64
   ```
   When `LOCALMODEL_ENABLED=true`, chat prefers the active local model over Ollama defaults. Alt account, terminal REPL, and panel all pick it up automatically.

4. **Auto performance tuning** — on first use of a local model, YORU:
   - Reads file size + detected param count + quant,
   - Compares against detected VRAM/RAM/CPU (same detector `npm install` already uses),
   - Picks `num_ctx`, `num_predict`, `num_batch`, `num_gpu` layers, thread count,
   - Writes them into `model.json` so subsequent boots skip re-tuning,
   - Pre-warms the model into memory on boot (same trick as the current Ollama pre-warm) so the first reply is fast.

5. **Terminal commands**:
   - `/models` — list built models with size, runtime, active flag.
   - `/build <source-path> [name]` — build from source.
   - `/use <name>` — set `LOCALMODEL_ACTIVE` and switch chat to it live.

6. **Alt account owner commands** (behind your OWNER_PREFIX): `!models`, `!use <name>` — same behaviour.

## How the build works (technical)

Runtime auto-detection per source:
- **Folder contains `*.gguf`** → copy/symlink into `agent/models/<name>/model.gguf`, runtime = `llamacpp` if `llama.cpp` is present, else register with Ollama via a generated `Modelfile` (`FROM ./model.gguf`) and `ollama create <name>`.
- **HF safetensors / pytorch folder** (`config.json` + `*.safetensors`) → runtime = `ollama`; generate a `Modelfile` (`FROM <source-path>`) and `ollama create <name> -f Modelfile`. Ollama handles the conversion. If Ollama isn't available, print a clear error with the exact fix (install Ollama or provide a `.gguf`).
- **Single `.gguf` file path** → treated same as folder containing that file.

Chat integration:
- New `src/localmodel-runner.js` (pre-warm + tuning) and `src/providers/localmodel.js` (chat call — reuses the Ollama HTTP path when runtime=ollama; direct llama.cpp server when runtime=llamacpp).
- Provider registered in `src/ai.js` fallback chain: preferred → localmodel (if enabled) → openrouter → ollama → …
- Same short rule-block system prompt used elsewhere for speed.

## Panel UI (Command Center)

- New "Models" card under the AI/Providers view.
- Inputs: source path, name, base override, system prompt.
- Buttons: **Build**, **Refresh list**.
- Table of built models: name · size · runtime · built-at · **Use** / **Delete**.
- Live log stream from the build process.
- Uses the same dark-blue HUD styling as the rest of the redesigned panel.

## Files touched

- `agent/scripts/install.js` — ensure `agent/models/` exists.
- `agent/.env`, `agent/.env.example` — Local Models section.
- `agent/src/config.js` — new `localmodel` config block.
- `agent/src/model-builder.js` (new) — build logic + manifest writer + auto-tuner.
- `agent/src/localmodel-runner.js` (new) — pre-warm + hardware sizing.
- `agent/src/providers/localmodel.js` (new) — chat call.
- `agent/src/ai.js` — insert localmodel into provider chain.
- `agent/src/server.js` — routes: `GET /api/models`, `POST /api/models/build`, `POST /api/models/use`, `DELETE /api/models/:name`, `GET /api/models/build/:id/log`.
- `agent/src/terminal-repl.js` — `/models`, `/build`, `/use`.
- `agent/src/commands/owner.js` — `!models`, `!use`.
- `agent/panel/command.html` + `assets/command.js` + `assets/command.css` — Models card + build log stream.
- `roadmap.md` — mark done.

## Guardrails

- Build never overwrites an existing model without confirmation (panel prompt / `--force` in terminal).
- Source path must exist and be readable; friendly error otherwise.
- If a build fails, `agent/models/<name>/` is cleaned up and the log kept at `agent/models/<name>.build.log`.
- If Ollama isn't running when needed, YORU says exactly what to run.
