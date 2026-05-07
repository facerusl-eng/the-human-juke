function toNumber(value, fallback) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function cleanString(value) {
  return String(value ?? '').trim()
}

function formatAddress(tags = {}) {
  const parts = [
    tags['addr:street'],
    tags['addr:housenumber'],
    tags['addr:postcode'],
    tags['addr:city'],
  ].filter(Boolean)

  if (parts.length) {
    return parts.join(' ')
  }

  return tags['addr:full'] || tags['contact:address'] || ''
}

function toVenue(element) {
  const tags = element?.tags || {}
  const lat = typeof element.lat === 'number' ? element.lat : element.center?.lat
  const lon = typeof element.lon === 'number' ? element.lon : element.center?.lon

  if (typeof lat !== 'number' || typeof lon !== 'number') {
    return null
  }

  const name = cleanString(tags.name || tags['brand'])

  if (!name) {
    return null
  }

  return {
    id: `${element.type}-${element.id}`,
    name,
    type: tags.amenity || tags.tourism || 'venue',
    address: formatAddress(tags),
    website: cleanString(tags.website || tags['contact:website']),
    phone: cleanString(tags.phone || tags['contact:phone']),
    email: cleanString(tags.email || tags['contact:email']),
    lat,
    lon,
  }
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Allow', 'GET, OPTIONS')
    res.status(204).end()
    return
  }

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET, OPTIONS')
    res.status(405).json({ error: 'Method Not Allowed' })
    return
  }

  const location = cleanString(req.query.location)
  const radiusKm = Math.max(1, Math.min(60, toNumber(req.query.radiusKm, 6)))
  const limit = Math.max(5, Math.min(80, toNumber(req.query.limit, 30)))

  if (!location) {
    res.status(400).json({ error: 'Missing required query parameter: location' })
    return
  }

  try {
    const geocodeUrl = new URL('https://nominatim.openstreetmap.org/search')
    geocodeUrl.searchParams.set('q', location)
    geocodeUrl.searchParams.set('format', 'jsonv2')
    geocodeUrl.searchParams.set('limit', '1')

    const geocodeResponse = await fetch(geocodeUrl.toString(), {
      headers: {
        'User-Agent': 'human-jukebox-venue-search/1.0',
      },
    })

    if (!geocodeResponse.ok) {
      throw new Error('Failed to geocode location.')
    }

    const geocodeData = await geocodeResponse.json()
    const place = Array.isArray(geocodeData) ? geocodeData[0] : null

    if (!place?.lat || !place?.lon) {
      res.status(404).json({ error: 'Could not find that location.' })
      return
    }

    const lat = Number(place.lat)
    const lon = Number(place.lon)
    const radiusMeters = Math.round(radiusKm * 1000)

    const overpassQuery = `
      [out:json][timeout:25];
      (
        node["amenity"~"pub|bar|restaurant|cafe|nightclub|biergarten"](around:${radiusMeters},${lat},${lon});
        way["amenity"~"pub|bar|restaurant|cafe|nightclub|biergarten"](around:${radiusMeters},${lat},${lon});
      );
      out center tags ${limit};
    `

    const overpassResponse = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain',
        'User-Agent': 'human-jukebox-venue-search/1.0',
      },
      body: overpassQuery,
    })

    if (!overpassResponse.ok) {
      throw new Error('Failed to query nearby venues.')
    }

    const overpassData = await overpassResponse.json()
    const elements = Array.isArray(overpassData?.elements) ? overpassData.elements : []

    const seenNames = new Set()
    const venues = []

    for (const element of elements) {
      const venue = toVenue(element)

      if (!venue) {
        continue
      }

      const dedupeKey = `${venue.name.toLowerCase()}::${venue.address.toLowerCase()}`

      if (seenNames.has(dedupeKey)) {
        continue
      }

      seenNames.add(dedupeKey)
      venues.push(venue)

      if (venues.length >= limit) {
        break
      }
    }

    res.status(200).json({
      ok: true,
      center: {
        location: place.display_name || location,
        lat,
        lon,
      },
      venues,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Venue search failed.'
    res.status(500).json({ error: message })
  }
}
