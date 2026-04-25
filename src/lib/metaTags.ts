/**
 * Utility for managing Open Graph meta tags for social media sharing
 */

interface OGMetaTags {
  title?: string
  description?: string
  image?: string
  url?: string
  type?: string
}

// Determine the app logo URL - works in development and production
function getAppLogoUrl(): string {
  if (typeof window === 'undefined') {
    return 'https://the-human-jukebox.org/the-human-jukebox-logo.png'
  }

  return `${window.location.origin}/the-human-jukebox-logo.png`
}

const DEFAULT_OG_DESCRIPTION = 'Join the Human Jukebox - a collaborative music experience where the audience shapes the setlist in real-time.'

/**
 * Set or update Open Graph meta tags
 * @param tags Object containing OG tag values
 */
export function updateOGTags(tags: OGMetaTags) {
  const appLogoUrl = getAppLogoUrl()
  const {
    title = 'Human Jukebox',
    description = DEFAULT_OG_DESCRIPTION,
    image = appLogoUrl,
    url,
    type = 'website',
  } = tags

  // Update og:title
  updateMetaTag('og:title', title)

  // Update og:description
  updateMetaTag('og:description', description)

  // Update og:image - ensure it's absolute URL
  const imageUrl = image && !image.startsWith('http') ? `${window.location.origin}${image}` : image
  updateMetaTag('og:image', imageUrl)

  // Update og:url
  if (url) {
    updateMetaTag('og:url', url)
  }

  // Update og:type
  updateMetaTag('og:type', type)

  // Update standard title and meta description for general use
  document.title = title
  updateMetaTag('description', description)

  // Also update Twitter Card meta tags
  updateMetaTag('twitter:title', title)
  updateMetaTag('twitter:description', description)
  updateMetaTag('twitter:image', imageUrl)
}

/**
 * Set OG tags for a gig/event share
 * @param gigName Gig title
 * @param performerName Performer/host name
 * @param coverImageUrl Optional cover image URL (falls back to app logo)
 * @param gigUrl URL to share
 */
export function setGigOGTags(
  gigName: string,
  _venueName: string | null | undefined,
  performerName: string | null | undefined,
  coverImageUrl: string | null | undefined,
  gigUrl?: string,
) {
  const appLogoUrl = getAppLogoUrl()
  const performer = performerName ? ` with ${performerName}` : ''
  const description = `Join the queue at ${gigName}${performer} - Request songs and vote with the audience!`

  updateOGTags({
    title: gigName,
    description,
    image: coverImageUrl || appLogoUrl,
    url: gigUrl || (typeof window !== 'undefined' ? window.location.href : undefined),
    type: 'website',
  })
}

/**
 * Set OG tags for audience/event page
 * @param eventName Event title
 * @param description Event description
 * @param coverImageUrl Optional cover image
 * @param eventUrl URL to share
 */
export function setEventOGTags(
  eventName: string,
  description?: string,
  coverImageUrl?: string | null,
  eventUrl?: string,
) {
  const appLogoUrl = getAppLogoUrl()

  updateOGTags({
    title: eventName,
    description: description || DEFAULT_OG_DESCRIPTION,
    image: coverImageUrl || appLogoUrl,
    url: eventUrl || (typeof window !== 'undefined' ? window.location.href : undefined),
    type: 'website',
  })
}

/**
 * Reset OG tags to defaults
 */
export function resetOGTags() {
  const appLogoUrl = getAppLogoUrl()

  updateOGTags({
    title: 'Human Jukebox',
    description: DEFAULT_OG_DESCRIPTION,
    image: appLogoUrl,
  })
}

/**
 * Internal helper to update or create a meta tag
 */
function updateMetaTag(propertyOrName: string, content: string) {
  const isProperty = propertyOrName.startsWith('og:') || propertyOrName.startsWith('twitter:')

  let tag = document.querySelector(
    isProperty ? `meta[property="${propertyOrName}"]` : `meta[name="${propertyOrName}"]`,
  ) as HTMLMetaElement | null

  if (!tag) {
    tag = document.createElement('meta')
    if (isProperty) {
      tag.setAttribute('property', propertyOrName)
    } else {
      tag.setAttribute('name', propertyOrName)
    }
    document.head.appendChild(tag)
  }

  tag.content = content
}
