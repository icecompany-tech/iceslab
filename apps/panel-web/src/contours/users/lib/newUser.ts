const USERNAME = /^[a-zA-Z0-9_-]{3,64}$/

/** The server's rule (users.schemas.ts); its refusal stays the last word. */
export const usernameValid = (name: string) => USERNAME.test(name)

export function randomUsername(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(4))
  return `user-${[...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')}`
}
