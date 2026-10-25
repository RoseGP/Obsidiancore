export const ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/csv',
  'text/plain',
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/svg+xml'
]);

export const ALLOWED_EXTENSIONS = new Set([
  'pdf', 'doc', 'docx', 'xls', 'xlsx', 'csv', 'txt', 'png', 'jpg', 'jpeg', 'webp', 'svg'
]);

export const BLOCKED_EXTENSIONS = new Set([
  'exe', 'bat', 'sh', 'php', 'js', 'py', 'cmd', 'vbs', 'msi', 'bin'
]);

export const MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024; // 25 MB
