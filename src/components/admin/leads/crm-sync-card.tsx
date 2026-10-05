'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Send } from 'lucide-react';
import type { CrmSyncStatus } from '@prisma/client';
import { sendLeadToCrm } from '@/lib/actions/crm-sync';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { formatDate, formatRelative } from '@/lib/utils/format';

export type CrmSyncView = {
  status: CrmSyncStatus | null;
  reference: string | null;
  syncedAt: string | null;
  lastError: string | null;
  attempts: number;
  nextAttemptAt: string | null;
};

const STATUS: Record<CrmSyncStatus | 'NONE', { label: string; tone: BadgeTone }> = {
  SYNCED: { label: 'In the CRM', tone: 'success' },
  ROUTED: { label: 'Routed to a reseller', tone: 'info' },
  PENDING: { label: 'Waiting to send', tone: 'warning' },
  FAILED: { label: 'Not sent', tone: 'danger' },
  NONE: { label: 'Never sent', tone: 'neutral' },
};

/** Where this lead stands in the Deskzo CRM, with a way to send it now. */
export function CrmSyncCard({
  leadId,
  sync,
  configured,
  canSend,
}: {
  leadId: string;
  sync: CrmSyncView;
  configured: boolean;
  canSend: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [busy, setBusy] = React.useState(false);
  const state = STATUS[sync.status ?? 'NONE'];

  const send = async () => {
    setBusy(true);
    const result = await sendLeadToCrm(leadId);
    setBusy(false);
    toast(
      result.ok ? (result.message ?? 'Sent.') : (result.error ?? 'Could not send.'),
      result.ok ? 'success' : 'error',
    );
    router.refresh();
  };

  const label =
    sync.status === 'SYNCED' || sync.status === 'ROUTED'
      ? 'Send again'
      : sync.status === 'PENDING' || sync.status === 'FAILED'
        ? 'Retry now'
        : 'Send to CRM';

  return (
    <Card>
      <CardHeader title="Deskzo CRM" />
      <CardBody className="space-y-3 text-sm">
        <div className="flex items-start justify-between gap-3">
          <span className="text-muted">Status</span>
          <Badge tone={state.tone}>{state.label}</Badge>
        </div>
        {sync.reference ? (
          <div className="flex items-start justify-between gap-3">
            <span className="text-muted">CRM reference</span>
            <span className="font-mono text-xs text-content">{sync.reference}</span>
          </div>
        ) : null}
        {sync.syncedAt ? (
          <div className="flex items-start justify-between gap-3">
            <span className="text-muted">Sent</span>
            <span className="text-right text-content">{formatDate(sync.syncedAt, true)}</span>
          </div>
        ) : null}
        {sync.status === 'PENDING' && sync.nextAttemptAt && sync.attempts > 0 ? (
          <div className="flex items-start justify-between gap-3">
            <span className="text-muted">Next try</span>
            <span className="text-right text-content">
              {formatRelative(sync.nextAttemptAt)} · attempt {sync.attempts + 1}
            </span>
          </div>
        ) : null}
        {sync.lastError && sync.status !== 'SYNCED' && sync.status !== 'ROUTED' ? (
          <p className="break-words rounded-lg bg-red-50 px-3 py-2 text-xs text-red-800">
            {sync.lastError}
          </p>
        ) : null}

        {canSend && configured ? (
          <Button variant="outline" size="sm" className="w-full" onClick={send} disabled={busy}>
            <Send className="h-4 w-4" aria-hidden="true" />
            {busy ? 'Sending…' : label}
          </Button>
        ) : null}
        {!configured ? (
          <p className="text-xs text-muted">The CRM integration is off on this deployment.</p>
        ) : null}
      </CardBody>
    </Card>
  );
}
