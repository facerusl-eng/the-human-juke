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
