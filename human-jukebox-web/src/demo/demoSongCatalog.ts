type DemoCuratedSong = {
  id: string
  title: string
  artist: string
  cover_url: string | null
  is_explicit: boolean
  fromKaraokeSetlist: boolean
}

const DEMO_COVER_URL = '/the-human-jukebox-logo.png'

export const DEMO_CURATED_SONGS: DemoCuratedSong[] = [
  { id: 'demo-lib-001', title: 'Africa', artist: 'Toto', cover_url: DEMO_COVER_URL, is_explicit: false, fromKaraokeSetlist: false },
  { id: 'demo-lib-002', title: 'Bohemian Rhapsody', artist: 'Queen', cover_url: DEMO_COVER_URL, is_explicit: false, fromKaraokeSetlist: false },
  { id: 'demo-lib-003', title: 'Dancing Queen', artist: 'ABBA', cover_url: DEMO_COVER_URL, is_explicit: false, fromKaraokeSetlist: false },
  { id: 'demo-lib-004', title: 'Don\'t Stop Believin\'', artist: 'Journey', cover_url: DEMO_COVER_URL, is_explicit: false, fromKaraokeSetlist: false },
  { id: 'demo-lib-005', title: 'Hotel California', artist: 'Eagles', cover_url: DEMO_COVER_URL, is_explicit: false, fromKaraokeSetlist: false },
  { id: 'demo-lib-006', title: 'I Wanna Dance with Somebody', artist: 'Whitney Houston', cover_url: DEMO_COVER_URL, is_explicit: false, fromKaraokeSetlist: false },
  { id: 'demo-lib-007', title: 'Livin\' on a Prayer', artist: 'Bon Jovi', cover_url: DEMO_COVER_URL, is_explicit: false, fromKaraokeSetlist: false },
  { id: 'demo-lib-008', title: 'Mr. Brightside', artist: 'The Killers', cover_url: DEMO_COVER_URL, is_explicit: false, fromKaraokeSetlist: false },
  { id: 'demo-lib-009', title: 'Shut Up and Dance', artist: 'Walk the Moon', cover_url: DEMO_COVER_URL, is_explicit: false, fromKaraokeSetlist: false },
  { id: 'demo-lib-010', title: 'Sweet Caroline', artist: 'Neil Diamond', cover_url: DEMO_COVER_URL, is_explicit: false, fromKaraokeSetlist: false },
  { id: 'demo-lib-011', title: 'Take On Me', artist: 'a-ha', cover_url: DEMO_COVER_URL, is_explicit: false, fromKaraokeSetlist: false },
  { id: 'demo-lib-012', title: 'Wonderwall', artist: 'Oasis', cover_url: DEMO_COVER_URL, is_explicit: false, fromKaraokeSetlist: false },
  { id: 'demo-lib-013', title: 'Bad Romance', artist: 'Lady Gaga', cover_url: DEMO_COVER_URL, is_explicit: false, fromKaraokeSetlist: true },
  { id: 'demo-lib-014', title: 'Can\'t Stop the Feeling!', artist: 'Justin Timberlake', cover_url: DEMO_COVER_URL, is_explicit: false, fromKaraokeSetlist: true },
  { id: 'demo-lib-015', title: 'Dancing in the Dark', artist: 'Bruce Springsteen', cover_url: DEMO_COVER_URL, is_explicit: false, fromKaraokeSetlist: true },
  { id: 'demo-lib-016', title: 'Freed from Desire', artist: 'Gala', cover_url: DEMO_COVER_URL, is_explicit: false, fromKaraokeSetlist: true },
  { id: 'demo-lib-017', title: 'Girls Just Want to Have Fun', artist: 'Cyndi Lauper', cover_url: DEMO_COVER_URL, is_explicit: false, fromKaraokeSetlist: true },
  { id: 'demo-lib-018', title: 'I Want It That Way', artist: 'Backstreet Boys', cover_url: DEMO_COVER_URL, is_explicit: false, fromKaraokeSetlist: true },
  { id: 'demo-lib-019', title: 'Rolling in the Deep', artist: 'Adele', cover_url: DEMO_COVER_URL, is_explicit: false, fromKaraokeSetlist: true },
  { id: 'demo-lib-020', title: 'Someone Like You', artist: 'Adele', cover_url: DEMO_COVER_URL, is_explicit: false, fromKaraokeSetlist: true },
  { id: 'demo-lib-021', title: "Summer of '69", artist: 'Bryan Adams', cover_url: DEMO_COVER_URL, is_explicit: false, fromKaraokeSetlist: true },
  { id: 'demo-lib-022', title: 'Teenage Dream', artist: 'Katy Perry', cover_url: DEMO_COVER_URL, is_explicit: false, fromKaraokeSetlist: true },
  { id: 'demo-lib-023', title: 'Valerie', artist: 'Amy Winehouse', cover_url: DEMO_COVER_URL, is_explicit: false, fromKaraokeSetlist: true },
  { id: 'demo-lib-024', title: 'Viva La Vida', artist: 'Coldplay', cover_url: DEMO_COVER_URL, is_explicit: false, fromKaraokeSetlist: true },
]