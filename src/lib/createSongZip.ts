// Utility to create and download a ZIP file containing audio and lyrics in the browser
// Requires JSZip (https://stuk.github.io/jszip/)

// Usage:
// 1. User selects audio file
// 2. User pastes lyrics
// 3. Call createSongZip(audioFile, lyricsText, songTitle)
// 4. Triggers download of ZIP with both files

import JSZip from 'jszip'

export async function createSongZip(audioFile: File, lyricsText: string, songTitle = 'song') {
  const zip = new JSZip()
  zip.file(`${songTitle}.txt`, lyricsText)
  zip.file(audioFile.name, audioFile)

  const blob = await zip.generateAsync({ type: 'blob' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${songTitle}.zip`
  document.body.appendChild(a)
  a.click()
  setTimeout(() => {
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }, 100)
}
