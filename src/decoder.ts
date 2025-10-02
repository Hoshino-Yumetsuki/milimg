import { Buffer } from 'buffer'

window.Buffer = Buffer

/**
 * Milimg file header structure
 */
export interface MilimgHeader {
  version: number
  width: number
  height: number
  colorPayload: Uint8Array
  alphaPayload?: Uint8Array
}

/**
 * Parse .milimg container file and extract metadata and compressed data blocks
 */
export function parseMilimgContainer(buffer: Buffer): MilimgHeader {
  let offset = 0

  // Check magic number
  const magic = buffer.subarray(offset, offset + 8).toString('ascii')
  offset += 8
  if (magic !== 'Milimg00') {
    throw new Error('File format error: invalid magic number')
  }

  // Read version (big-endian uint32)
  const version = buffer.readUInt32BE(offset)
  offset += 4
  if (version !== 0 && version !== 1) {
    throw new Error(`Unsupported version: ${version}`)
  }

  // Read width, height, color_payload_size (big-endian)
  const width = buffer.readUInt32BE(offset)
  offset += 4
  const height = buffer.readUInt32BE(offset)
  offset += 4
  const colorPayloadSize = Number(buffer.readBigUInt64BE(offset))
  offset += 8

  // Read color payload
  const colorPayload = buffer.subarray(offset, offset + colorPayloadSize)
  offset += colorPayloadSize

  // Read alpha payload if version 1
  let alphaPayload: Uint8Array | undefined
  if (version === 1) {
    const alphaPayloadSize = Number(buffer.readBigUInt64BE(offset))
    offset += 8
    alphaPayload = buffer.subarray(offset, offset + alphaPayloadSize)
  }

  return {
    version,
    width,
    height,
    colorPayload,
    alphaPayload
  }
}

/**
 * Decode AV1 frame using WebCodecs VideoDecoder
 */
async function decodeAV1Frame(payload: Uint8Array): Promise<VideoFrame | null> {
  if (!payload || payload.length === 0) {
    return null
  }

  return new Promise((resolve, reject) => {
    let decodedFrame: VideoFrame | null = null

    const decoder = new VideoDecoder({
      output: (frame) => {
        decodedFrame = frame
      },
      error: (error) => {
        reject(new Error(`VideoDecoder error: ${error.message}`))
      }
    })

    decoder.configure({
      codec: 'av01.0.04M.08', // AV1 Main Profile, Level 4.0
      optimizeForLatency: true
    })

    // Create EncodedVideoChunk from payload
    const chunk = new EncodedVideoChunk({
      type: 'key',
      timestamp: 0,
      data: payload
    })

    decoder.decode(chunk)

    // Flush and wait for decoding to complete
    decoder
      .flush()
      .then(() => {
        decoder.close()
        resolve(decodedFrame)
      })
      .catch(reject)
  })
}

/**
 * Convert VideoFrame to PNG using Canvas
 */
async function frameToPNG(frame: VideoFrame): Promise<Buffer> {
  const canvas = new OffscreenCanvas(frame.displayWidth, frame.displayHeight)
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    throw new Error('Failed to get canvas context')
  }

  ctx.drawImage(frame, 0, 0)

  const blob = await canvas.convertToBlob({ type: 'image/png' })
  const arrayBuffer = await blob.arrayBuffer()

  return Buffer.from(arrayBuffer)
}

/**
 * Combine RGB and Alpha frames into RGBA
 */
async function combineRGBAFrames(
  colorFrame: VideoFrame,
  alphaFrame: VideoFrame
): Promise<VideoFrame> {
  const width = colorFrame.displayWidth
  const height = colorFrame.displayHeight

  const canvas = new OffscreenCanvas(width, height)
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    throw new Error('Failed to get canvas context')
  }

  ctx.drawImage(colorFrame, 0, 0)
  const imageData = ctx.getImageData(0, 0, width, height)
  const data = imageData.data

  // Extract alpha channel from alpha frame
  const alphaCanvas = new OffscreenCanvas(width, height)
  const alphaCtx = alphaCanvas.getContext('2d')
  if (!alphaCtx) {
    throw new Error('Failed to get alpha canvas context')
  }
  alphaCtx.drawImage(alphaFrame, 0, 0)
  const alphaData = alphaCtx.getImageData(0, 0, width, height).data

  // Apply alpha channel (use R channel from alpha frame as alpha)
  for (let i = 0; i < data.length; i += 4) {
    data[i + 3] = alphaData[i] // Use R channel as alpha
  }

  ctx.putImageData(imageData, 0, 0)

  return new VideoFrame(canvas, {
    timestamp: 0,
    alpha: 'keep'
  })
}

/**
 * Main function: Decode milimg file and return PNG buffer
 */
export async function decodeMilimg(buffer: Buffer): Promise<Buffer> {
  const header = parseMilimgContainer(buffer)

  const colorFrame = await decodeAV1Frame(header.colorPayload)
  if (!colorFrame) {
    throw new Error('Failed to decode color frame')
  }

  let finalFrame = colorFrame

  // Decode and combine alpha frame if present
  if (header.version === 1 && header.alphaPayload) {
    const alphaFrame = await decodeAV1Frame(header.alphaPayload)
    if (alphaFrame) {
      finalFrame = await combineRGBAFrames(colorFrame, alphaFrame)
      colorFrame.close()
      alphaFrame.close()
    }
  }

  const pngBuffer = await frameToPNG(finalFrame)
  finalFrame.close()

  return pngBuffer
}
