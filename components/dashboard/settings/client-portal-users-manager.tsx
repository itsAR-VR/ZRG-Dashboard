"use client";

import { useEffect, useState } from "react";
import { Mail, RefreshCw, Key, Trash2, Loader2 } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import {
  createClientPortalUser,
  listClientPortalUsers,
  removeClientPortalAccess,
  resetClientPortalPassword,
  type ClientPortalUserSummary,
} from "@/actions/client-portal-user-actions";

interface ClientPortalUsersManagerProps {
  activeWorkspace: string | null;
  isWorkspaceAdmin: boolean;
}

export function ClientPortalUsersManager({ activeWorkspace, isWorkspaceAdmin }: ClientPortalUsersManagerProps) {
  const [users, setUsers] = useState<ClientPortalUserSummary[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [actionUserId, setActionUserId] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [resetExisting, setResetExisting] = useState(false);

  const refreshUsers = async () => {
    if (!activeWorkspace) {
      setUsers([]);
      return;
    }
    setIsLoading(true);
    const result = await listClientPortalUsers(activeWorkspace);
    if (result.success && result.users) {
      setUsers(result.users);
    } else if (!result.success) {
      toast.error(result.error || "Failed to load client portal users");
    }
    setIsLoading(false);
  };

  useEffect(() => {
    refreshUsers();
  }, [activeWorkspace]);

  const handleCreate = async () => {
    if (!activeWorkspace) return;
    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      toast.error("Enter an email address");
      return;
    }
    setIsSubmitting(true);
    const result = await createClientPortalUser(activeWorkspace, {
      email: trimmedEmail,
      password: password.trim() || null,
      resetPassword: resetExisting,
    });
    if (result.success) {
      toast.success("Client portal user created and email sent");
      setEmail("");
      setPassword("");
      setResetExisting(false);
      await refreshUsers();
    } else {
      toast.error(result.error || "Failed to create client portal user");
    }
    setIsSubmitting(false);
  };

  const handleReset = async (userId: string) => {
    if (!activeWorkspace) return;
    const confirmed = window.confirm("Reset password and send a new login email?");
    if (!confirmed) return;
    setActionUserId(userId);
    const result = await resetClientPortalPassword(activeWorkspace, userId);
    if (result.success) {
      toast.success("Password reset email sent");
    } else {
      toast.error(result.error || "Failed to reset password");
    }
    setActionUserId(null);
  };

  const handleRemove = async (userId: string) => {
    if (!activeWorkspace) return;
    const confirmed = window.confirm("Remove this client’s portal access?");
    if (!confirmed) return;
    setActionUserId(userId);
    const result = await removeClientPortalAccess(activeWorkspace, userId);
    if (result.success) {
      toast.success("Client portal access removed");
      await refreshUsers();
    } else {
      toast.error(result.error || "Failed to remove access");
    }
    setActionUserId(null);
  };

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await refreshUsers();
    setIsRefreshing(false);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Mail className="h-5 w-5" />
          Client Portal Users
        </CardTitle>
        <CardDescription>Provision client logins for this workspace</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {!activeWorkspace && (
          <p className="text-sm text-muted-foreground">Select a workspace to manage client portal users.</p>
        )}
        {activeWorkspace && !isWorkspaceAdmin && (
          <p className="text-sm text-muted-foreground">Only workspace admins can manage client portal users.</p>
        )}
        {activeWorkspace && isWorkspaceAdmin && (
          <>
            <div className="grid gap-4 md:grid-cols-[minmax(220px,1fr)_minmax(220px,1fr)_auto]">
              <div className="space-y-2">
                <Label htmlFor="client-portal-email">Client email</Label>
                <Input
                  id="client-portal-email"
                  placeholder="client@example.com"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="client-portal-password">Temporary password (optional)</Label>
                <Input
                  id="client-portal-password"
                  type="password"
                  placeholder="Leave blank to auto-generate"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
              </div>
              <div className="flex items-end">
                <Button onClick={handleCreate} disabled={isSubmitting}>
                  {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Create & Send Login
                </Button>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Checkbox
                id="client-portal-reset"
                checked={resetExisting}
                onCheckedChange={(checked) => setResetExisting(Boolean(checked))}
              />
              <Label htmlFor="client-portal-reset" className="text-sm font-normal">
                Reset password if the user already exists
              </Label>
            </div>
            <div className="flex items-center justify-between">
              <p className="text-xs text-muted-foreground">
                The client will receive an email with their login details. They can change their password using “Forgot
                password”.
              </p>
              <Button variant="outline" size="sm" onClick={handleRefresh} disabled={isRefreshing}>
                {isRefreshing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
                Refresh
              </Button>
            </div>
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Email</TableHead>
                    <TableHead>Added</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    <TableRow>
                      <TableCell colSpan={3} className="py-6 text-center text-sm text-muted-foreground">
                        Loading client portal users…
                      </TableCell>
                    </TableRow>
                  ) : users.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={3} className="py-6 text-center text-sm text-muted-foreground">
                        No client portal users yet.
                      </TableCell>
                    </TableRow>
                  ) : (
                    users.map((user) => {
                      const createdAtLabel = user.createdAt
                        ? new Date(user.createdAt).toLocaleDateString()
                        : "—";
                      const disabled = actionUserId === user.userId;
                      return (
                        <TableRow key={user.userId}>
                          <TableCell className="font-medium">{user.email ?? "Unknown email"}</TableCell>
                          <TableCell>{createdAtLabel}</TableCell>
                          <TableCell className="text-right space-x-2">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handleReset(user.userId)}
                              disabled={disabled}
                            >
                              <Key className="mr-2 h-4 w-4" />
                              Reset Password
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-destructive hover:text-destructive"
                              onClick={() => handleRemove(user.userId)}
                              disabled={disabled}
                            >
                              <Trash2 className="mr-2 h-4 w-4" />
                              Remove
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
