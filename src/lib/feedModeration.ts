import { supabase } from './supabase'

export type BlockUserOptions = {
  eventId: string
  blockedUserId?: string
  blockedIp?: string
  reason?: string
}

/**
 * Check if a user is blocked from posting to a specific event
 */
export async function isUserBlocked(eventId: string, userId?: string, userIp?: string): Promise<boolean> {
  if (!userId && !userIp) {
    return false
  }

  try {
    const { data, error } = await supabase
      .from('blocked_users')
      .select('id')
      .eq('event_id', eventId)
      .or(`blocked_user_id.eq.${userId},blocked_ip.eq.${userIp}`)
      .single()

    if (error && error.code === 'PGRST116') {
      // No rows returned - user is not blocked
      return false
    }

    if (error) {
      console.error('Error checking if user is blocked:', error)
      return false
    }

    return !!data
  } catch (error) {
    console.error('Unexpected error checking if user is blocked:', error)
    return false
  }
}

/**
 * Block a user from posting to an event
 */
export async function blockUser(options: BlockUserOptions): Promise<{ success: boolean; error?: string }> {
  const { eventId, blockedUserId, blockedIp, reason } = options

  if (!blockedUserId && !blockedIp) {
    return { success: false, error: 'Either user ID or IP must be provided' }
  }

  try {
    const { error } = await supabase
      .from('blocked_users')
      .insert({
        event_id: eventId,
        blocked_user_id: blockedUserId || null,
        blocked_ip: blockedIp || null,
        reason: reason || null,
        blocked_by: (await supabase.auth.getUser()).data.user?.id,
      })
      .select()
      .single()

    if (error) {
      console.error('Error blocking user:', error)
      return { success: false, error: error.message }
    }

    return { success: true }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    console.error('Unexpected error blocking user:', error)
    return { success: false, error: errorMessage }
  }
}

/**
 * Unblock a user from an event
 */
export async function unblockUser(blockId: string): Promise<{ success: boolean; error?: string }> {
  try {
    const { error } = await supabase
      .from('blocked_users')
      .delete()
      .eq('id', blockId)

    if (error) {
      console.error('Error unblocking user:', error)
      return { success: false, error: error.message }
    }

    return { success: true }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    console.error('Unexpected error unblocking user:', error)
    return { success: false, error: errorMessage }
  }
}

/**
 * Get the user's IP address from Supabase
 * This should ideally come from the server-side context
 */
export function getUserIpFromAuth(): string | null {
  // This is a placeholder - in production, the IP should be captured server-side
  // For now, we'll rely on the Supabase middleware to capture it
  return null
}
