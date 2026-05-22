import { createServer } from 'node:http'
import dgram from 'node:dgram'

const HOST = process.env.X18_BRIDGE_HOST || '127.0.0.1'
const PORT = Number(process.env.X18_BRIDGE_PORT || 4318)

function padOscString(value) {
  const text = String(value)
  const bytes = Buffer.from(text + '\0', 'utf8')
  const padding = (4 - (bytes.length % 4)) % 4
  return padding > 0 ? Buffer.concat([bytes, Buffer.alloc(padding)]) : bytes
}

function encodeOscInt(value) {
  const output = Buffer.alloc(4)
  output.writeInt32BE(Number(value) || 0, 0)
  return output
}

function encodeOscFloat(value) {
  const output = Buffer.alloc(4)
  output.writeFloatBE(Number(value) || 0, 0)
  return output
}

function toXAirPan(value) {
  const clamped = Math.max(-1, Math.min(1, Number(value) || 0))
  return (clamped + 1) / 2
}

function buildOscPacket(address, args = []) {
  const addressBlock = padOscString(address)
  const tags = ',' + args.map((arg) => arg.type).join('')
  const tagBlock = padOscString(tags)
  const argBlocks = args.map((arg) => {
    if (arg.type === 's') {
      return padOscString(arg.value)
    }

    if (arg.type === 'i') {
      return encodeOscInt(arg.value)
    }

    if (arg.type === 'f') {
      return encodeOscFloat(arg.value)
    }

    return Buffer.alloc(0)
  })

  return Buffer.concat([addressBlock, tagBlock, ...argBlocks])
}

function sendOscMessages(host, port, messages) {
  return new Promise((resolve, reject) => {
    const socket = dgram.createSocket('udp4')

    socket.on('error', (error) => {
      socket.close()
      reject(error)
    })

    let sent = 0
    const sendNext = () => {
      if (sent >= messages.length) {
        socket.close()
        resolve()
        return
      }

      const message = messages[sent]
      socket.send(message, port, host, (error) => {
        if (error) {
          socket.close()
          reject(error)
          return
        }

        sent += 1
        setTimeout(sendNext, 6)
      })
    }

    sendNext()
  })
}

function buildPresetMessages(presetId) {
  if (presetId === 'vocalFocus') {
    return [
      buildOscPacket('/lr/mix/fader', [{ type: 'f', value: 0.72 }]),
      buildOscPacket('/ch/01/mix/fader', [{ type: 'f', value: 0.55 }]),
      buildOscPacket('/ch/02/mix/fader', [{ type: 'f', value: 0.48 }]),
      buildOscPacket('/ch/03/mix/fader', [{ type: 'f', value: 0.44 }]),
    ]
  }

  if (presetId === 'backingWide') {
    return [
      buildOscPacket('/lr/mix/fader', [{ type: 'f', value: 0.78 }]),
      buildOscPacket('/ch/01/mix/pan', [{ type: 'f', value: 0.18 }]),
      buildOscPacket('/ch/02/mix/pan', [{ type: 'f', value: 0.82 }]),
      buildOscPacket('/ch/03/mix/pan', [{ type: 'f', value: 0.3 }]),
      buildOscPacket('/ch/04/mix/pan', [{ type: 'f', value: 0.7 }]),
    ]
  }

  return [
    buildOscPacket('/lr/mix/fader', [{ type: 'f', value: 0.68 }]),
    buildOscPacket('/ch/01/mix/fader', [{ type: 'f', value: 0.5 }]),
    buildOscPacket('/ch/02/mix/fader', [{ type: 'f', value: 0.5 }]),
    buildOscPacket('/ch/03/mix/fader', [{ type: 'f', value: 0.45 }]),
  ]
}

function buildPanicMuteMessages() {
  const messages = [buildOscPacket('/lr/mix/fader', [{ type: 'f', value: 0 }])]
  for (let index = 1; index <= 10; index += 1) {
    const channelAddress = `/ch/${String(index).padStart(2, '0')}`
    messages.push(buildOscPacket(`${channelAddress}/mix/on`, [{ type: 'i', value: 0 }]))
  }
  return messages
}

function buildResetSceneMessages() {
  const messages = [buildOscPacket('/lr/mix/fader', [{ type: 'f', value: 0.68 }])]
  for (let index = 1; index <= 10; index += 1) {
    const channelAddress = `/ch/${String(index).padStart(2, '0')}`
    messages.push(buildOscPacket(`${channelAddress}/mix/on`, [{ type: 'i', value: 1 }]))
    messages.push(buildOscPacket(`${channelAddress}/mix/fader`, [{ type: 'f', value: 0.5 }]))
    messages.push(buildOscPacket(`${channelAddress}/mix/pan`, [{ type: 'f', value: 0.5 }]))
  }
  return messages
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = ''
    req.on('data', (chunk) => {
      data += chunk
      if (data.length > 2_000_000) {
        reject(new Error('Payload too large'))
      }
    })
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {})
      } catch {
        reject(new Error('Invalid JSON body'))
      }
    })
    req.on('error', reject)
  })
}

function json(res, status, payload) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  })
  res.end(JSON.stringify(payload))
}

const server = createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    json(res, 200, { ok: true })
    return
  }

  if (req.method === 'GET' && req.url === '/health') {
    json(res, 200, { ok: true, service: 'x18-bridge', host: HOST, port: PORT })
    return
  }

  if (req.method === 'POST' && req.url === '/x18/apply-routing') {
    try {
      const payload = await readBody(req)
      const host = typeof payload.host === 'string' && payload.host.trim() ? payload.host.trim() : '127.0.0.1'
      const port = Number(payload.port) || 10024
      const channels = Array.isArray(payload.channels) ? payload.channels : []
      const masterVolume = Math.max(0, Math.min(1, Number(payload.master?.volume) || 0.9))

      const messages = []
      messages.push(buildOscPacket('/lr/mix/fader', [{ type: 'f', value: masterVolume }]))

      for (const channel of channels) {
        const index = Number(channel.channel)
        if (!Number.isInteger(index) || index < 1 || index > 10) {
          continue
        }

        const channelAddress = `/ch/${String(index).padStart(2, '0')}`
        const name = String(channel.name || `Stem ${index}`).slice(0, 12)
        const volume = Math.max(0, Math.min(1, Number(channel.volume) || 0))
        const pan = toXAirPan(channel.pan)
        const muted = Boolean(channel.muted)

        messages.push(buildOscPacket(`${channelAddress}/config/name`, [{ type: 's', value: name }]))
        messages.push(buildOscPacket(`${channelAddress}/mix/fader`, [{ type: 'f', value: volume }]))
        messages.push(buildOscPacket(`${channelAddress}/mix/pan`, [{ type: 'f', value: pan }]))
        messages.push(buildOscPacket(`${channelAddress}/mix/on`, [{ type: 'i', value: muted ? 0 : 1 }]))
      }

      if (messages.length === 0) {
        json(res, 400, { ok: false, message: 'No valid channel routing entries were provided.' })
        return
      }

      await sendOscMessages(host, port, messages)
      json(res, 200, { ok: true, applied: channels.length, sent: messages.length })
    } catch (error) {
      json(res, 500, { ok: false, message: error instanceof Error ? error.message : 'Unexpected bridge error' })
    }
    return
  }

  if (req.method === 'POST' && req.url === '/x18/test-connection') {
    try {
      const payload = await readBody(req)
      const host = typeof payload.host === 'string' && payload.host.trim() ? payload.host.trim() : '127.0.0.1'
      const port = Number(payload.port) || 10024

      await sendOscMessages(host, port, [buildOscPacket('/xinfo')])
      json(res, 200, { ok: true, message: `Connection probe sent to X18 at ${host}:${port}.` })
    } catch (error) {
      json(res, 500, { ok: false, message: error instanceof Error ? error.message : 'Connection test failed' })
    }
    return
  }

  if (req.method === 'POST' && req.url === '/x18/apply-preset') {
    try {
      const payload = await readBody(req)
      const host = typeof payload.host === 'string' && payload.host.trim() ? payload.host.trim() : '127.0.0.1'
      const port = Number(payload.port) || 10024
      const presetId = typeof payload.presetId === 'string' ? payload.presetId : 'liveSafe'
      const messages = buildPresetMessages(presetId)

      await sendOscMessages(host, port, messages)
      json(res, 200, { ok: true, message: `Preset ${presetId} pushed to X18.` })
    } catch (error) {
      json(res, 500, { ok: false, message: error instanceof Error ? error.message : 'Preset push failed' })
    }
    return
  }

  if (req.method === 'POST' && req.url === '/x18/panic') {
    try {
      const payload = await readBody(req)
      const host = typeof payload.host === 'string' && payload.host.trim() ? payload.host.trim() : '127.0.0.1'
      const port = Number(payload.port) || 10024

      await sendOscMessages(host, port, buildPanicMuteMessages())
      json(res, 200, { ok: true, message: 'Panic mute sent to X18.' })
    } catch (error) {
      json(res, 500, { ok: false, message: error instanceof Error ? error.message : 'Panic mute failed' })
    }
    return
  }

  if (req.method === 'POST' && req.url === '/x18/reset-scene') {
    try {
      const payload = await readBody(req)
      const host = typeof payload.host === 'string' && payload.host.trim() ? payload.host.trim() : '127.0.0.1'
      const port = Number(payload.port) || 10024

      await sendOscMessages(host, port, buildResetSceneMessages())
      json(res, 200, { ok: true, message: 'Reset scene sent to X18.' })
    } catch (error) {
      json(res, 500, { ok: false, message: error instanceof Error ? error.message : 'Reset scene failed' })
    }
    return
  }

  json(res, 404, { ok: false, message: 'Not found' })
})

server.listen(PORT, HOST, () => {
  console.log(`X18 bridge listening on http://${HOST}:${PORT}`)
})
