import type { ReactNode } from 'react';
import { DISPLAY } from '@/contours/traffic/lib/colors';
import { Text, UnstyledButton } from '@mantine/core';
import { useRef } from 'react';
export function FileLink({
  label,
  title,
  tone,
  icon,
  onFile,
}: {
  label: string;
  title: string;
  tone: string;
  icon: ReactNode;
  onFile: (text: string) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={input}
        type="file"
        accept="application/json,.json"
        style={{ display: 'none' }}
        onChange={(e) => {
          const file = e.currentTarget.files?.[0];
          e.currentTarget.value = '';
          if (!file) return;
          void file.text().then(onFile);
        }}
      />
      <UnstyledButton
        type="button"
        title={title}
        onClick={() => input.current?.click()}
        style={{ display: 'flex', alignItems: 'center', gap: 7 }}
      >
        {icon}
        <Text style={{ fontFamily: DISPLAY, fontSize: 12, lineHeight: '16px', color: tone }}>{label}</Text>
      </UnstyledButton>
    </>
  );
}
