import { createContext, useContext, useEffect } from 'react';

/**
 * Facts the active page contributes to the topbar line, appended after the
 * breadcrumb: `/ USERS · 36 ACCOUNTS · 21 ACTIVE`. The page owns the numbers
 * (it already fetched them), the layout owns the typography, so neither has to
 * know about the other beyond this list of strings.
 *
 * Pages call `usePageMeta([...])`; the facts clear on unmount, so a page that
 * says nothing simply leaves the breadcrumb alone.
 *
 * Хуки и контекст живут ЗДЕСЬ, а провайдер в своём `.tsx` рядом. Причина не
 * вкусовая: файл с компонентом, который экспортирует ещё и хуки, ломает
 * hot-reload, потому что сборщик не может обновить компонент, не тронув всё
 * остальное из того же файла. Шестнадцать экранов импортируют `usePageMeta` по
 * пути без расширения, поэтому разрез им не виден.
 */

export type PageMetaValue = {
  facts: string[];
  setFacts: (facts: string[]) => void;
};

export const PageMetaContext = createContext<PageMetaValue | null>(null);

/** Read the current facts. Layout side. */
export function usePageMetaFacts(): string[] {
  return useContext(PageMetaContext)?.facts ?? [];
}

/**
 * Publish this page's facts. Falsy entries are dropped, so a caller can pass
 * `count > 0 ? '...' : null` without branching on the array itself.
 */
export function usePageMeta(facts: Array<string | false | null | undefined>): void {
  const ctx = useContext(PageMetaContext);
  const setFacts = ctx?.setFacts;
  // Compare by content, not identity: callers build the array inline on every
  // render, and an identity-keyed effect would loop through setState forever.
  // JSON is the key so facts keep their own spaces and punctuation.
  const key = JSON.stringify(facts.filter(Boolean));

  useEffect(() => {
    if (!setFacts) return;
    setFacts(JSON.parse(key) as string[]);
    return () => setFacts([]);
  }, [setFacts, key]);
}
