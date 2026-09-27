#!/usr/bin/env bash
# One-command build of "O Lanche".  With ELEVENLABS_API_KEY set, real voices/SFX/music are generated
# (and cached in assets/); without it voices come from free pt-BR neural TTS (voices_free.py)
# and music/SFX from the procedural synth.
set -euo pipefail
cd "$(dirname "$0")"
FF=$(python3 -c "import imageio_ffmpeg as i; print(i.get_ffmpeg_exe())")
if [ -n "${ELEVENLABS_API_KEY:-}" ]; then python3 eleven.py --only voice || echo "voice generation failed; using fallback"
else python3 voices_free.py script.json || echo "free voices unavailable; using babble fallback"; fi
python3 plan.py                                   # timeline.json (uses real voice durations if present)
if [ -n "${ELEVENLABS_API_KEY:-}" ]; then python3 eleven.py --only sfx,music || echo "sfx/music generation failed; using fallback"; fi
rm -rf frames && W=${WORKERS:-4}; N=360; STEP=$(( (N + W - 1) / W ))
for i in $(seq 0 $((W-1))); do s=$((i*STEP)); e=$(( s+STEP < N ? s+STEP : N )); node render.mjs $s $e frames & done; wait
python3 mix.py
"$FF" -loglevel error -y -framerate 24 -i frames/f%04d.jpg -i mix.wav \
  -vf "noise=alls=4:allf=t,vignette=PI/6,format=yuv420p" -c:v libx264 -preset slow -crf 18 \
  -c:a aac -b:a 256k -shortest -movflags +faststart o-lanche-v2.mp4
echo "built o-lanche-v2.mp4"
