"use client";

import { useEffect, useState, useCallback } from "react";
import { Loader2, UserPlus, RefreshCw, Trash2, Users } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  provisionWorkspaceMember,
  listWorkspaceMembers,
  removeWorkspaceMember,
  type WorkspaceMemberProvisionRole,
  type WorkspaceMemberSummary,
} from "@/actions/workspace-member-provisioning-actions";

interface WorkspaceMembersManagerProps {
  activeWorkspace: string | null;
  isWorkspaceAdmin: boolean;
}

const ROLE_LABELS: Record<WorkspaceMemberProvisionRole, string> = {
  SETTER: "Setter",
  INBOX_MANAGER: "Inbox Manager",
};

export function WorkspaceMembersManager({ activeWorkspace, isWorkspaceAdmin }: WorkspaceMembersManagerProps) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<WorkspaceMemberProvisionRole>("SETTER");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [members, setMembers] = useState<WorkspaceMemberSummary[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [removingUserId, setRemovingUserId] = useState<string | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const refreshMembers = useCallback(async () => {
    if (!activeWorkspace) {
      setMembers([]);
      setFetchError(null);
      return;
    }
    setIsLoading(true);
    setFetchError(null);
    const result = await listWorkspaceMembers(activeWorkspace);
    if (result.success && result.members) {
      setMembers(result.members);
    } else {
      setFetchError(result.error || "Failed to load team members");
      toast.error(result.error || "Failed to load team members");
    }
    setIsLoading(false);
  }, [activeWorkspace]);

  useEffect(() => {
    refreshMembers();
  }, [refreshMembers]);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await refreshMembers();
    setIsRefreshing(false);
  };

  const handleSubmit = async (event?: React.FormEvent) => {
    event?.preventDefault();
    if (!activeWorkspace || isSubmitting) return;

    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      toast.error("Enter an email address");
      return;
    }

    setIsSubmitting(true);
    const result = await provisionWorkspaceMember(activeWorkspace, { email: trimmedEmail, role });
    if (result.success) {
      const action = result.userExisted ? "added" : "created";
      const emailNote = result.emailSent ? " — login email sent" : "";
      toast.success(`${ROLE_LABELS[role]} ${action}${emailNote}`);
      setEmail("");
      await refreshMembers();
    } else {
      toast.error(result.error || "Failed to add team member");
    }
    setIsSubmitting(false);
  };

  const handleRemove = async (member: WorkspaceMemberSummary) => {
    if (!activeWorkspace) return;
    const confirmed = window.confirm(`Remove ${member.email} as ${ROLE_LABELS[member.role]}?`);
    if (!confirmed) return;

    setRemovingUserId(member.userId);
    const result = await removeWorkspaceMember(activeWorkspace, member.userId, member.role);
    if (result.success) {
      toast.success(`${ROLE_LABELS[member.role]} removed`);
      await refreshMembers();
    } else {
      toast.error(result.error || "Failed to remove member");
    }
    setRemovingUserId(null);
  };

  const formatDate = (iso: string) => {
    try {
      return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(iso));
    } catch {
      return "—";
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Users className="h-5 w-5" />
          Team Members
        </CardTitle>
        <CardDescription>
          Add setters and inbox managers to this workspace
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {!activeWorkspace && (
          <p className="text-sm text-muted-foreground">Select a workspace to manage team members.</p>
        )}
        {activeWorkspace && !isWorkspaceAdmin && (
          <p className="text-sm text-muted-foreground">Only workspace admins can manage team members.</p>
        )}
        {activeWorkspace && isWorkspaceAdmin && (
          <>
            {/* Add member form */}
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="flex items-center gap-2">
                <UserPlus className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-medium">Add team member</span>
              </div>
              <fieldset disabled={isSubmitting} className="grid gap-4 md:grid-cols-[1fr_160px_auto]">
                <div className="space-y-2">
                  <Label htmlFor="workspace-member-email" className="sr-only">
                    Email address
                  </Label>
                  <Input
                    id="workspace-member-email"
                    type="email"
                    placeholder="team@example.com"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    maxLength={320}
                    autoComplete="email"
                    className="min-w-0"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="workspace-member-role" className="sr-only">
                    Role
                  </Label>
                  <Select value={role} onValueChange={(value) => setRole(value as WorkspaceMemberProvisionRole)}>
                    <SelectTrigger id="workspace-member-role">
                      <SelectValue placeholder="Role" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="SETTER">Setter</SelectItem>
                      <SelectItem value="INBOX_MANAGER">Inbox Manager</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <Button type="submit" disabled={isSubmitting}>
                  {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Add
                </Button>
              </fieldset>
              <p className="text-xs text-muted-foreground">
                New users receive login credentials by email. Existing users are added without a new email.
              </p>
            </form>

            {/* Member list */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-muted-foreground">
                  {members.length === 0 && !isLoading ? "No members yet" : `${members.length} member${members.length === 1 ? "" : "s"}`}
                </span>
                <Button variant="ghost" size="sm" onClick={handleRefresh} disabled={isRefreshing || isLoading}>
                  {isRefreshing ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <RefreshCw className="h-4 w-4" />
                  )}
                  <span className="sr-only">Refresh</span>
                </Button>
              </div>

              {fetchError && !isLoading && (
                <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
                  {fetchError}
                  <Button variant="link" size="sm" className="ml-2 h-auto p-0" onClick={handleRefresh}>
                    Retry
                  </Button>
                </div>
              )}

              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Email</TableHead>
                      <TableHead>Role</TableHead>
                      <TableHead>Added</TableHead>
                      <TableHead className="w-[60px]">
                        <span className="sr-only">Actions</span>
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {isLoading ? (
                      <TableRow>
                        <TableCell colSpan={4} className="py-8 text-center text-sm text-muted-foreground">
                          <Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin" />
                          Loading team members...
                        </TableCell>
                      </TableRow>
                    ) : members.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={4} className="py-8 text-center text-sm text-muted-foreground">
                          No setters or inbox managers added yet.
                          <br />
                          <span className="text-xs">Add a team member above to get started.</span>
                        </TableCell>
                      </TableRow>
                    ) : (
                      members.map((member) => {
                        const isRemoving = removingUserId === member.userId;
                        return (
                          <TableRow key={`${member.userId}-${member.role}`}>
                            <TableCell className="max-w-[200px]">
                              <span className="block truncate font-medium" title={member.email}>
                                {member.email}
                              </span>
                            </TableCell>
                            <TableCell>
                              <Badge variant={member.role === "SETTER" ? "default" : "secondary"}>
                                {ROLE_LABELS[member.role]}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-muted-foreground">
                              {formatDate(member.createdAt)}
                            </TableCell>
                            <TableCell>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-muted-foreground hover:text-destructive"
                                onClick={() => handleRemove(member)}
                                disabled={isRemoving}
                                title={`Remove ${member.email}`}
                              >
                                {isRemoving ? (
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                  <Trash2 className="h-4 w-4" />
                                )}
                                <span className="sr-only">Remove</span>
                              </Button>
                            </TableCell>
                          </TableRow>
                        );
                      })
                    )}
                  </TableBody>
                </Table>
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
