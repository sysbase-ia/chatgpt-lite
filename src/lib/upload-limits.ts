export const MAX_UPLOAD_SIZE_BYTES = 100 * 1024 * 1024 // 100MB
export const MAX_INLINE_IMAGE_SIZE_BYTES = 5 * 1024 * 1024 // 5MB
export const MAX_PARSEABLE_FILE_SIZE_BYTES = 12 * 1024 * 1024 // 12MB

export function formatBytesToMB(bytes: number): string {
  return (bytes / (1024 * 1024)).toFixed(2)
}
