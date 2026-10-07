import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { configure, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';

const apiMock = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), del: vi.fn() }));
const toastMock = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
}));

vi.mock('@/lib/api', () => ({ api: apiMock, ApiError: class ApiError extends Error {} }));
vi.mock('@/features/builder/api/builds', () => ({
  buildApi: {
    list: vi.fn().mockResolvedValue([
      { id: 'build-1', name: 'Main Homelab' },
      { id: 'build-2', name: 'Future Upgrade' },
    ]),
  },
}));
vi.mock('sonner', () => ({ toast: toastMock }));

import { M75Q, makeItem } from '@/features/inventory/testing/items';
import { INTEGRATION, comparison, host } from '../testing/plan';
import { ProxmoxDialog } from './proxmox-dialog';

configure({ asyncUtilTimeout: 5000 });

const SECRET = '3f1c5d5e-0000-4000-8000-1234567890ab';
const FINGERPRINT =
  'AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89';
const CERTIFICATE = {
  fingerprint: FINGERPRINT,
  subject: 'CN=pve01.lan',
  issuer: 'CN=Proxmox Virtual Environment',
  not_after: '2027-10-07T00:00:00Z',
};
const SUMMARY = {
  version: '8.4.1',
  cluster: 'homelab',
  nodes: 3,
  nodes_online: 3,
  vms: 11,
  containers: 7,
  templates: 0,
};

type Server = {
  integrations: unknown[];
  availability: { enabled: boolean; live: boolean; allow_private: boolean; limit: number };
  plan: ReturnType<typeof comparison>;
};
let server: Server;

function Where() {
  const location = useLocation();
  return <output aria-label="location">{location.pathname + location.search}</output>;
}

function renderDialog(props: Partial<Parameters<typeof ProxmoxDialog>[0]> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onOpenChange = vi.fn();
  const onProposal = vi.fn();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/builder/build-1']}>
        <Routes>
          <Route
            path="*"
            element={
              <>
                {children}
                <Where />
              </>
            }
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
  render(
    <ProxmoxDialog
      open
      onOpenChange={onOpenChange}
      integrationId={null}
      openBuildId="build-1"
      onProposal={onProposal}
      {...props}
    />,
    { wrapper },
  );
  return { onOpenChange, onProposal };
}

beforeEach(() => {
  vi.clearAllMocks();
  server = {
    integrations: [],
    availability: { enabled: true, live: true, allow_private: true, limit: 5 },
    plan: comparison(),
  };
  apiMock.get.mockImplementation((path: string) =>
    Promise.resolve(
      path === '/api/inventory'
        ? { items: [M75Q, makeItem({ id: 'm920q', name: 'Lenovo M920q #2' })], limit: 500 }
        : { integrations: server.integrations, availability: server.availability },
    ),
  );
  apiMock.post.mockImplementation((path: string) => {
    if (path.endsWith('/reconcile')) return Promise.resolve(server.plan);
    return Promise.resolve({});
  });
});

describe('connecting Proxmox', () => {
  it('tries a connection, shows an unknown certificate for trust, and saves only what was tried', async () => {
    const user = userEvent.setup();
    renderDialog();
    const dialog = await screen.findByRole('dialog', { name: 'Connect Proxmox' });
    const test = await within(dialog).findByRole('button', { name: 'Test connection' });
    const save = within(dialog).getByRole('button', { name: 'Save and read the cluster' });
    expect(test).toBeDisabled();
    expect(save).toBeDisabled();

    await user.type(within(dialog).getByLabelText('Address'), 'https://192.168.10.11:8006');
    // Pasted the way Proxmox shows a new token: the id and the secret in one.
    await user.click(within(dialog).getByLabelText('Token ID'));
    await user.paste(`hlbuilder@pve!hlbuilder=${SECRET}`);
    expect(within(dialog).getByLabelText('Token ID')).toHaveValue('hlbuilder@pve!hlbuilder');
    expect(within(dialog).getByLabelText('Secret')).toHaveValue(SECRET);
    expect(within(dialog).getByLabelText('Secret')).toHaveAttribute('type', 'password');

    apiMock.post.mockResolvedValueOnce({
      ok: false,
      notes: [],
      error_kind: 'certificate',
      error: 'not trusted',
      certificate: CERTIFICATE,
    });
    await user.click(test);
    const warning = await within(dialog).findByRole('alert');
    expect(warning).toHaveTextContent('not signed by a public authority');
    expect(warning).toHaveTextContent(FINGERPRINT);
    expect(warning).toHaveTextContent('CN=pve01.lan');
    expect(save).toBeDisabled();
    expect(apiMock.post).toHaveBeenLastCalledWith('/api/integrations/test', {
      integration_id: undefined,
      base_url: 'https://192.168.10.11:8006',
      token_id: 'hlbuilder@pve!hlbuilder',
      secret: SECRET,
      tls_fingerprint: undefined,
    });

    // Trusting it tries again, now with that one certificate pinned.
    apiMock.post.mockResolvedValueOnce({
      ok: true,
      notes: [],
      summary: SUMMARY,
      certificate: CERTIFICATE,
    });
    await user.click(
      within(warning).getByRole('button', { name: 'Trust this certificate and try again' }),
    );
    expect(await within(dialog).findByRole('status')).toHaveTextContent(
      'Connected.Proxmox VE 8.4.1, cluster homelab, 3 nodes, 11 VMs, 7 containers',
    );
    expect(apiMock.post).toHaveBeenLastCalledWith(
      '/api/integrations/test',
      expect.objectContaining({ tls_fingerprint: FINGERPRINT }),
    );
    expect(save).toBeEnabled();

    // A changed address has not been tried.
    await user.type(within(dialog).getByLabelText('Address'), '1');
    expect(save).toBeDisabled();
    await user.type(within(dialog).getByLabelText('Address'), '{Backspace}');
    expect(save).toBeEnabled();

    const saved = { ...INTEGRATION, summary: SUMMARY };
    apiMock.post.mockImplementation((path: string) => {
      if (path === '/api/integrations') {
        server.integrations = [saved];
        return Promise.resolve(saved);
      }
      if (path.endsWith('/reconcile')) return Promise.resolve(server.plan);
      return Promise.resolve({});
    });
    await user.click(save);
    await waitFor(() =>
      expect(apiMock.post).toHaveBeenCalledWith('/api/integrations', {
        name: 'Proxmox',
        base_url: 'https://192.168.10.11:8006',
        token_id: 'hlbuilder@pve!hlbuilder',
        tls_fingerprint: FINGERPRINT,
        secret: SECRET,
      }),
    );
    // Connected: the dialog goes on to the hosts, and the secret is gone from the page.
    expect(await screen.findByRole('tab', { name: 'Hosts and inventory' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(document.body.innerHTML).not.toContain(SECRET);
  });

  it('says what went wrong in the words the server gives', async () => {
    const user = userEvent.setup();
    renderDialog();
    const dialog = await screen.findByRole('dialog');
    await user.type(
      await within(dialog).findByLabelText('Address'),
      'https://pve.example.com:8006',
    );
    await user.type(within(dialog).getByLabelText('Token ID'), 'root@pam!x');
    await user.type(within(dialog).getByLabelText('Secret'), 'wrong');
    apiMock.post.mockResolvedValueOnce({
      ok: false,
      notes: [],
      error_kind: 'auth',
      error: 'Proxmox refused the token.',
    });
    await user.click(within(dialog).getByRole('button', { name: 'Test connection' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'Proxmox refused the token.',
    );
  });

  it('offers a pasted export where the instance cannot reach a home network', async () => {
    const user = userEvent.setup();
    server.availability = { enabled: true, live: true, allow_private: false, limit: 5 };
    renderDialog();
    const dialog = await screen.findByRole('dialog');

    // The export is the way that works here, so it is what is shown first.
    const paste = await within(dialog).findByRole('button', { name: 'Paste an export' });
    expect(paste).toHaveAttribute('aria-pressed', 'true');
    expect(dialog).toHaveTextContent('pvesh get /cluster/resources --output-format json');
    const read = within(dialog).getByRole('button', { name: 'Read the export' });
    expect(read).toBeDisabled();

    await user.click(within(dialog).getByLabelText('Export'));
    await user.paste('[{"type":"node","node":"pve01"}]');
    await user.click(read);
    await waitFor(() =>
      expect(apiMock.post).toHaveBeenCalledWith('/api/integrations', {
        name: 'Proxmox',
        export: '[{"type":"node","node":"pve01"}]',
      }),
    );

    await user.click(within(dialog).getByRole('button', { name: 'Connect to the API' }));
    expect(dialog).toHaveTextContent('may not call private addresses');
  });

  it('reads exports only where no secret can be stored', async () => {
    server.availability = { enabled: true, live: false, allow_private: false, limit: 5 };
    renderDialog();
    const dialog = await screen.findByRole('dialog');
    expect(
      await within(dialog).findByRole('button', { name: 'Connect to the API' }),
    ).toBeDisabled();
    expect(dialog).toHaveTextContent('cannot keep a token secret');
  });

  it('says so where integrations are switched off', async () => {
    server.availability = { enabled: false, live: false, allow_private: false, limit: 5 };
    renderDialog();
    expect(
      await screen.findByText(/Integrations are turned off on this instance/),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText('Address')).not.toBeInTheDocument();
  });
});

describe('an integration that was read', () => {
  beforeEach(() => {
    server.integrations = [INTEGRATION];
  });

  it('shows what was read, and matches hosts to the inventory only when told to', async () => {
    const user = userEvent.setup();
    server.plan.hosts = [
      host({
        node: 'pve01',
        suggestions: [
          {
            item_id: 'm75q',
            item_name: 'Lenovo M75q #1',
            confidence: 98,
            reasons: [
              { signal: 'cpu', agrees: true, text: 'Same processor: Ryzen 5 PRO 4650GE.' },
              {
                signal: 'memory',
                agrees: true,
                text: 'Same memory: 32 GB (the host shows 31.2 GB).',
              },
            ],
          },
        ],
      }),
      host({ node: 'pve02', linked_item: { id: 'x', name: 'Lenovo M920q #1', type: 'minipc' } }),
      host({ node: 'pve03', online: false }),
    ];
    renderDialog({ integrationId: 'int-1' });
    const dialog = await screen.findByRole('dialog', { name: 'Homelab' });
    expect(dialog).toHaveTextContent(
      'Proxmox VE 8.4.1, cluster homelab, 2 nodes, 2 VMs, 3 containers',
    );
    expect(dialog).toHaveTextContent('https://192.168.10.11:8006');

    const first = (await within(dialog).findByRole('rowheader', { name: /pve01/ })).closest('tr')!;
    expect(first).toHaveTextContent('Lenovo M75q #1 98% match');
    expect(first).toHaveTextContent('Same processor: Ryzen 5 PRO 4650GE.');
    expect(first).toHaveTextContent('31.2 GB');
    // Nothing was linked by itself.
    expect(apiMock.post).not.toHaveBeenCalledWith(
      '/api/integrations/int-1/link',
      expect.anything(),
    );

    await user.click(within(first).getByRole('button', { name: 'Link' }));
    await waitFor(() =>
      expect(apiMock.post).toHaveBeenCalledWith('/api/integrations/int-1/link', {
        node: 'pve01',
        item_id: 'm75q',
      }),
    );

    // Another machine can be chosen by hand; a linked host can be unlinked.
    await user.selectOptions(within(first).getByLabelText('Choose another for pve01'), 'm920q');
    await waitFor(() =>
      expect(apiMock.post).toHaveBeenCalledWith('/api/integrations/int-1/link', {
        node: 'pve01',
        item_id: 'm920q',
      }),
    );
    const second = within(dialog).getByRole('rowheader', { name: /pve02/ }).closest('tr')!;
    await user.click(within(second).getByRole('button', { name: 'Unlink' }));
    await waitFor(() =>
      expect(apiMock.post).toHaveBeenCalledWith('/api/integrations/int-1/link', {
        node: 'pve02',
        item_id: null,
      }),
    );

    // A host nothing looks like becomes an item, which then asks what machine it is.
    const third = within(dialog).getByRole('rowheader', { name: /pve03/ }).closest('tr')!;
    expect(third).toHaveTextContent('Offline');
    expect(third).toHaveTextContent('Nothing in your inventory looks like this machine.');
    apiMock.post.mockResolvedValueOnce(
      makeItem({ id: 'new', name: 'pve03', type: 'server_v2', status: 'in_use' }),
    );
    await user.click(within(third).getByRole('button', { name: 'Add to inventory' }));
    await waitFor(() =>
      expect(apiMock.post).toHaveBeenCalledWith('/api/integrations/int-1/inventory', {
        node: 'pve03',
      }),
    );
    expect(await screen.findByRole('dialog', { name: 'Edit item' })).toBeInTheDocument();
  });

  it('compares with the open project and imports the chosen differences as a proposal', async () => {
    const user = userEvent.setup();
    const { onProposal, onOpenChange } = renderDialog({ integrationId: 'int-1' });
    const dialog = await screen.findByRole('dialog', { name: 'Homelab' });
    await user.click(await within(dialog).findByRole('tab', { name: 'Compare and import' }));

    // The open project is what is compared first.
    expect(await within(dialog).findByLabelText('Compare with')).toHaveValue('build-1');
    await within(dialog).findByText('2 on both sides, 3 only on Proxmox, 1 only in the plan');
    expect(apiMock.post).toHaveBeenCalledWith('/api/integrations/int-1/reconcile', {
      build_id: 'build-1',
      hosts: {},
    });

    const pve01 = within(dialog).getByRole('heading', { name: /pve01/ }).closest('section')!;
    // Planned beside real, and the difference offered, not taken.
    expect(within(pve01).getByRole('row', { name: /Memory/ })).toHaveTextContent(
      'Memory16 GB31.2 GBDiffers',
    );
    expect(within(pve01).getByRole('row', { name: /Storage/ })).toHaveTextContent('Same');
    expect(within(pve01).getByLabelText('Write the real figures into the plan')).toBeChecked();

    const row = (name: RegExp) => within(pve01).getByRole('rowheader', { name }).closest('tr')!;
    expect(row(/homeassistant/)).toHaveTextContent('On both');
    expect(row(/homeassistant/)).toHaveTextContent('planned as Home Assistant');
    expect(row(/homeassistant/)).toHaveTextContent('Take the real size');
    expect(row(/pihole/)).toHaveTextContent('In the plan already');
    expect(within(row(/pihole/)).queryByRole('checkbox')).not.toBeInTheDocument();
    expect(row(/grafana/)).toHaveTextContent('Add to the plan');
    // A stopped guest and a planned one that is not there are left as they are.
    expect(row(/docker/)).toHaveTextContent('Leave out');
    expect(row(/Jellyfin/)).toHaveTextContent('Keep planned');
    expect(pve01).toHaveTextContent(
      'may well run as a container inside one of the virtual machines',
    );
    // The headroom the plan leaves, beside what is left as the host runs.
    expect(pve01).toHaveTextContent('Memory left free: 79% by the plan, 79% as it runs');
    const pve02 = within(dialog).getByRole('heading', { name: /pve02/ }).closest('section')!;
    expect(pve02).toHaveTextContent('Memory left free: 49% as it runs');

    expect(dialog).toHaveTextContent(
      '1 host added, 1 host updated, 2 guests added, 1 guest updated',
    );
    await user.click(within(row(/docker/)).getByRole('checkbox'));
    await user.click(within(row(/Jellyfin/)).getByRole('checkbox'));
    expect(row(/Jellyfin/)).toHaveTextContent('Remove from the plan');
    expect(dialog).toHaveTextContent(
      '1 host added, 1 host updated, 3 guests added, 1 guest updated, 1 guest removed',
    );

    apiMock.post.mockImplementation((path: string) =>
      Promise.resolve(
        path.endsWith('/import')
          ? {
              outcome: 'proposal',
              build_id: 'build-1',
              proposal_id: 'prop-1',
              summary: 'Import from Homelab',
              addresses_left_out: true,
            }
          : server.plan,
      ),
    );
    await user.click(within(dialog).getByRole('button', { name: 'Review on the canvas' }));
    await waitFor(() => expect(onProposal).toHaveBeenCalledWith('prop-1'));
    expect(apiMock.post).toHaveBeenCalledWith('/api/integrations/int-1/import', {
      build_id: 'build-1',
      build_name: undefined,
      hosts: {},
      use_actual_specs: ['pve01'],
      add_guests: [102, 103, 110],
      update_guests: [100],
      remove_guests: ['g-jf'],
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(toastMock.info).toHaveBeenCalledWith(
      expect.stringContaining('keeps its own address plan'),
    );
  });

  it('asks again when the owner says which device a host is, and leaves a host out on request', async () => {
    const user = userEvent.setup();
    renderDialog({ integrationId: 'int-1' });
    const dialog = await screen.findByRole('dialog', { name: 'Homelab' });
    await user.click(await within(dialog).findByRole('tab', { name: 'Compare and import' }));
    const pve02 = (await within(dialog).findByRole('heading', { name: /pve02/ })).closest(
      'section',
    )!;

    const choice = within(pve02).getByLabelText('In the plan this is');
    expect(choice).toHaveValue('new');
    // A device that is another host already cannot be chosen twice.
    expect(within(choice).getByRole('option', { name: 'M75q (Mini PC)' })).toBeDisabled();
    await user.selectOptions(choice, 'node-2');
    await waitFor(() =>
      expect(apiMock.post).toHaveBeenCalledWith('/api/integrations/int-1/reconcile', {
        build_id: 'build-1',
        hosts: { pve02: 'node-2' },
      }),
    );
  });

  it('makes a new project from what runs and opens it', async () => {
    const user = userEvent.setup();
    const { onProposal } = renderDialog({ integrationId: 'int-1' });
    const dialog = await screen.findByRole('dialog', { name: 'Homelab' });
    await user.click(await within(dialog).findByRole('tab', { name: 'Compare and import' }));

    const fresh = comparison();
    fresh.build = null;
    fresh.candidates = [];
    fresh.hosts = [host({ node: 'pve01' })];
    fresh.counts = { matched: 0, differing: 0, discovered: 0, missing: 0 };
    server.plan = fresh;
    await user.selectOptions(await within(dialog).findByLabelText('Compare with'), 'new');
    await user.type(await within(dialog).findByLabelText('Its name'), 'What I run');

    apiMock.post.mockImplementation((path: string) =>
      Promise.resolve(
        path.endsWith('/import')
          ? {
              outcome: 'build',
              build_id: 'build-9',
              summary: 'Import from Homelab: 1 host added',
              addresses_left_out: false,
              addresses_in_pool: 2,
            }
          : server.plan,
      ),
    );
    await user.click(await within(dialog).findByRole('button', { name: 'Create the project' }));
    await waitFor(() =>
      expect(screen.getByLabelText('location')).toHaveTextContent('/builder/build-9'),
    );
    // Addresses the new router hands out by DHCP are not pinned, and the owner is told.
    expect(toastMock.info).toHaveBeenCalledWith(
      expect.stringContaining("2 real addresses lie in the DHCP range of the project's router"),
    );
    expect(apiMock.post).toHaveBeenCalledWith(
      '/api/integrations/int-1/import',
      expect.objectContaining({ build_id: null, build_name: 'What I run' }),
    );
    expect(onProposal).not.toHaveBeenCalled();
  });

  it('opens another project on its proposal, and says when there is nothing to import', async () => {
    const user = userEvent.setup();
    const { onProposal, onOpenChange } = renderDialog({ integrationId: 'int-1' });
    const dialog = await screen.findByRole('dialog', { name: 'Homelab' });
    await user.click(await within(dialog).findByRole('tab', { name: 'Compare and import' }));
    await within(dialog).findByText(/on both sides/);

    apiMock.post.mockImplementation((path: string) =>
      Promise.resolve(
        path.endsWith('/import')
          ? {
              outcome: 'nothing',
              summary: 'The plan already says what the cluster runs.',
              addresses_left_out: false,
            }
          : server.plan,
      ),
    );
    await user.click(within(dialog).getByRole('button', { name: 'Review on the canvas' }));
    await waitFor(() =>
      expect(toastMock.info).toHaveBeenCalledWith('The plan already says what the cluster runs.'),
    );
    expect(onOpenChange).not.toHaveBeenCalled();

    // The other project is opened with its proposal up for review.
    await user.selectOptions(within(dialog).getByLabelText('Compare with'), 'build-2');
    apiMock.post.mockImplementation((path: string) =>
      Promise.resolve(
        path.endsWith('/import')
          ? {
              outcome: 'proposal',
              build_id: 'build-2',
              proposal_id: 'prop-2',
              summary: 'Import',
              addresses_left_out: false,
            }
          : server.plan,
      ),
    );
    await user.click(await within(dialog).findByRole('button', { name: 'Review on the canvas' }));
    await waitFor(() =>
      expect(screen.getByLabelText('location')).toHaveTextContent(
        '/builder/build-2?proposal=prop-2',
      ),
    );
    expect(onProposal).not.toHaveBeenCalled();
  });

  it('refuses an import that is too large for one proposal', async () => {
    const user = userEvent.setup();
    server.plan.operation_limit = 3;
    renderDialog({ integrationId: 'int-1' });
    const dialog = await screen.findByRole('dialog', { name: 'Homelab' });
    await user.click(await within(dialog).findByRole('tab', { name: 'Compare and import' }));
    expect(
      await within(dialog).findByText(/One import holds 3 changes and this is 6/),
    ).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Review on the canvas' })).toBeDisabled();
  });

  it('reads the cluster again, and removes the integration after asking', async () => {
    const user = userEvent.setup();
    const { onOpenChange } = renderDialog({ integrationId: 'int-1' });
    const dialog = await screen.findByRole('dialog', { name: 'Homelab' });

    apiMock.post.mockResolvedValueOnce(INTEGRATION);
    await user.click(await within(dialog).findByRole('button', { name: 'Read again' }));
    await waitFor(() =>
      expect(apiMock.post).toHaveBeenCalledWith('/api/integrations/int-1/sync', {}),
    );

    await user.click(within(dialog).getByRole('tab', { name: 'Connection' }));
    // The stored secret is kept unless a new one is typed, and never shown.
    expect(within(dialog).getByLabelText('Secret')).toHaveValue('');
    expect(within(dialog).getByLabelText('Secret')).toHaveAttribute(
      'placeholder',
      'Stored. Leave empty to keep it.',
    );
    expect(within(dialog).getByLabelText('Token ID')).toHaveValue('hlbuilder@pve!hlbuilder');

    apiMock.del.mockResolvedValue({});
    await user.click(within(dialog).getByRole('button', { name: 'Remove this integration' }));
    const confirm = await screen.findByRole('dialog', { name: 'Remove Homelab?' });
    await user.click(within(confirm).getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(apiMock.del).toHaveBeenCalledWith('/api/integrations/int-1'));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });
});
