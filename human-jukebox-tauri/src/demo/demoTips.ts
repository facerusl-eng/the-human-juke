/**
 * Fake tip data for Demo Mode.
 * Each entry mirrors a tip event that would normally come from Supabase.
 */
export type DemoTip = {
  id: string
  senderName: string
  amount: number
  currency: string
  message: string | null
  createdAt: string
}

export const DEMO_INITIAL_TIPS: DemoTip[] = [
  {
    id: 'demo-tip-001',
    senderName: 'Maria K.',
    amount: 50,
    currency: 'DKK',
    message: 'Awesome set tonight!',
    createdAt: new Date(Date.now() - 12 * 60 * 1000).toISOString(),
  },
  {
    id: 'demo-tip-002',
    senderName: 'Thomas B.',
    amount: 20,
    currency: 'DKK',
    message: null,
    createdAt: new Date(Date.now() - 8 * 60 * 1000).toISOString(),
  },
  {
    id: 'demo-tip-003',
    senderName: 'Sophie L.',
    amount: 100,
    currency: 'DKK',
    message: 'Please play Africa next 🙏',
    createdAt: new Date(Date.now() - 3 * 60 * 1000).toISOString(),
  },
]
