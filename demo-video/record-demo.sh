#!/bin/bash
# Records the AgentGuard demo synced with voiceover
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
AGENTGUARD_DIR="$(dirname "$SCRIPT_DIR")"
RECORDER="/Users/melted/clawd/scripts/screen-record"
AUDIO_DIR="$SCRIPT_DIR/audio"
FINAL_DIR="$SCRIPT_DIR/final"

# Total voiceover is ~165s, add 5s buffer
RECORD_DURATION=170

echo "🎬 Starting screen recording + demo in 3 seconds..."
echo "   Make sure terminal is clean and visible!"
sleep 3

# Start screen recording in background
"$RECORDER" "$RECORD_DURATION" "$SCRIPT_DIR/segments/screen-capture.mp4" &
RECORD_PID=$!
echo "📹 Recording started (PID: $RECORD_PID)"

# Small delay for recorder to initialize
sleep 1

# Now run the demo with timed pauses to match voiceover
cd "$AGENTGUARD_DIR"

# Clear screen for clean start
clear
echo ""

# Run the demo with --fast (instant output) but we add our own pauses
# Pipe through a script that adds strategic pauses
npx tsx examples/interactive-demo.ts --fast 2>&1

# Let it sit on the final output for a few seconds
sleep 5

# Wait for recording to finish
echo ""
echo "⏳ Waiting for recording to complete..."
wait $RECORD_PID 2>/dev/null || true

echo "✅ Screen recording saved"

# Merge video + audio
echo "🔄 Merging video + voiceover..."
ffmpeg -y \
  -i "$SCRIPT_DIR/segments/screen-capture.mp4" \
  -i "$AUDIO_DIR/full-voiceover.mp3" \
  -c:v libx264 -preset medium -crf 23 \
  -c:a aac -b:a 192k \
  -map 0:v:0 -map 1:a:0 \
  -shortest \
  "$FINAL_DIR/agentguard-demo.mp4" 2>/dev/null

echo "🎉 Done! Final video: $FINAL_DIR/agentguard-demo.mp4"
ls -lh "$FINAL_DIR/agentguard-demo.mp4"
