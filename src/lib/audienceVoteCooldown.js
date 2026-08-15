export const AUDIENCE_VOTE_COOLDOWN_MS = 10 * 60 * 1000;
const AUDIENCE_VOTE_IDENTITY_STORAGE_KEY = 'human-jukebox-audience-vote-cooldown-identity-v1';

export function resolveAudienceVoteCooldownIdentity({
  voterId,
  storage = typeof window !== 'undefined' ? window.localStorage : null,
} = {}) {
  const normalizedVoterId = typeof voterId === 'string' ? voterId.trim() : '';
  const looksAnonymous = /^((anon|anonymous|guest)[-_]|anon$|anonymous$|guest$)/i.test(normalizedVoterId);

  if (normalizedVoterId && !looksAnonymous) {
    return normalizedVoterId;
  }

  if (!storage) {
    return 'anonymous-browser-vote-user';
  }

  try {
    const storedIdentity = storage.getItem(AUDIENCE_VOTE_IDENTITY_STORAGE_KEY)?.trim();
    if (storedIdentity) {
      return storedIdentity;
    }

    const generatedIdentity = `anonymous-browser-vote-user-${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}`;
    storage.setItem(AUDIENCE_VOTE_IDENTITY_STORAGE_KEY, generatedIdentity);
    return generatedIdentity;
  } catch {
    return normalizedVoterId || 'anonymous-browser-vote-user';
  }
}

export function resolveAudienceVoteCooldownKey({
  eventId,
  voterId,
  storage = typeof window !== 'undefined' ? window.localStorage : null,
} = {}) {
  const eventScope = typeof eventId === 'string' && eventId.trim() ? eventId.trim() : 'unknown-event';
  return `human-jukebox-audience-vote-cooldown-${eventScope}-${resolveAudienceVoteCooldownIdentity({ voterId, storage })}`;
}

export function canCastAudienceVote(lastVoteAtMs, nowMs = Date.now(), isShowLive = true) {
  if (!isShowLive) {
    return true;
  }

  if (!Number.isFinite(lastVoteAtMs) || lastVoteAtMs <= 0) {
    return true;
  }

  return nowMs - lastVoteAtMs >= AUDIENCE_VOTE_COOLDOWN_MS;
}

export function getAudienceVoteCooldownRemainingMs(lastVoteAtMs, nowMs = Date.now(), isShowLive = true) {
  if (!isShowLive) {
    return 0;
  }

  if (!Number.isFinite(lastVoteAtMs) || lastVoteAtMs <= 0) {
    return 0;
  }

  return Math.max(0, AUDIENCE_VOTE_COOLDOWN_MS - (nowMs - lastVoteAtMs));
}
