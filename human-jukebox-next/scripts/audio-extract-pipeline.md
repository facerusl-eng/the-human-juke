# Local Audio Lyric & Chord Extraction Pipeline (Windows)

This guide sets up a free, local pipeline for extracting vocals, lyrics, and chords from your audio files using Spleeter, Whisper, and Chordino.

---

## 1. Install Python (if not already installed)
- Download: https://www.python.org/downloads/
- Add Python to PATH during install.

## 2. Install Spleeter
```
pip install spleeter
```

## 3. Install Whisper (OpenAI)
- Requires Python 3.8+ and FFmpeg.
- Install FFmpeg: https://www.gyan.dev/ffmpeg/builds/ (add to PATH)
- Install Whisper:
```
pip install git+https://github.com/openai/whisper.git
```

## 4. Install Chordino (Vamp Plugin)
- Download Sonic Annotator: https://www.vamp-plugins.org/download.html
- Download Chordino Vamp Plugin: https://www.vamp-plugins.org/plugin-doc/qm-vamp-plugins.html
- Place Chordino DLL in the Vamp plugins folder (see Sonic Annotator docs).

## 5. Example PowerShell Script
Save as `extract-audio.ps1` in your scripts folder:

```powershell
param(
  [string]$audioFile
)

# 1. Separate vocals with Spleeter
spleeter separate -p spleeter:2stems -o output $audioFile

# 2. Transcribe vocals to lyrics with Whisper
$vocals = "output/$(Split-Path -LeafBase $audioFile)/vocals.wav"
whisper $vocals --language English --output_dir output

# 3. Extract chords with Sonic Annotator + Chordino
$fullmix = $audioFile
$chordlab = "output/$(Split-Path -LeafBase $audioFile)_chords.lab"
sonic-annotator -d vamp:qm-vamp-plugins:qm-chordino:chordino -w lab $fullmix -o $chordlab
```

## 6. Usage
```
pwsh scripts/extract-audio.ps1 -audioFile "C:\path\to\song.mp3"
```

---

- Lyrics will be in `output/*.txt` (from Whisper)
- Chords will be in `output/*_chords.lab`
- Separated vocals in `output/<song>/vocals.wav`

---

**You can now wire this pipeline into your app or run it manually for each song.**

For advanced automation or integration, let me know and I’ll generate a Node.js or Python wrapper!