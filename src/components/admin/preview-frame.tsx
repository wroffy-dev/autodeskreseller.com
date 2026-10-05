'use client';

import * as React from 'react';
import { Monitor, Tablet, Smartphone, RotateCw, ExternalLink, Globe } from 'lucide-react';
import { cn } from '@/lib/utils/cn';

/**
 * Device widths used by the preview. They match the breakpoints the section
 * design panel writes, so what an admin sees here is what the responsive CSS
 * actually does.
 */
const DEVICES = [
  { id: 'desktop', label: 'Desktop', icon: Monitor, width: null },
  { id: 'tablet', label: 'Tablet', icon: Tablet, width: 900 },
  { id: 'mobile', label: 'Mobile', icon: Smartphone, width: 420 },
] as const;

type DeviceId = (typeof DEVICES)[number]['id'];

/**
 * Responsive preview shell.
 *
 * The page renders inside an iframe rather than in this document, so the
 * tablet/mobile widths trigger the real CSS media queries instead of merely
 * looking narrower.
 */
export function PreviewFrame({
  src,
  title,
  publicPath,
  compact = false,
}: {
  src: string;
  title: string;
  /** Live URL, shown as "Open website" when the page is published. */
  publicPath?: string;
  /** Denser chrome for the page builder's centre column. */
  compact?: boolean;
}) {
  const [device, setDevice] = React.useState<DeviceId>('desktop');
  const [nonce, setNonce] = React.useState(0);

  const active = DEVICES.find((d) => d.id === device)!;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-hairline bg-surface px-4 py-2.5">
        <div className="flex items-center gap-1 rounded-lg bg-muted/[0.06] p-1">
          {DEVICES.map((option) => {
            const Icon = option.icon;
            return (
              <button
                key={option.id}
                type="button"
                onClick={() => setDevice(option.id)}
                aria-pressed={device === option.id}
                title={option.width ? `${option.label} — ${option.width}px` : option.label}
                className={cn(
                  'flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors',
                  device === option.id
                    ? 'bg-surface text-content shadow-sm'
                    : 'text-muted hover:text-content',
                )}
              >
                <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                {option.label}
              </button>
            );
          })}
        </div>

        <span className="text-xs text-muted">
          {active.width ? `${active.width}px wide` : 'Full width'}
        </span>

        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            onClick={() => setNonce((n) => n + 1)}
            className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-muted transition-colors hover:text-content"
          >
            <RotateCw className="h-3.5 w-3.5" aria-hidden="true" />
            Refresh
          </button>
          <a
            href={src}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-muted transition-colors hover:text-content"
          >
            <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
            {compact ? 'Full preview' : 'Open in a tab'}
          </a>
          {publicPath ? (
            <a
              href={publicPath}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-muted transition-colors hover:text-content"
            >
              <Globe className="h-3.5 w-3.5" aria-hidden="true" />
              Website
            </a>
          ) : null}
        </div>
      </div>

      <div
        className={cn(
          'flex min-h-0 flex-1 justify-center overflow-auto bg-muted/[0.08]',
          compact ? 'p-2' : 'p-4',
        )}
      >
        <iframe
          key={`${device}-${nonce}`}
          src={src}
          title={title}
          className={cn(
            // The public site inside the frame: never recoloured by dark mode.
            'ui-keep-white h-full w-full border-0 bg-white',
            compact ? 'min-h-[26rem]' : 'min-h-[70vh]',
            active.width && 'rounded-xl border border-hairline shadow-xl',
          )}
          style={active.width ? { maxWidth: active.width } : undefined}
        />
      </div>
    </div>
  );
}
