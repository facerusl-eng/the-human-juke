import type { AppDataset } from '../types/domain'

export const mockDataset: AppDataset = {
  songs: [
    {
      id: 'song_midnight_satellites',
      title: 'Midnight Satellites',
      artist: 'Electric Avenue',
      length: '03:48',
      energy: 'Medium',
      tags: ['Trending', 'Warm-up'],
    },
    {
      id: 'song_city_lights_loud_hearts',
      title: 'City Lights, Loud Hearts',
      artist: 'Nova Hotel',
      length: '04:02',
      energy: 'High',
      tags: ['Trending', 'Peak Hour'],
    },
    {
      id: 'song_golden_static',
      title: 'Golden Static',
      artist: 'Harborline',
      length: '03:31',
      energy: 'Low',
      tags: ['Warm-up', 'Encore'],
    },
    {
      id: 'song_heartbeat_parade',
      title: 'Heartbeat Parade',
      artist: 'Luna District',
      length: '03:59',
      energy: 'High',
      tags: ['Peak Hour', 'Encore'],
    },
  ],
  setBlocks: [
    {
      id: 'set_doors_open_flow',
      name: 'Doors Open Flow',
      songs: 7,
      vibe: 'Relaxed uplift',
      duration: '24 min',
    },
    {
      id: 'set_prime_crowd_push',
      name: 'Prime Crowd Push',
      songs: 12,
      vibe: 'Dance-heavy',
      duration: '44 min',
    },
    {
      id: 'set_late_night_encore',
      name: 'Late Night Encore',
      songs: 5,
      vibe: 'Big sing-along',
      duration: '18 min',
    },
  ],
  liveConsole: {
    state: 'pre_show',
    nextTransitionIn: '07:18',
    syncLatencyMs: 220,
  },
}
