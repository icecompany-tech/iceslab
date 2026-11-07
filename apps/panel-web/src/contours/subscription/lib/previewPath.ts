/**
 * The server writes the preview link from PUBLIC_URL, which need not be the address the operator
 * opened the panel by (an IP, a second name, a dev port), and the panel's CSP allows frames from
 * itself only. The page lives under the panel's own /api, so the path is what is framed.
 */
export function previewPath(url: string): string {
  try {
    const parsed = new URL(url, 'http://panel.invalid')
    return `${parsed.pathname}${parsed.search}`
  } catch {
    return url
  }
}
