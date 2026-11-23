import { useCallback, useState } from 'react'

/** Native modal dialogs make portals mounted on document.body inert. */
export function useDialogPortal() {
  const [container, setContainer] = useState<HTMLDialogElement | null>(null)
  const attach = useCallback((el: HTMLElement | null) => setContainer(el?.closest('dialog') ?? null), [])
  return { attach, container: container ?? undefined }
}
