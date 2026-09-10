export function ColHead({
  children,
  className,
  flex,
}: {
  children: ReactNode;
  className?: string;
  flex?: boolean;
}) {
  return (
    <Text
      className={className}
      style={{
        fontFamily: MONO,
        fontSize: 10,
        letterSpacing: '0.12em',
        lineHeight: '12px',
        textTransform: 'uppercase',
        color: MIST,
        flex: flex ? 1 : undefined,
        minWidth: flex ? 0 : undefined,
      }}
    >
      {children}
    </Text>
  );
}
