import { useEffect, useMemo, useState } from 'react'
import { supabase } from './supabase'

export type MidiLyricSection = {
  id: string
  label: string | null
  startTimeSeconds: number | null
  order: number | null
}

export type MidiLyricSectionNavigatorState = {
  sections: MidiLyricSection[]
  currentIndex: number
  currentSectionId: string | null
  isPlaying: boolean
  updatedAt: string | null
}

type MidiLyricSectionRow = {
  sections?: unknown
  current_index?: unknown
  current_section_id?: unknown
  is_playing?: unknown
  updated_at?: unknown
}

export type MidiLyricSectionStateStatus = 'idle' | 'loading' | 'ready' | 'error'

export type UseMidiLyricSectionStateResult = {
  state: MidiLyricSectionNavigatorState | null
  currentSection: MidiLyricSection | null
  currentSectionLabel: string | null
  status: MidiLyricSectionStateStatus
  error: string | null
}

const EMPTY_STATE: MidiLyricSectionNavigatorState = {
  sections: [],
  currentIndex: -1,
  currentSectionId: null,
  isPlaying: false,
  updatedAt: null,
}

function normalizeSection(input: unknown): MidiLyricSection | null {
  if (!input || typeof input !== 'object') {
    return null
  }

  const candidate = input as {
    id?: unknown
    label?: unknown
    startTimeSeconds?: unknown
    order?: unknown
  }

  const id = typeof candidate.id === 'string' ? candidate.id.trim() : ''
  if (!id) {
    return null
  }

  const label = typeof candidate.label === 'string' && candidate.label.trim().length > 0
    ? candidate.label.trim()
    : id

  return {
    id,
    label,
    startTimeSeconds: typeof candidate.startTimeSeconds === 'number' && Number.isFinite(candidate.startTimeSeconds)
      ? Math.max(0, candidate.startTimeSeconds)
      : null,
    order: typeof candidate.order === 'number' && Number.isFinite(candidate.order)
      ? Math.floor(candidate.order)
      : null,
  }
}

function normalizeRow(row: MidiLyricSectionRow | null | undefined): MidiLyricSectionNavigatorState {
  const sections = Array.isArray(row?.sections)
    ? row.sections.map(normalizeSection).filter(Boolean) as MidiLyricSection[]
    : []
  const currentIndex = typeof row?.current_index === 'number' && Number.isFinite(row.current_index)
    ? Math.floor(row.current_index)
    : -1
  const currentSectionId = typeof row?.current_section_id === 'string' && row.current_section_id.trim().length > 0
    ? row.current_section_id.trim()
    : null

  return {
    sections,
    currentIndex,
    currentSectionId,
    isPlaying: Boolean(row?.is_playing),
    updatedAt: typeof row?.updated_at === 'string' && row.updated_at.trim().length > 0
      ? row.updated_at.trim()
      : null,
  }
}

function resolveCurrentSection(state: MidiLyricSectionNavigatorState) {
  if (state.currentIndex >= 0 && state.currentIndex < state.sections.length) {
    return state.sections[state.currentIndex] ?? null
  }

  if (state.currentSectionId) {
    return state.sections.find((section) => section.id === state.currentSectionId) ?? null
  }

  return null
}

export function useMidiLyricSectionState(eventId: string | null) {
  const [state, setState] = useState<MidiLyricSectionNavigatorState | null>(null)
  const [status, setStatus] = useState<MidiLyricSectionStateStatus>('idle')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!eventId) {
      setState(null)
      setStatus('idle')
      setError(null)
      return
    }

    let isCurrent = true
    const channelName = `midi_lyric_section_state:${eventId}`

    const applyRow = (row: MidiLyricSectionRow | null | undefined) => {
      if (!isCurrent) {
        return
      }

      setState(row ? normalizeRow(row) : EMPTY_STATE)
      setStatus('ready')
    }

    setStatus('loading')
    setError(null)

    void (async () => {
      const { data, error: loadError } = await supabase
        .from('midi_lyric_section_state')
        .select('sections,current_index,current_section_id,is_playing,updated_at')
        .eq('event_id', eventId)
        .maybeSingle()

      if (!isCurrent) {
        return
      }

      if (loadError) {
        setState(null)
        setStatus('error')
        setError(loadError.message)
        return
      }

      applyRow(data as MidiLyricSectionRow | null)
    })()

    const channel = supabase
      .channel(channelName)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'midi_lyric_section_state',
        filter: `event_id=eq.${eventId}`,
      }, (payload) => {
        applyRow((payload.new ?? payload.old) as MidiLyricSectionRow | null)
      })
      .subscribe((subscriptionStatus) => {
        if (!isCurrent) {
          return
        }

        if (subscriptionStatus === 'SUBSCRIBED') {
          setStatus((currentStatus) => currentStatus === 'loading' ? 'ready' : currentStatus)
        }
      })

    return () => {
      isCurrent = false
      void supabase.removeChannel(channel)
    }
  }, [eventId])

  const currentSection = useMemo(() => {
    if (!state) {
      return null
    }

    return resolveCurrentSection(state)
  }, [state])

  const currentSectionLabel = currentSection?.label ?? currentSection?.id ?? null

  return {
    state,
    currentSection,
    currentSectionLabel,
    status,
    error,
  } satisfies UseMidiLyricSectionStateResult
}