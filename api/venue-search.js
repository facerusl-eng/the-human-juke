function toNumber(value, fallback) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function cleanString(value) {
  return String(value ?? '').trim()
}

function formatAddress(tags = {}) {
  const streetLine = [tags['addr:street'], tags['addr:housenumber']]
    .map((part) => cleanString(part))
    .filter(Boolean)
    .join(' ')

  const localityLine = [
    tags['addr:postcode'],
    tags['addr:city'],
    tags['addr:suburb'],
    tags['addr:district'],
    tags['addr:place'],
    tags['is_in:city'],
  ]
    .map((part) => cleanString(part))
    .filter(Boolean)
    .join(' ')

  const parts = [streetLine, localityLine].filter(Boolean)

  if (parts.length) {
    return parts.join(', ')
  }

  // Only use addr:full or contact:address, NOT description
  const fallback = cleanString(tags['addr:full'] || tags['contact:address'])
  return fallback
}

function formatReverseAddress(payload = {}) {
  const address = payload?.address || {}
  const street = cleanString(address.road || address.pedestrian || address.footway || address.path || address.street)
  const houseNumber = cleanString(address.house_number)
  const postcode = cleanString(address.postcode)
  const city = cleanString(address.city || address.town || address.village || address.hamlet || address.municipality)
  const suburb = cleanString(address.suburb || address.city_district || address.county)
  const neighbourhood = cleanString(address.neighbourhood)

  const streetLine = [street, houseNumber].filter(Boolean).join(' ')
  const locality = city || suburb || neighbourhood
  const localityLine = [postcode, locality].filter(Boolean).join(' ')
  const parts = [streetLine, localityLine].filter(Boolean)

  if (parts.length > 0) {
    return parts.join(', ')
  }
  
  const displayName = cleanString(payload?.display_name)
  return displayName && displayName.length > 5 ? displayName.substring(0, 100) : ''
}

function normalizeLocationQuery(location) {
  const normalized = cleanString(location)

  if (/^\d{4}$/.test(normalized)) {
    return `${normalized}, Denmark`
  }

  return normalized
}

async function reverseGeocodeAddress(lat, lon) {
  try {
    const reverseUrl = new URL('https://nominatim.openstreetmap.org/reverse')
    reverseUrl.searchParams.set('lat', String(lat))
    reverseUrl.searchParams.set('lon', String(lon))
    reverseUrl.searchParams.set('format', 'jsonv2')
    reverseUrl.searchParams.set('zoom', '18')
    reverseUrl.searchParams.set('addressdetails', '1')

    // Wrap fetch in a timeout promise (increase to 5 seconds)
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Reverse geocoding timeout')), 5000),
    )

    const fetchPromise = fetch(reverseUrl.toString(), {
      headers: {
        'User-Agent': 'human-jukebox-venue-search/1.0',
      },
    })

    const response = await Promise.race([fetchPromise, timeoutPromise])

    if (!response.ok) {
      console.error(`Reverse geocoding failed: ${response.status} at ${lat}, ${lon}`)
      return ''
    }

    const payload = await response.json().catch((err) => {
      console.error(`Failed to parse reverse geocoding response: ${err}`)
      return null
    })
    
    if (!payload) {
      return ''
    }

    const formatted = formatReverseAddress(payload)
    if (formatted) {
      console.log(`Successfully reverse geocoded ${lat.toFixed(5)}, ${lon.toFixed(5)} → ${formatted}`)
    }
    return formatted
  } catch (error) {
    console.error(`Reverse geocoding error at ${lat}, ${lon}: ${error instanceof Error ? error.message : String(error)}`)
    return ''
  }
}

async function enrichMissingVenueAddresses(venues) {
  const missingVenues = venues.filter((venue) => !venue.address)
  
  if (missingVenues.length === 0) {
    return
  }

  const lookupBudget = Math.min(12, missingVenues.length)
  
  // Process in smaller batches to respect Nominatim rate limits
  const batchSize = 3
  for (let batch = 0; batch < Math.ceil(lookupBudget / batchSize); batch += 1) {
    const start = batch * batchSize
    const end = Math.min(start + batchSize, lookupBudget)
    const batchVenues = missingVenues.slice(start, end)
    
    const promises = batchVenues.map((venue) =>
      reverseGeocodeAddress(venue.lat, venue.lon)
        .then((address) => {
          const trimmed = cleanString(address)
          if (trimmed) {
            venue.address = trimmed
            console.log(`Geocoded ${venue.name} → ${trimmed}`)
          } else {
            console.log(`No address found for ${venue.name}`)
          }
        })
        .catch((err) => console.error(`Error geocoding ${venue.name}:`, err)),
    )
    
    await Promise.allSettled(promises)
    
    // Small delay between batches to avoid rate limiting
    if (batch < Math.ceil(lookupBudget / batchSize) - 1) {
      await new Promise(resolve => setTimeout(resolve, 500))
    }
  }
  
  console.log(`Address enrichment complete for ${lookupBudget} venues`)
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

  const location = normalizeLocationQuery(req.query.location)
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

    try {
      await enrichMissingVenueAddresses(venues)
    } catch (enrichError) {
      // Silently fail enrichment - we still have venues without full addresses
      console.error('Address enrichment failed:', enrichError instanceof Error ? enrichError.message : enrichError)
    }

    res.status(200).json({
      ok: true,
      center: {
        location: place.display_name || location,
        address: place.display_name || location,
        provider: 'Nominatim (OpenStreetMap)',
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
