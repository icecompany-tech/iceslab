import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { PageMetaContext } from '@/lib/ui/usePageMeta';

/**
 * Держит факты, которые активная страница дописывает в строку крошек.
 *
 * Отдельный файл от хуков: компонент, живущий рядом с экспортом хука, лишает
 * себя hot-reload, потому что сборщик не умеет обновить один экспорт файла, не
 * трогая остальные.
 */
export function PageMetaProvider({ children }: { children: ReactNode }) {
  const [facts, setFacts] = useState<string[]>([]);
  const value = useMemo(() => ({ facts, setFacts }), [facts]);
  return <PageMetaContext.Provider value={value}>{children}</PageMetaContext.Provider>;
}
