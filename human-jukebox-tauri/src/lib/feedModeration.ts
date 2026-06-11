import { supabase } from './supabase'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function normalizeUuid(value?: string) {
  const trimmed = value?.trim()
  if (!trimmed || !UUID_PATTERN.test(trimmed)) {
    return null
  }

  return trimmed
}

function normalizeIp(value?: string) {
  const trimmed = value?.trim()
  if (!trimmed || trimmed.toLowerCase() === 'undefined') {
    return null
  }

  return trimmed
}

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
  const normalizedUserId = normalizeUuid(userId)
  const normalizedUserIp = normalizeIp(userIp)

  if (!normalizedUserId && !normalizedUserIp) {
    return false
  }

  try {
    const blockedFilters = [
      normalizedUserId ? `blocked_user_id.eq.${normalizedUserId}` : null,
      normalizedUserIp ? `blocked_ip.eq.${normalizedUserIp}` : null,
    ].filter(Boolean)

    if (blockedFilters.length === 0) {
      return false
    }

    let query = supabase
      .from('blocked_users')
      .select('id')
      .eq('event_id', eventId)
      .limit(1)

    if (blockedFilters.length > 1) {
      query = query.or(blockedFilters.join(','))
    } else if (normalizedUserId) {
      query = query.eq('blocked_user_id', normalizedUserId)
    } else if (normalizedUserIp) {
      query = query.eq('blocked_ip', normalizedUserIp)
    }

    const { data, error } = await query.maybeSingle()

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

  const normalizedBlockedUserId = normalizeUuid(blockedUserId)
  const normalizedBlockedIp = normalizeIp(blockedIp)

  if (!normalizedBlockedUserId && !normalizedBlockedIp) {
    return { success: false, error: 'Either user ID or IP must be provided' }
  }

  try {
    const { error } = await supabase
      .from('blocked_users')
      .insert({
        event_id: eventId,
        blocked_user_id: normalizedBlockedUserId,
        blocked_ip: normalizedBlockedIp,
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
