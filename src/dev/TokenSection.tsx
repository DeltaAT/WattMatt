import { type ReactNode } from 'react';

interface TokenSectionProps {
  readonly title: string;
  readonly subtitle?: string | undefined;
  readonly children: ReactNode;
}

/** One labelled block on the `/tokens` review page. */
export function TokenSection({ title, subtitle, children }: TokenSectionProps) {
  return (
    <section className="flex flex-col gap-4">
      <header className="border-wm-border flex flex-col gap-1 border-b pb-2">
        <h2 className="text-host-xl text-wm-text wm-display font-bold">{title}</h2>
        {subtitle !== undefined && <p className="text-host-sm text-wm-text-muted">{subtitle}</p>}
      </header>
      {children}
    </section>
  );
}
