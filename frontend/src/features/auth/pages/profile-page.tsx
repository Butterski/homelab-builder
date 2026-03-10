import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../admin/hooks/use-auth';
import { buildApi } from '../../builder/api/builds';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card';
import { Button } from '../../../components/ui/button';
import { LogOut, User, Mail, FolderOpen, ChevronLeft, Shield } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '../../../components/ui/dialog';
import { ThemeSettingsCard } from '../components/theme-settings-card';

export default function ProfilePage() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [showLogoutDialog, setShowLogoutDialog] = useState(false);

  const { data: builds } = useQuery({
    queryKey: ['builds-count'],
    queryFn: () => buildApi.list(),
    enabled: !!user,
  });

  const projectCount = builds?.length ?? 0;

  const avatarUrl =
    user?.avatar_url ||
    `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(user?.email ?? 'user')}`;

  const handleLogout = () => {
    logout();
    setShowLogoutDialog(false);
  };

  return (
    <div className="flex flex-col min-h-screen bg-background p-6">
      {/* Back button */}
      <button
        onClick={() => navigate(-1)}
        className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-8 w-fit hover:cursor-pointer"
      >
        <ChevronLeft className="h-4 w-4" />
        Back
      </button>

      <div className="max-w-4xl mx-auto w-full space-y-6">
        {/* Avatar + Name */}
        <Card className="overflow-hidden">
          <div className="h-24 bg-linear-to-br from-primary/30 via-primary/10 to-background" />
          <CardContent className="pt-0 pb-6 relative">
            <div className="flex items-end gap-4 -mt-12">
              <div className="rounded-full border-4 border-background overflow-hidden h-20 w-20 shrink-0 bg-muted">
                <img
                  src={avatarUrl}
                  alt={user?.name}
                  className="h-full w-full object-cover"
                  onError={e => {
                    (e.target as HTMLImageElement).src =
                      `https://api.dicebear.com/7.x/initials/svg?seed=${user?.name}`;
                  }}
                />
              </div>
              <div className="pb-1 min-w-0">
                <h1 className="text-xl font-bold truncate">{user?.name}</h1>
                {user?.is_admin && (
                  <div className="flex items-center gap-1 text-xs text-amber-500 font-medium mt-0.5">
                    <Shield className="h-3 w-3" />
                    Admin
                  </div>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Info grid */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
              Account Details
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-3">
              <div className="h-8 w-8 rounded-full bg-blue-500/10 flex items-center justify-center shrink-0">
                <User className="h-4 w-4 text-blue-400" />
              </div>
              <div className="min-w-0">
                <p className="text-[11px] text-muted-foreground">Full Name</p>
                <p className="text-sm font-medium truncate">{user?.name}</p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <div className="h-8 w-8 rounded-full bg-orange-500/10 flex items-center justify-center shrink-0">
                <Mail className="h-4 w-4 text-orange-400" />
              </div>
              <div className="min-w-0">
                <p className="text-[11px] text-muted-foreground">Email</p>
                <p className="text-sm font-medium truncate">{user?.email}</p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <div className="h-8 w-8 rounded-full bg-green-500/10 flex items-center justify-center shrink-0">
                <FolderOpen className="h-4 w-4 text-green-400" />
              </div>
              <div className="min-w-0">
                <p className="text-[11px] text-muted-foreground">Projects</p>
                <p className="text-sm font-medium">
                  {projectCount} {projectCount === 1 ? 'project' : 'projects'}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <ThemeSettingsCard />

        {/* Danger Zone */}
        <Card className="border-destructive/30">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-destructive/80 uppercase tracking-wider">
              Account Actions
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Button
              variant="destructive"
              className="w-full"
              onClick={() => setShowLogoutDialog(true)}
            >
              <LogOut className="mr-2 h-4 w-4" />
              Sign Out
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* Logout Confirmation Dialog */}
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
    </div>
  );
}
