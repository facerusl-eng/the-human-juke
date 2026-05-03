/**
 * Fake community feed posts for Demo Mode.
 * These simulate a buzzing live crowd — a mix of shout-outs,
 * dedications, and crowd moments.
 */

export type DemoFeedPost = {
  id: string
  event_id: string
  user_id: string
  author_name: string
  message: string
  image_data_url: string | null
  created_at: string
}

function minsAgo(minutes: number): string {
  return new Date(Date.now() - minutes * 60 * 1000).toISOString()
}

export const DEMO_FEED_POSTS: DemoFeedPost[] = [
  {
    id: 'demo-post-001',
    event_id: 'demo-event-001',
    user_id: 'demo-user-001',
    author_name: 'Mads K.',
    message: 'This DJ is INCREDIBLE tonight 🔥🔥 best night out in months!!',
    image_data_url: null,
    created_at: minsAgo(2),
  },
  {
    id: 'demo-post-002',
    event_id: 'demo-event-001',
    user_id: 'demo-user-002',
    author_name: 'Sarah & Tom',
    message: 'Happy anniversary to us! 💕 Can you play something for us?',
    image_data_url: null,
    created_at: minsAgo(6),
  },
  {
    id: 'demo-post-003',
    event_id: 'demo-event-001',
    user_id: 'demo-user-003',
    author_name: 'Jesper',
    message: 'Bohemian Rhapsody is going to DESTROY this crowd 🤘😂',
    image_data_url: null,
    created_at: minsAgo(11),
  },
  {
    id: 'demo-post-004',
    event_id: 'demo-event-001',
    user_id: 'demo-user-004',
    author_name: 'Louise 🎤',
    message: 'Okay who put in Dancing Queen?? That\'s literally my song 👑',
    image_data_url: null,
    created_at: minsAgo(16),
  },
  {
    id: 'demo-post-005',
    event_id: 'demo-event-001',
    user_id: 'demo-user-005',
    author_name: 'Rasmus',
    message: 'Shoutout to the bar staff — fastest service in Copenhagen! 🍻',
    image_data_url: null,
    created_at: minsAgo(21),
  },
  {
    id: 'demo-post-006',
    event_id: 'demo-event-001',
    user_id: 'demo-user-006',
    author_name: 'Emma V.',
    message: 'My friends dragged me here and now I\'m the loudest one singing 😂❤️',
    image_data_url: null,
    created_at: minsAgo(28),
  },
  {
    id: 'demo-post-007',
    event_id: 'demo-event-001',
    user_id: 'demo-user-007',
    author_name: 'Nikolaj',
    message: 'This is what Friday nights are supposed to feel like 🎶🥳',
    image_data_url: null,
    created_at: minsAgo(34),
  },
  {
    id: 'demo-post-008',
    event_id: 'demo-event-001',
    user_id: 'demo-user-008',
    author_name: 'Camille & the crew',
    message: 'Table 7 is having the TIME of our lives!! 🔥🎉',
    image_data_url: null,
    created_at: minsAgo(41),
  },
]

/**
 * Simulated "live" posts that appear one by one after page load
 * to demonstrate the real-time feed effect.
 */
export const DEMO_LIVE_INCOMING_POSTS: DemoFeedPost[] = [
  {
    id: 'demo-live-001',
    event_id: 'demo-event-001',
    user_id: 'demo-live-u-001',
    author_name: 'Anders B.',
    message: 'AFRICA BY TOTO LETS GOOO 🌍🎵',
    image_data_url: null,
    created_at: '',
  },
  {
    id: 'demo-live-002',
    event_id: 'demo-event-001',
    user_id: 'demo-live-u-002',
    author_name: 'Sofie 🌙',
    message: 'Best. Night. Ever. 😍🥹',
    image_data_url: null,
    created_at: '',
  },
]
