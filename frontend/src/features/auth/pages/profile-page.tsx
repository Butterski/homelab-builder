import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Page } from '../../../components/layout/page';
import { Button } from '../../../components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../../components/ui/dialog';
import { UserAvatar } from '../../../components/ui/user-avatar';
import { useAuth } from '../hooks/use-auth';
import { useBuilds } from '../../builder/api/use-builds';

export default function ProfilePage() {
  const { user, logout } = useAuth();
  const [showLogoutDialog, setShowLogoutDialog] = useState(false);

  const { data: builds } = useBuilds({ enabled: !!user });
  const projectCount = builds?.length ?? 0;

  const handleLogout = () => {
    logout();
    setShowLogoutDialog(false);
  };

  const facts = [
    { term: 'Name', value: user?.name },
    { term: 'Email', value: user?.email },
    { term: 'Projects', value: `${projectCount} ${projectCount === 1 ? 'project' : 'projects'}` },
    ...(user?.is_admin ? [{ term: 'Role', value: 'Admin of this instance' }] : []),
  ];

  return (
    <Page width="narrow">
      <header className="app-hero flex items-center gap-4">
        <UserAvatar name={user?.name} src={user?.avatar_url} className="size-14 text-lg" />
        <div className="min-w-0">
          <h1 className="truncate text-[1.75rem] font-semibold leading-tight tracking-[-0.02em]">
            {user?.name}
          </h1>
          <p className="truncate text-sm text-muted-foreground">{user?.email}</p>
        </div>
      </header>

      <dl className="grid text-sm">
        {facts.map(fact => (
          <div key={fact.term} className="flex justify-between gap-6 border-b py-3">
            <dt className="text-muted-foreground">{fact.term}</dt>
            <dd className="min-w-0 truncate text-right">{fact.value}</dd>
          </div>
        ))}
      </dl>

      <div className="flex flex-wrap items-center justify-between gap-3 border-b py-4">
        <div className="min-w-0">
          <p className="text-sm font-medium">Settings</p>
          <p className="text-sm text-muted-foreground">
            Theme, and access for MCP clients and the AI assistant.
          </p>
        </div>
        <Button variant="outline" asChild>
          <Link to="/settings">Open settings</Link>
        </Button>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 py-4">
        <div className="min-w-0">
          <p className="text-sm font-medium">Sign out</p>
          <p className="text-sm text-muted-foreground">
            You will need to sign in again to reach your projects.
          </p>
        </div>
        <Button variant="outline" onClick={() => setShowLogoutDialog(true)}>
          Sign Out
        </Button>
      </div>

      <Dialog open={showLogoutDialog} onOpenChange={setShowLogoutDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Sign out?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            You'll need to log back in to access your projects.
          </p>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setShowLogoutDialog(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleLogout}>
              Sign Out
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Page>
  );
}
