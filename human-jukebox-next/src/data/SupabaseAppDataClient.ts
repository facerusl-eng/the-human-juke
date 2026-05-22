import type { AppDataset } from '../types/domain'
import type { AppDataClient } from './AppDataClient'
import { supabase } from './supabaseClient'

const SONGS_TABLE = import.meta.env.VITE_SUPABASE_SONGS_TABLE || 'songs'
const SET_BLOCKS_TABLE = import.meta.env.VITE_SUPABASE_SET_BLOCKS_TABLE || 'set_blocks'
const LIVE_CONSOLE_TABLE = import.meta.env.VITE_SUPABASE_LIVE_CONSOLE_TABLE || 'live_console_snapshots'

type SongRow = {
  id: string
  title: string | null
  artist: string | null
  length: string | null
  energy: 'Low' | 'Medium' | 'High' | null
  tags: string[] | null
}

type SetBlockRow = {
  id: string
  name: string | null
  songs: number | null
  vibe: string | null
  duration: string | null
}

type LiveConsoleRow = {
  state: 'pre_show' | 'live' | 'break' | null
  next_transition_in: string | null
  sync_latency_ms: number | null
}

export class SupabaseAppDataClient implements AppDataClient {
  async fetchDataset(): Promise<AppDataset> {
    const [songsResult, setBlocksResult, liveConsoleResult] = await Promise.all([
      supabase
        .from(SONGS_TABLE)
        .select('id,title,artist,length,energy,tags')
        .order('title', { ascending: true }),
      supabase
        .from(SET_BLOCKS_TABLE)
        .select('id,name,songs,vibe,duration')
        .order('name', { ascending: true }),
      supabase
        .from(LIVE_CONSOLE_TABLE)
        .select('state,next_transition_in,sync_latency_ms')
        .order('created_at', { ascending: false })
        .limit(1),
    ])

    if (songsResult.error) {
      throw songsResult.error
    }

    if (setBlocksResult.error) {
      throw setBlocksResult.error
    }

    if (liveConsoleResult.error) {
      throw liveConsoleResult.error
    }

    const songsRows = (songsResult.data ?? []) as SongRow[]
    const setBlockRows = (setBlocksResult.data ?? []) as SetBlockRow[]
    const liveConsoleRow = ((liveConsoleResult.data ?? [])[0] ?? null) as LiveConsoleRow | null

    return {
      songs: songsRows.map((row) => ({
        id: row.id,
        title: row.title ?? 'Untitled Song',
        artist: row.artist ?? 'Unknown Artist',
        length: row.length ?? '00:00',
        energy: row.energy ?? 'Medium',
        tags: row.tags ?? [],
      })),
      setBlocks: setBlockRows.map((row) => ({
        id: row.id,
        name: row.name ?? 'Untitled Set',
        songs: row.songs ?? 0,
        vibe: row.vibe ?? 'Unspecified vibe',
        duration: row.duration ?? '0 min',
      })),
      liveConsole: {
        state: liveConsoleRow?.state ?? 'pre_show',
        nextTransitionIn: liveConsoleRow?.next_transition_in ?? '00:00',
        syncLatencyMs: liveConsoleRow?.sync_latency_ms ?? 0,
      },
    }
  }
}
