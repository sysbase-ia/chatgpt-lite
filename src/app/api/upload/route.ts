import { mkdir, writeFile } from 'fs/promises'
import { join } from 'path'
import { NextResponse, type NextRequest } from 'next/server'
import { MAX_UPLOAD_SIZE_BYTES, formatBytesToMB } from '@/lib/upload-limits'

export const runtime = 'nodejs'

type UploadResponse = {
  success: true
  name: string
  mimeType: string
  sizeBytes: number
  localPath: string
}

const DEFAULT_UPLOAD_DIR = '/tmp/sysbase-web-chat/uploads'

function sanitizeSegment(raw: string): string {
  const safe = raw
    .trim()
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/^[_\-.]+|[_\-.]+$/g, '')
  return safe || 'file'
}

function sanitizeSessionID(raw: string): string {
  const safe = sanitizeSegment(raw).slice(0, 80)
  return safe || 'default'
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const formData = await req.formData()
    const fileValue = formData.get('file')
    const sessionIDRaw = formData.get('sessionId')

    if (!fileValue || typeof fileValue === 'string') {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 })
    }

    const file = fileValue
    if (file.size <= 0) {
      return NextResponse.json({ error: 'Empty file is not allowed' }, { status: 400 })
    }
    if (file.size > MAX_UPLOAD_SIZE_BYTES) {
      const sizeMB = formatBytesToMB(file.size)
      return NextResponse.json(
        { error: `File size (${sizeMB}MB) exceeds maximum allowed size of 100MB` },
        { status: 413 }
      )
    }

    const uploadRoot = process.env.WEB_CHAT_UPLOAD_DIR?.trim() || DEFAULT_UPLOAD_DIR
    const sessionID =
      typeof sessionIDRaw === 'string' && sessionIDRaw.trim() !== ''
        ? sanitizeSessionID(sessionIDRaw)
        : 'default'
    const uploadDir = join(uploadRoot, sessionID)
    await mkdir(uploadDir, { recursive: true })

    const baseName = sanitizeSegment(file.name || 'upload.bin')
    const storedName = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}_${baseName}`
    const localPath = join(uploadDir, storedName)

    const arrayBuffer = await file.arrayBuffer()
    await writeFile(localPath, Buffer.from(arrayBuffer))

    const body: UploadResponse = {
      success: true,
      name: file.name || baseName,
      mimeType: file.type || 'application/octet-stream',
      sizeBytes: file.size,
      localPath
    }
    return NextResponse.json(body)
  } catch (error) {
    console.error('[upload route] failed:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Upload failed' },
      { status: 500 }
    )
  }
}
