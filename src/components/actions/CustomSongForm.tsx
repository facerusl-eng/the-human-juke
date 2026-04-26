import { useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { supabase } from '../../lib/supabase'
import type { CustomSong } from './CustomSongList'

const MAX_CUSTOM_SONG_TITLE_LENGTH = 120
const MAX_CUSTOM_SONG_ARTIST_LENGTH = 120
const MAX_CUSTOM_SONG_COVER_BYTES = 5 * 1024 * 1024

function hasUnsafeControlChars(value: string) {
  for (let index = 0; index < value.length; index += 1) {
    const charCode = value.charCodeAt(index)

    if ((charCode >= 0 && charCode <= 8) || (charCode >= 11 && charCode <= 12) || (charCode >= 14 && charCode <= 31) || charCode === 127) {
      return true
    }
  }

  return false
}

function resolveCoverFileExtension(contentType: string, originalName: string) {
  if (contentType === 'image/png') {
    return 'png'
  }

  if (contentType === 'image/jpeg') {
    return 'jpg'
  }

  const normalizedName = originalName.toLowerCase()

  if (normalizedName.endsWith('.png')) {
    return 'png'
  }

  return 'jpg'
}

function isAcceptedCoverFile(file: File) {
  const normalizedType = file.type.toLowerCase()
  const normalizedName = file.name.toLowerCase()

  if (['image/jpeg', 'image/jpg', 'image/png'].includes(normalizedType)) {
    return true
  }

  return normalizedName.endsWith('.jpg') || normalizedName.endsWith('.jpeg') || normalizedName.endsWith('.png')
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()

    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result)
        return
      }

      reject(new Error('Could not process that image.'))
    }

    reader.onerror = () => {
      reject(new Error('Could not read that image file.'))
    }

    reader.readAsDataURL(file)
  })
}

function getSupabaseErrorMessage(error: unknown, fallbackMessage: string) {
  if (error instanceof Error && error.message.trim()) {
    return error.message
  }

  if (error && typeof error === 'object') {
    const normalizedError = error as {
      message?: unknown
      details?: unknown
      hint?: unknown
      code?: unknown
    }

    const pieces = [normalizedError.message, normalizedError.details, normalizedError.hint]
      .map((value) => (typeof value === 'string' ? value.trim() : ''))
      .filter(Boolean)

    if (pieces.length > 0) {
      return pieces.join(' - ')
    }

    if (typeof normalizedError.code === 'string' && normalizedError.code.trim()) {
      return `Request failed (${normalizedError.code.trim()}).`
    }
  }

  return fallbackMessage
}

type CustomSongFormProps = {
  userId: string
  onSavedSong: (song: CustomSong) => void
  onStatus: (message: string, tone: 'success' | 'error') => void
}

function CustomSongForm({ userId, onSavedSong, onStatus }: CustomSongFormProps) {
  const [title, setTitle] = useState('')
  const [artist, setArtist] = useState('')
  const [coverUrl, setCoverUrl] = useState<string | null>(null)
  const [coverSource, setCoverSource] = useState<'storage' | 'local' | null>(null)
  const [coverUploadBusy, setCoverUploadBusy] = useState(false)
  const [saveBusy, setSaveBusy] = useState(false)
  const [coverName, setCoverName] = useState<string | null>(null)
  const [errorText, setErrorText] = useState<string | null>(null)

  const saveDisabled = useMemo(() => (
    saveBusy || coverUploadBusy || !title.trim()
  ), [saveBusy, coverUploadBusy, title])

  const onCoverFileSelected = async (nextFile: File | null) => {
    if (!nextFile) {
      return
    }

    setErrorText(null)

    if (!isAcceptedCoverFile(nextFile)) {
      setErrorText('Cover image must be a JPG or PNG file.')
      return
    }

    if (nextFile.size > MAX_CUSTOM_SONG_COVER_BYTES) {
      setErrorText('Cover image is too large. Use an image up to 5 MB.')
      return
    }

    setCoverUploadBusy(true)

    try {
      const fileExtension = resolveCoverFileExtension(nextFile.type, nextFile.name)
      const filePath = `${userId}/${crypto.randomUUID()}.${fileExtension}`

      const { error: uploadError } = await supabase
        .storage
        .from('song-covers')
        .upload(filePath, nextFile, {
          contentType: nextFile.type,
          upsert: false,
          cacheControl: '3600',
        })

      if (uploadError) {
        throw uploadError
      }

      const { data: publicUrlData } = supabase
        .storage
        .from('song-covers')
        .getPublicUrl(filePath)

      setCoverUrl(publicUrlData.publicUrl)
      setCoverSource('storage')
      setCoverName(nextFile.name)
      onStatus('Cover image uploaded.', 'success')
    } catch (error) {
      console.warn('CustomSongForm: failed to upload song cover', error)

      try {
        const localDataUrl = await readFileAsDataUrl(nextFile)
        setCoverUrl(localDataUrl)
        setCoverSource('local')
        setCoverName(`${nextFile.name} (local fallback)`)

        const fallbackMessage = 'Storage upload failed, but cover was imported locally and will still be saved.'
        setErrorText(null)
        onStatus(fallbackMessage, 'success')
      } catch (fallbackError) {
        const uploadMessage = fallbackError instanceof Error
          ? fallbackError.message
          : getSupabaseErrorMessage(error, 'Cover upload failed. You can still save without a cover.')

        setErrorText(uploadMessage)
        onStatus(uploadMessage, 'error')
      }
    } finally {
      setCoverUploadBusy(false)
    }
  }

  const onSaveSong = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    if (saveDisabled) {
      return
    }

    setErrorText(null)

    const normalizedTitle = title.trim()
    const normalizedArtist = artist.trim()

    if (!normalizedTitle) {
      setErrorText('Song title is required.')
      return
    }

    if (normalizedTitle.length > MAX_CUSTOM_SONG_TITLE_LENGTH || normalizedArtist.length > MAX_CUSTOM_SONG_ARTIST_LENGTH) {
      setErrorText('Song title or artist is too long.')
      return
    }

    if (hasUnsafeControlChars(normalizedTitle) || hasUnsafeControlChars(normalizedArtist)) {
      setErrorText('Please remove unsupported characters from title or artist.')
      return
    }

    setSaveBusy(true)

    try {
      const { data, error } = await supabase
        .from('custom_songs')
        .insert({
          title: normalizedTitle,
          artist: normalizedArtist || null,
          cover_url: coverUrl,
          created_by: userId,
        })
        .select('id, title, artist, cover_url, created_at')
        .single()

      if (error) {
        throw error
      }

      const savedSong: CustomSong = {
        id: String(data.id ?? ''),
        title: (data.title as string | null) ?? normalizedTitle,
        artist: (data.artist as string | null) ?? null,
        cover_url: (data.cover_url as string | null) ?? null,
        created_at: (data.created_at as string | null) ?? new Date().toISOString(),
      }

      onSavedSong(savedSong)
      onStatus('Custom song saved.', 'success')
      setTitle('')
      setArtist('')
      setCoverUrl(null)
      setCoverSource(null)
      setCoverName(null)
    } catch (error) {
      console.warn('CustomSongForm: failed to save custom song', error)
      const saveMessage = getSupabaseErrorMessage(error, 'Could not save custom song.')
      setErrorText(saveMessage)
      onStatus(saveMessage, 'error')
    } finally {
      setSaveBusy(false)
    }
  }

  return (
    <form className="queue-form gig-custom-song-form" onSubmit={onSaveSong}>
      <div className="field-row">
        <label htmlFor="custom-song-title">Title</label>
        <input
          id="custom-song-title"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="Song title"
          maxLength={MAX_CUSTOM_SONG_TITLE_LENGTH}
          required
          disabled={saveBusy}
        />
      </div>

      <div className="field-row">
        <label htmlFor="custom-song-artist">Artist (optional)</label>
        <input
          id="custom-song-artist"
          value={artist}
          onChange={(event) => setArtist(event.target.value)}
          placeholder="Artist name"
          maxLength={MAX_CUSTOM_SONG_ARTIST_LENGTH}
          disabled={saveBusy}
        />
      </div>

      <div className="field-row">
        <label htmlFor="custom-song-cover">Cover image (JPG or PNG, max 5 MB)</label>
        <input
          id="custom-song-cover"
          type="file"
          accept=".jpg,.jpeg,.png,image/jpeg,image/png"
          disabled={saveBusy || coverUploadBusy}
          onChange={(event) => {
            const selectedFile = event.target.files?.[0] ?? null
            event.target.value = ''
            void onCoverFileSelected(selectedFile)
          }}
        />
      </div>

      {coverUploadBusy ? <p className="meta-badge" role="status" aria-live="polite">Uploading cover...</p> : null}
      {coverName && !coverUploadBusy ? <p className="subcopy no-margin">Uploaded cover: {coverName}</p> : null}
      {coverSource === 'local' && !coverUploadBusy ? (
        <p className="meta-badge" role="status" aria-live="polite">Cover source: Local fallback (not from storage bucket)</p>
      ) : null}
      {errorText ? <p className="error-text" role="alert">{errorText}</p> : null}

      <button type="submit" className="primary-button" disabled={saveDisabled}>
        {saveBusy ? 'Saving...' : coverUploadBusy ? 'Upload in progress...' : 'Save Song'}
      </button>
    </form>
  )
}

export default CustomSongForm
