'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { PlugZap, Send, RotateCcw, UploadCloud } from 'lucide-react';
import {
  queueExistingLeads,
  retryFailedCrmLeads,
  sendCrmBatch,
  testCrmConnection,
} from '@/lib/actions/crm-sync';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ConfirmDialog } from '@/components/ui/dialog';
import { Alert } from '@/components/ui/states';
import { useToast } from '@/components/ui/toast';
import { StatCard } from '@/components/admin/stat-card';
import { formatRelative } from '@/lib/utils/format';

export type CrmSyncPanelData = {
  configured: boolean;
  endpointHost: string | null;
  keyId: string | null;
  counts: { synced: number; routed: number; pending: number; failed: number; unsent: number };
  recentFailures: Array<{
    id: string;
    reference: number;
    name: string;
    error: string | null;
    createdAt: string;
  }>;
};

/** Settings → CRM integration: connection, queue and failures. */
export function CrmSyncPanel({ data }: { data: CrmSyncPanelData }) {
  const router = useRouter();
  const { toast } = useToast();
  const [busy, setBusy] = React.useState<string | null>(null);
  const [confirmBackfill, setConfirmBackfill] = React.useState(false);

  async function run(
    key: string,
    action: () => Promise<{ ok: boolean; error?: string; message?: string }>,
  ) {
    setBusy(key);
    const result = await action();
    setBusy(null);
    toast(
      result.ok ? (result.message ?? 'Done.') : (result.error ?? 'Something went wrong.'),
      result.ok ? 'success' : 'error',
    );
    router.refresh();
  }

  const { counts } = data;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader
          title="Connection"
          description="Leads are sent with this website's own key, from the server — never from the browser."
          actions={
            data.configured ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => run('test', testCrmConnection)}
                disabled={busy !== null}
              >
                <PlugZap className="h-4 w-4" aria-hidden="true" />
                {busy === 'test' ? 'Testing…' : 'Test connection'}
              </Button>
            ) : null
          }
        />
        <CardBody className="space-y-4 text-sm">
          <dl className="grid gap-3 sm:grid-cols-3">
            <div>
              <dt className="text-xs text-muted">Status</dt>
              <dd className="mt-1">
                {data.configured ? (
                  <Badge tone="success">Configured</Badge>
                ) : (
                  <Badge tone="neutral">Off</Badge>
                )}
              </dd>
            </div>
            <div className="min-w-0">
              <dt className="text-xs text-muted">Endpoint</dt>
              <dd className="mt-1 break-all font-mono text-xs text-content">
                {data.endpointHost ?? '—'}
              </dd>
            </div>
            <div className="min-w-0">
              <dt className="text-xs text-muted">Key ID</dt>
              <dd className="mt-1 break-all font-mono text-xs text-content">{data.keyId ?? '—'}</dd>
            </div>
          </dl>

          {data.configured ? null : (
            <Alert tone="info" title="Switch it on from the server's environment">
              Create a key for this website in Deskzo under <em>Settings → Lead capture API</em>,
              then set <code className="font-mono">DESKZO_KEY_ID</code> and{' '}
              <code className="font-mono">DESKZO_SECRET</code> in the deployment&apos;s environment
              and restart. The secret is never stored in the database or shown here.
            </Alert>
          )}
        </CardBody>
      </Card>

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <StatCard
          label="In the CRM"
          value={counts.synced}
          tone={counts.synced > 0 ? 'success' : 'default'}
          hint={counts.routed > 0 ? `+ ${counts.routed} routed to resellers` : 'Sent and accepted'}
        />
        <StatCard
          label="Waiting"
          value={counts.pending}
          tone={counts.pending > 0 ? 'brand' : 'default'}
          hint="Queued or retrying"
        />
        <StatCard
          label="Failed"
          value={counts.failed}
          tone={counts.failed > 0 ? 'danger' : 'default'}
          hint="Need a look"
        />
        <StatCard label="Never sent" value={counts.unsent} hint="From before the integration" />
      </div>

      <Card>
        <CardHeader
          title="Queue"
          description="A lead the CRM cannot take straight away is retried after 1, 2, 4, 8… minutes, up to six hours apart, twelve times."
        />
        <CardBody className="flex flex-wrap gap-2">
          <Button
            onClick={() => run('batch', sendCrmBatch)}
            disabled={!data.configured || busy !== null || counts.pending === 0}
          >
            <Send className="h-4 w-4" aria-hidden="true" />
            {busy === 'batch' ? 'Sending…' : 'Send due leads now'}
          </Button>
          <Button
            variant="outline"
            onClick={() => run('retry', retryFailedCrmLeads)}
            disabled={!data.configured || busy !== null || counts.failed === 0}
          >
            <RotateCcw className="h-4 w-4" aria-hidden="true" />
            Retry failed ({counts.failed})
          </Button>
          <Button
            variant="outline"
            onClick={() => setConfirmBackfill(true)}
            disabled={!data.configured || busy !== null || counts.unsent === 0}
          >
            <UploadCloud className="h-4 w-4" aria-hidden="true" />
            Send existing leads ({counts.unsent})
          </Button>
        </CardBody>
      </Card>

      {data.recentFailures.length > 0 ? (
        <Card>
          <CardHeader
            title="Recent failures"
            description="Open a lead to send it again on its own."
          />
          <ul className="divide-y divide-hairline">
            {data.recentFailures.map((lead) => (
              <li key={lead.id}>
                <Link
                  href={`/admin/leads/${lead.id}`}
                  className="block px-4 py-3 transition-colors hover:bg-muted/[0.04] sm:px-5"
                >
                  <span className="flex items-baseline justify-between gap-3">
                    <span className="min-w-0 truncate text-sm font-medium text-content">
                      #{lead.reference} {lead.name}
                    </span>
                    <span className="shrink-0 text-xs text-muted">
                      received {formatRelative(lead.createdAt)}
                    </span>
                  </span>
                  <span className="mt-0.5 block break-words text-xs text-red-700">
                    {lead.error ?? 'Unknown error'}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <Card>
        <CardHeader
          title="Automatic retries"
          description="New leads are sent the moment they arrive. Retries also run then, but a scheduler makes them dependable."
        />
        <CardBody className="space-y-2 text-sm text-muted">
          <p>
            Call this every five minutes from Coolify&apos;s scheduled tasks or a crontab, with the
            same <code className="font-mono">CRON_SECRET</code> as scheduled backups:
          </p>
          <pre className="scroll-x rounded-lg border border-hairline bg-muted/[0.05] p-3 font-mono text-xs text-content">
            {`curl -fsS -X POST -H "Authorization: Bearer $CRON_SECRET" \\\n  https://<your-site>/api/internal/cron/crm-sync`}
          </pre>
        </CardBody>
      </Card>

      <ConfirmDialog
        open={confirmBackfill}
        onClose={() => setConfirmBackfill(false)}
        onConfirm={async () => {
          setConfirmBackfill(false);
          await run('backfill', queueExistingLeads);
        }}
        title={`Send ${counts.unsent} existing ${counts.unsent === 1 ? 'lead' : 'leads'} to Deskzo?`}
        message="Every lead not yet sent is queued, except deleted ones and leads marked as spam. Deskzo scores and assigns each one as it arrives. They go in batches of 25 — use “Send due leads now” or the scheduler."
        confirmLabel="Queue them"
        tone="primary"
        pending={busy === 'backfill'}
      />
    </div>
  );
}
