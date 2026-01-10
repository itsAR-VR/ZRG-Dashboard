"use client";

import { useState, useEffect, useTransition } from "react";
import { Plus, Trash2, Building2, Key, MapPin, Loader2, RefreshCw, Mail, ChevronDown, ChevronUp, MessageSquare, Pencil, Eraser, Linkedin, Users, Calendar } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Separator } from "@/components/ui/separator";
import { getClients, createClient, deleteClient, updateClient } from "@/actions/client-actions";
import { getGlobalAdminStatus } from "@/actions/access-actions";
import { syncCampaignsFromGHL } from "@/actions/campaign-actions";
import { syncEmailCampaignsFromEmailBison } from "@/actions/email-campaign-actions";
import { cleanupBounceLeads } from "@/actions/message-actions";
import { getClientAssignments, setClientAssignments } from "@/actions/client-membership-actions";
import { toast } from "sonner";

interface Client {
  id: string;
  name: string;
  ghlLocationId: string;
  hasDefaultCalendarLink?: boolean;
  emailBisonApiKey: string | null;
  emailBisonWorkspaceId: string | null;
  unipileAccountId: string | null;
  hasCalendlyAccessToken?: boolean;
  hasCalendlyWebhookSubscription?: boolean;
  createdAt: Date;
  _count: {
    leads: number;
    campaigns?: number;
  };
}

interface IntegrationsManagerProps {
  onWorkspacesChange?: (workspaces: Array<Pick<Client, "id" | "name" | "ghlLocationId" | "hasDefaultCalendarLink">>) => void;
}

export function IntegrationsManager({ onWorkspacesChange }: IntegrationsManagerProps) {
  const [clients, setClients] = useState<Client[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isPending, startTransition] = useTransition();
  const [isAdmin, setIsAdmin] = useState(false);
  const [isAdminLoading, setIsAdminLoading] = useState(true);
  const [syncingClientId, setSyncingClientId] = useState<string | null>(null);
  const [syncingEmailClientId, setSyncingEmailClientId] = useState<string | null>(null);
  const [cleaningUpClientId, setCleaningUpClientId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [showEmailFields, setShowEmailFields] = useState(false);
  const [editingClientId, setEditingClientId] = useState<string | null>(null);
  const [isLoadingAssignments, setIsLoadingAssignments] = useState(false);
  const [showAllWorkspaces, setShowAllWorkspaces] = useState(false);

  const emptyNewClientForm = {
    name: "",
    ghlLocationId: "",
    ghlPrivateKey: "",
    emailBisonApiKey: "",
    emailBisonWorkspaceId: "",
    unipileAccountId: "",
    calendlyAccessToken: "",
    setterEmailsRaw: "",
    inboxManagerEmailsRaw: "",
  };

  const emptyIntegrationsForm = {
    name: "",
    emailBisonApiKey: "",
    emailBisonWorkspaceId: "",
    unipileAccountId: "",
    calendlyAccessToken: "",
  };

  const emptyAssignmentsForm = {
    setterEmailsRaw: "",
    inboxManagerEmailsRaw: "",
  };

  // Separate form states to prevent cross-contamination between "Add Workspace" and per-client edits
  const [newClientForm, setNewClientForm] = useState(emptyNewClientForm);
  const [integrationsForm, setIntegrationsForm] = useState(emptyIntegrationsForm);
  const [assignmentsForm, setAssignmentsForm] = useState(emptyAssignmentsForm);

  async function fetchClients() {
    setIsLoading(true);
    const result = await getClients();
    if (result.success && result.data) {
      const nextClients = result.data as Client[];
      setClients(nextClients);
      onWorkspacesChange?.(
        nextClients.map((c) => ({
          id: c.id,
          name: c.name,
          ghlLocationId: c.ghlLocationId,
          hasDefaultCalendarLink: c.hasDefaultCalendarLink,
        })),
      );
    } else {
      setError(result.error || "Failed to load clients");
    }
    setIsLoading(false);
  }

  // Fetch clients on mount
  useEffect(() => {
    fetchClients();
  }, []);

  useEffect(() => {
    async function fetchAdminStatus() {
      setIsAdminLoading(true);
      const result = await getGlobalAdminStatus();
      if (result.success) setIsAdmin(result.isAdmin);
      setIsAdminLoading(false);
    }
    fetchAdminStatus();
  }, []);

  async function loadAssignments(clientId: string) {
    setIsLoadingAssignments(true);
    const res = await getClientAssignments(clientId);
    if (res.success && res.data) {
      setAssignmentsForm({
        setterEmailsRaw: res.data.setters.join(", "),
        inboxManagerEmailsRaw: res.data.inboxManagers.join(", "),
      });
    } else {
      setAssignmentsForm(emptyAssignmentsForm);
      toast.error(res.error || "Failed to load assignments");
    }
    setIsLoadingAssignments(false);
  }

  async function handleSaveAssignments(clientId: string) {
    setError(null);

    startTransition(async () => {
      const res = await setClientAssignments(clientId, {
        setterEmailsRaw: assignmentsForm.setterEmailsRaw,
        inboxManagerEmailsRaw: assignmentsForm.inboxManagerEmailsRaw,
      });
      if (res.success) {
        toast.success("Assignments updated");
        await fetchClients();
      } else {
        toast.error(res.error || "Failed to update assignments");
      }
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    startTransition(async () => {
      const result = await createClient({
        name: newClientForm.name,
        ghlLocationId: newClientForm.ghlLocationId,
        ghlPrivateKey: newClientForm.ghlPrivateKey,
        emailBisonApiKey: newClientForm.emailBisonApiKey,
        emailBisonWorkspaceId: newClientForm.emailBisonWorkspaceId,
        unipileAccountId: newClientForm.unipileAccountId,
        calendlyAccessToken: newClientForm.calendlyAccessToken,
      });
      if (result.success && result.data) {
        const created = result.data as { id: string };
        const wantsAssignments =
          !!newClientForm.setterEmailsRaw.trim() || !!newClientForm.inboxManagerEmailsRaw.trim();

        if (wantsAssignments) {
          const assign = await setClientAssignments(created.id, {
            setterEmailsRaw: newClientForm.setterEmailsRaw,
            inboxManagerEmailsRaw: newClientForm.inboxManagerEmailsRaw,
          });
          if (!assign.success) {
            toast.error(assign.error || "Workspace created, but failed to set assignments");
          }
        }

        setNewClientForm(emptyNewClientForm);
        setAssignmentsForm(emptyAssignmentsForm);
        setShowForm(false);
        setShowEmailFields(false);
        toast.success("Workspace added successfully");
        await fetchClients();
      } else {
        setError(result.error || "Failed to create client");
      }
    });
  }

  async function handleUpdateWorkspace(clientId: string) {
    setError(null);

    // Find the current client to check existing values
    const currentClient = clients.find(c => c.id === clientId);

    startTransition(async () => {
      // Build update payload - only include fields that have values or are being explicitly changed
      const updatePayload: {
        name?: string;
        emailBisonApiKey?: string;
        emailBisonWorkspaceId?: string;
        unipileAccountId?: string;
        calendlyAccessToken?: string;
      } = {};

      const nextName = integrationsForm.name.trim();
      if (!nextName) {
        toast.error("Workspace name cannot be empty");
        return;
      }
      if (nextName !== (currentClient?.name || "")) {
        updatePayload.name = nextName;
      }
      
      // Update workspace ID (allow empty to clear)
      if (integrationsForm.emailBisonWorkspaceId !== (currentClient?.emailBisonWorkspaceId || "")) {
        updatePayload.emailBisonWorkspaceId = integrationsForm.emailBisonWorkspaceId;
      }
      
      // Only update API key if user entered a new one (not blank placeholder)
      if (integrationsForm.emailBisonApiKey) {
        updatePayload.emailBisonApiKey = integrationsForm.emailBisonApiKey;
      }
      
      // Update Unipile Account ID if changed
      if (integrationsForm.unipileAccountId !== (currentClient?.unipileAccountId || "")) {
        updatePayload.unipileAccountId = integrationsForm.unipileAccountId;
      }

      // Only update Calendly token if user entered a new one (not blank placeholder)
      if (integrationsForm.calendlyAccessToken) {
        updatePayload.calendlyAccessToken = integrationsForm.calendlyAccessToken;
      }

      if (Object.keys(updatePayload).length === 0) {
        toast.info("No changes to save");
        return;
      }

      const result = await updateClient(clientId, updatePayload);
      if (result.success) {
        setIntegrationsForm(emptyIntegrationsForm);
        setEditingClientId(null);
        toast.success("Credentials updated");
        await fetchClients();
      } else {
        setError(result.error || "Failed to update credentials");
      }
    });
  }

  async function handleSyncEmailCampaigns(clientId: string) {
    setSyncingEmailClientId(clientId);
    
    const result = await syncEmailCampaignsFromEmailBison(clientId);
    
    if (result.success) {
      toast.success(`Synced ${result.synced} email campaigns from EmailBison`);
      await fetchClients();
    } else {
      toast.error(result.error || "Failed to sync email campaigns");
    }
    
    setSyncingEmailClientId(null);
  }

  async function handleCleanupBounceLeads(clientId: string) {
    setCleaningUpClientId(clientId);
    
    try {
      const result = await cleanupBounceLeads(clientId);
      
      if (result.success) {
        if (result.fakeLeadsFound > 0) {
          let message = `Cleaned up ${result.fakeLeadsFound} bounce leads: ${result.messagesMigrated} messages migrated, ${result.leadsBlacklisted} blacklisted`;
          if (result.leadsMarkedForReview > 0) {
            message += `, ${result.leadsMarkedForReview} marked for review`;
            toast.warning(message);
          } else {
            toast.success(message);
          }
        } else {
          toast.info("No bounce leads found to clean up");
        }
        await fetchClients();
      } else {
        toast.error(result.errors.join(", ") || "Failed to clean up bounce leads");
      }
    } catch (err) {
      toast.error("Failed to clean up bounce leads");
    }
    
    setCleaningUpClientId(null);
  }

  async function handleDelete(id: string) {
    if (!confirm("Are you sure you want to delete this workspace? This will also delete all associated leads and messages.")) {
      return;
    }

    startTransition(async () => {
      const result = await deleteClient(id);
      if (result.success) {
        toast.success("Workspace deleted");
        await fetchClients();
      } else {
        setError(result.error || "Failed to delete workspace");
      }
    });
  }

  async function handleSyncCampaigns(clientId: string) {
    setSyncingClientId(clientId);
    
    const result = await syncCampaignsFromGHL(clientId);
    
    if (result.success) {
      toast.success(`Synced ${result.synced} campaigns from GHL`);
      await fetchClients();
    } else {
      toast.error(result.error || "Failed to sync campaigns");
    }
    
    setSyncingClientId(null);
  }

  const collapsedWorkspaceCount = 5;
  const editingClient = editingClientId ? clients.find((c) => c.id === editingClientId) : undefined;
  const baseVisibleClients = showAllWorkspaces ? clients : clients.slice(0, collapsedWorkspaceCount);
  const visibleClients =
    showAllWorkspaces || !editingClient || baseVisibleClients.some((c) => c.id === editingClient.id)
      ? baseVisibleClients
      : [...baseVisibleClients, editingClient];

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Building2 className="h-5 w-5" />
              GHL Workspaces
            </CardTitle>
            <CardDescription>
              Manage your GoHighLevel sub-account integrations
            </CardDescription>
          </div>
          <Button
            onClick={() => {
              setShowForm((prev) => {
                const next = !prev;
                if (next) {
                  setNewClientForm(emptyNewClientForm);
                  setAssignmentsForm(emptyAssignmentsForm);
                  setShowEmailFields(false);
                }
                return next;
              });
            }}
            variant={showForm ? "outline" : "default"}
          >
            <Plus className="h-4 w-4 mr-2" />
            {showForm ? "Cancel" : "Add Workspace"}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Error Display */}
        {error && (
          <div className="p-3 rounded-lg bg-destructive/10 text-destructive text-sm">
            {error}
          </div>
        )}

        {/* Add New Client Form */}
        {showForm && isAdmin && (
          <>
            <form onSubmit={handleSubmit} className="space-y-4 p-4 border rounded-lg bg-muted/30">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="name" className="flex items-center gap-2">
                    <Building2 className="h-4 w-4" />
                    Workspace Name
                  </Label>
                  <Input
                    id="name"
                    placeholder="e.g., Acme Corp"
                    value={newClientForm.name}
                    onChange={(e) => setNewClientForm({ ...newClientForm, name: e.target.value })}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="locationId" className="flex items-center gap-2">
                    <MapPin className="h-4 w-4" />
                    GHL Location ID
                  </Label>
                  <Input
                    id="locationId"
                    placeholder="e.g., abc123xyz"
                    value={newClientForm.ghlLocationId}
                    onChange={(e) => setNewClientForm({ ...newClientForm, ghlLocationId: e.target.value })}
                    required
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="privateKey" className="flex items-center gap-2">
                  <Key className="h-4 w-4" />
                  GHL Private Integration Key
                </Label>
                <Input
                  id="privateKey"
                  type="password"
                  autoComplete="off"
                  placeholder="pit_xxxxxxxxxxxxxxxx"
                  value={newClientForm.ghlPrivateKey}
                  onChange={(e) => setNewClientForm({ ...newClientForm, ghlPrivateKey: e.target.value })}
                  required
                />
                <p className="text-xs text-muted-foreground">
                  Found in GHL → Settings → Integrations → Private Integrations
                </p>
              </div>

              <div className="border-t pt-4 mt-4">
                <p className="text-sm font-medium mb-3 flex items-center gap-2">
                  <Users className="h-4 w-4" />
                  Assignments (Optional)
                </p>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="setterEmails" className="text-sm">Setter email(s)</Label>
                    <Input
                      id="setterEmails"
                      placeholder="setter1@company.com, setter2@company.com"
                      value={newClientForm.setterEmailsRaw}
                      onChange={(e) => setNewClientForm({ ...newClientForm, setterEmailsRaw: e.target.value })}
                    />
                    <p className="text-xs text-muted-foreground">Comma-separated. Users must already exist in Supabase Auth.</p>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="inboxManagerEmails" className="text-sm">Inbox manager email(s)</Label>
                    <Input
                      id="inboxManagerEmails"
                      placeholder="manager@company.com"
                      value={newClientForm.inboxManagerEmailsRaw}
                      onChange={(e) => setNewClientForm({ ...newClientForm, inboxManagerEmailsRaw: e.target.value })}
                    />
                    <p className="text-xs text-muted-foreground">Used for provisioning auto-assignment + UI labeling.</p>
                  </div>
                </div>
              </div>

              {/* EmailBison Integration Section */}
              <div className="border-t pt-4 mt-4">
                <button
                  type="button"
                  onClick={() => setShowEmailFields(!showEmailFields)}
                  className="flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
                >
                  <Mail className="h-4 w-4" />
                  Email Integration (Optional)
                  {showEmailFields ? (
                    <ChevronUp className="h-4 w-4" />
                  ) : (
                    <ChevronDown className="h-4 w-4" />
                  )}
                </button>
                
                {showEmailFields && (
                  <div className="mt-4 space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="emailBisonWorkspaceId" className="flex items-center gap-2">
                        <MapPin className="h-4 w-4" />
                        EmailBison Workspace ID
                      </Label>
                      <Input
                        id="emailBisonWorkspaceId"
                        placeholder="e.g., 12345"
                        value={newClientForm.emailBisonWorkspaceId}
                        onChange={(e) => setNewClientForm({ ...newClientForm, emailBisonWorkspaceId: e.target.value })}
                      />
                      <p className="text-xs text-muted-foreground">
                        Found in EmailBison webhook payloads as workspace_id. Required for automatic webhook routing.
                      </p>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="emailBisonApiKey" className="flex items-center gap-2">
                        <Key className="h-4 w-4" />
                        EmailBison API Key
                      </Label>
                      <Input
                        id="emailBisonApiKey"
                        type="password"
                        autoComplete="off"
                        placeholder="eb_xxxxxxxxxxxxxxxx"
                        value={newClientForm.emailBisonApiKey}
                        onChange={(e) => setNewClientForm({ ...newClientForm, emailBisonApiKey: e.target.value })}
                      />
                      <p className="text-xs text-muted-foreground">
                        Found in your EmailBison instance → Settings → API Keys
                      </p>
                    </div>
                    
                    {/* LinkedIn/Unipile Integration */}
                    <div className="border-t pt-4 mt-4">
                      <Label htmlFor="unipileAccountId" className="flex items-center gap-2 mb-2">
                        <Linkedin className="h-4 w-4" />
                        LinkedIn Account ID (Unipile)
                      </Label>
                      <Input
                        id="unipileAccountId"
                        placeholder="e.g., Asdq-j08dsqQS89QSD"
                        value={newClientForm.unipileAccountId}
                        onChange={(e) => setNewClientForm({ ...newClientForm, unipileAccountId: e.target.value })}
                      />
                      <p className="text-xs text-muted-foreground mt-1">
                        Found in Unipile dashboard under your connected LinkedIn account
                      </p>
                    </div>
                  </div>
                )}
              </div>

              <Button type="submit" disabled={isPending} className="w-full sm:w-auto">
                {isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Creating...
                  </>
                ) : (
                  <>
                    <Plus className="h-4 w-4 mr-2" />
                    Add Workspace
                  </>
                )}
              </Button>
            </form>
            <Separator />
          </>
        )}

        {showForm && !isAdmin && !isAdminLoading && (
          <>
            <div className="p-4 border rounded-lg bg-muted/30 text-sm text-muted-foreground">
              You don&apos;t have permission to add or manage workspaces. Ask an admin to assign you to a workspace.
            </div>
            <Separator />
          </>
        )}

        {/* Clients Table */}
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : clients.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <Building2 className="h-12 w-12 mx-auto mb-4 opacity-50" />
            <p>No workspaces configured yet.</p>
            <p className="text-sm">Add a GHL workspace to start receiving SMS webhooks.</p>
          </div>
        ) : (
          <>
            {clients.length > collapsedWorkspaceCount && (
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs text-muted-foreground">
                  Showing {Math.min(collapsedWorkspaceCount, visibleClients.length)} of {clients.length} workspaces
                </p>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="text-xs text-muted-foreground"
                  onClick={() => setShowAllWorkspaces((prev) => !prev)}
                >
                  {showAllWorkspaces ? (
                    <>
                      Show fewer <ChevronUp className="h-4 w-4 ml-1" />
                    </>
                  ) : (
                    <>
                      Show all <ChevronDown className="h-4 w-4 ml-1" />
                    </>
                  )}
                </Button>
              </div>
            )}

            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Location ID</TableHead>
                  <TableHead>Leads</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visibleClients.map((client) => {
                  const hasEmailBison = !!client.emailBisonApiKey;
                  const hasLinkedIn = !!client.unipileAccountId;
                  const hasCalendly = !!client.hasCalendlyAccessToken;
                  const isEditingThis = editingClientId === client.id;

                  return (
                    <TableRow key={client.id}>
                    <TableCell className="font-medium">
                      <div className="flex flex-col gap-1">
                        <span>{client.name}</span>
                        <div className="flex gap-1">
                          <Badge variant="outline" className="text-green-500 border-green-500/30 bg-green-500/10 text-[10px]">
                            SMS
                          </Badge>
                          {hasEmailBison ? (
                            <Badge variant="outline" className="text-blue-500 border-blue-500/30 bg-blue-500/10 text-[10px]">
                              <Mail className="h-3 w-3 mr-1" />
                              Email {client.emailBisonWorkspaceId && `(#${client.emailBisonWorkspaceId})`}
                            </Badge>
                          ) : client.emailBisonWorkspaceId ? (
                            <Badge variant="outline" className="text-amber-500 border-amber-500/30 bg-amber-500/10 text-[10px]">
                              <Mail className="h-3 w-3 mr-1" />
                              Email #{client.emailBisonWorkspaceId} (no API key)
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="text-muted-foreground text-[10px]">
                              <Mail className="h-3 w-3 mr-1" />
                              No Email
                            </Badge>
                          )}
                          {hasLinkedIn ? (
                            <Badge variant="outline" className="text-[#0A66C2] border-[#0A66C2]/30 bg-[#0A66C2]/10 text-[10px]">
                              <Linkedin className="h-3 w-3 mr-1" />
                              LinkedIn
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="text-muted-foreground text-[10px]">
                              <Linkedin className="h-3 w-3 mr-1" />
                              No LinkedIn
                            </Badge>
                          )}
                          {hasCalendly ? (
                            <Badge variant="outline" className="text-indigo-600 border-indigo-600/30 bg-indigo-600/10 text-[10px]">
                              <Calendar className="h-3 w-3 mr-1" />
                              Calendly
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="text-muted-foreground text-[10px]">
                              <Calendar className="h-3 w-3 mr-1" />
                              No Calendly
                            </Badge>
                          )}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <code className="text-xs bg-muted px-2 py-1 rounded">
                        {client.ghlLocationId}
                      </code>
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary">{client._count.leads} leads</Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-green-500 border-green-500/30 bg-green-500/10">
                        Active
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex flex-col gap-2 items-end">
                        <div className="flex gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleSyncCampaigns(client.id)}
                            disabled={syncingClientId === client.id}
                            className={!isAdmin ? "hidden" : undefined}
                          >
                            {syncingClientId === client.id ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <>
                                <RefreshCw className="h-4 w-4 mr-1" />
                                Sync SMS
                              </>
                            )}
                          </Button>
                          {hasEmailBison && (
                            <>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => handleSyncEmailCampaigns(client.id)}
                                disabled={syncingEmailClientId === client.id}
                              >
                                {syncingEmailClientId === client.id ? (
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                  <>
                                    <Mail className="h-4 w-4 mr-1" />
                                    Sync Email
                                  </>
                                )}
                              </Button>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => handleCleanupBounceLeads(client.id)}
                                disabled={cleaningUpClientId === client.id}
                                title="Clean up bounce email leads (Mail Delivery Subsystem, etc.)"
                                className={!isAdmin ? "hidden" : undefined}
                              >
                                {cleaningUpClientId === client.id ? (
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                  <>
                                    <Eraser className="h-4 w-4 mr-1" />
                                    Clean Bounces
                                  </>
                                )}
                              </Button>
                            </>
                          )}
                          {isAdmin && (
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => handleDelete(client.id)}
                              disabled={isPending}
                              className="text-destructive hover:text-destructive hover:bg-destructive/10"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          )}
                        </div>
                        
                        {/* Configure/Edit EmailBison button - always available */}
                        {isAdmin && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-xs text-muted-foreground"
                            onClick={() => {
                              if (isEditingThis) {
                                setEditingClientId(null);
                                setIntegrationsForm(emptyIntegrationsForm);
                                setAssignmentsForm(emptyAssignmentsForm);
                              } else {
                                setEditingClientId(client.id);
                                setIntegrationsForm({
                                  name: client.name,
                                  emailBisonApiKey: "",
                                  emailBisonWorkspaceId: client.emailBisonWorkspaceId || "",
                                  unipileAccountId: client.unipileAccountId || "",
                                  calendlyAccessToken: "",
                                });
                                loadAssignments(client.id);
                              }
                            }}
                          >
                            {isEditingThis ? (
                              <>Cancel</>
                            ) : (hasEmailBison || hasLinkedIn) ? (
                              <>
                                <Pencil className="h-3 w-3 mr-1" />
                                Edit Integrations
                              </>
                            ) : (
                              <>
                                <Key className="h-3 w-3 mr-1" />
                                Configure Integrations
                              </>
                            )}
                          </Button>
                        )}
                        
                        {/* Inline edit form for EmailBison credentials */}
                        {isEditingThis && (
                          <div className="w-full mt-2 p-3 border rounded-lg bg-muted/30 space-y-3">
                            {/* Show current config if exists */}
                            {(client.emailBisonWorkspaceId || client.emailBisonApiKey) && (
                              <div className="text-xs text-muted-foreground pb-2 border-b">
                                <p>Current config:</p>
                                <p>Workspace ID: <code className="bg-background px-1 rounded">{client.emailBisonWorkspaceId || "Not set"}</code></p>
                                <p>API Key: <code className="bg-background px-1 rounded">{client.emailBisonApiKey ? "••••••••" : "Not set"}</code></p>
                              </div>
                            )}
                            <div className="space-y-2">
                              <Label htmlFor={`workspaceName-${client.id}`} className="text-xs">Workspace Name</Label>
                              <Input
                                id={`workspaceName-${client.id}`}
                                placeholder="e.g., Acme Corp"
                                value={integrationsForm.name}
                                onChange={(e) => setIntegrationsForm({ ...integrationsForm, name: e.target.value })}
                                className="h-8 text-sm"
                              />
                            </div>
                            <div className="space-y-2">
                              <Label htmlFor={`workspaceId-${client.id}`} className="text-xs">Workspace ID (required for webhook routing)</Label>
                              <Input
                                id={`workspaceId-${client.id}`}
                                placeholder="e.g., 78"
                                value={integrationsForm.emailBisonWorkspaceId}
                                onChange={(e) => setIntegrationsForm({ ...integrationsForm, emailBisonWorkspaceId: e.target.value })}
                                className="h-8 text-sm"
                              />
                              <p className="text-[10px] text-muted-foreground">
                                Found in Vercel logs as workspace_id when EmailBison sends a webhook
                              </p>
                            </div>
                            <div className="space-y-2">
                              <Label htmlFor={`emailKey-${client.id}`} className="text-xs">API Key {client.emailBisonApiKey && "(leave blank to keep current)"}</Label>
                              <Input
                                id={`emailKey-${client.id}`}
                                type="password"
                                autoComplete="off"
                                placeholder={client.emailBisonApiKey ? "••••••••" : "eb_xxxxxxxxxxxxxxxx"}
                                value={integrationsForm.emailBisonApiKey}
                                onChange={(e) => setIntegrationsForm({ ...integrationsForm, emailBisonApiKey: e.target.value })}
                                className="h-8 text-sm"
                              />
                            </div>
                            
                            {/* LinkedIn/Unipile Account ID */}
                            <div className="space-y-2 border-t pt-3 mt-3">
                              <Label htmlFor={`linkedinId-${client.id}`} className="text-xs flex items-center gap-1">
                                <Linkedin className="h-3 w-3" />
                                LinkedIn Account ID (Unipile)
                              </Label>
                              <Input
                                id={`linkedinId-${client.id}`}
                                placeholder="e.g., Asdq-j08dsqQS89QSD"
                                value={integrationsForm.unipileAccountId}
                                onChange={(e) => setIntegrationsForm({ ...integrationsForm, unipileAccountId: e.target.value })}
                                className="h-8 text-sm"
                              />
                              <p className="text-[10px] text-muted-foreground">
                                Found in Unipile dashboard under your connected LinkedIn account
                              </p>
                            </div>

                            {/* Calendly Integration */}
                            <div className="space-y-2 border-t pt-3 mt-3">
                              <Label htmlFor={`calendlyToken-${client.id}`} className="text-xs flex items-center gap-1">
                                <Calendar className="h-3 w-3" />
                                Calendly Access Token {client.hasCalendlyAccessToken && "(leave blank to keep current)"}
                              </Label>
                              <Input
                                id={`calendlyToken-${client.id}`}
                                type="password"
                                autoComplete="off"
                                placeholder={client.hasCalendlyAccessToken ? "••••••••" : "cal_live_..."}
                                value={integrationsForm.calendlyAccessToken}
                                onChange={(e) => setIntegrationsForm({ ...integrationsForm, calendlyAccessToken: e.target.value })}
                                className="h-8 text-sm"
                              />
                              <p className="text-[10px] text-muted-foreground">
                                Used for Calendly scheduling + webhook subscriptions (server-side only).
                              </p>
                              {client.hasCalendlyWebhookSubscription && (
                                <p className="text-[10px] text-muted-foreground">
                                  Webhook subscription: <span className="text-green-600">configured</span>
                                </p>
                              )}
                            </div>
                            
                            <Button
                              size="sm"
                              onClick={() => handleUpdateWorkspace(client.id)}
                              disabled={isPending}
                            >
                              {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save Changes"}
                            </Button>

                            <div className="border-t pt-3 mt-3 space-y-2">
                              <p className="text-xs font-medium flex items-center gap-2">
                                <Users className="h-3 w-3" />
                                Assignments
                              </p>
                              {isLoadingAssignments ? (
                                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                  <Loader2 className="h-3 w-3 animate-spin" />
                                  Loading assignments…
                                </div>
                              ) : (
                                <>
                                  <div className="space-y-2">
                                    <Label htmlFor={`setters-${client.id}`} className="text-xs">Setter email(s)</Label>
                                    <Input
                                      id={`setters-${client.id}`}
                                      placeholder="setter1@company.com, setter2@company.com"
                                      value={assignmentsForm.setterEmailsRaw}
                                      onChange={(e) => setAssignmentsForm({ ...assignmentsForm, setterEmailsRaw: e.target.value })}
                                      className="h-8 text-sm"
                                    />
                                  </div>
                                  <div className="space-y-2">
                                    <Label htmlFor={`inboxManagers-${client.id}`} className="text-xs">Inbox manager email(s)</Label>
                                    <Input
                                      id={`inboxManagers-${client.id}`}
                                      placeholder="manager@company.com"
                                      value={assignmentsForm.inboxManagerEmailsRaw}
                                      onChange={(e) => setAssignmentsForm({ ...assignmentsForm, inboxManagerEmailsRaw: e.target.value })}
                                      className="h-8 text-sm"
                                    />
                                  </div>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => handleSaveAssignments(client.id)}
                                    disabled={isPending}
                                  >
                                    {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save Assignments"}
                                  </Button>
                                </>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
              </TableBody>
            </Table>
          </>
        )}

        {/* Webhook URLs Info */}
        {clients.length > 0 && (
          <>
            <Separator />
            <div className="space-y-4">
              {/* GHL Webhook */}
              <div className="p-4 rounded-lg bg-muted/50 space-y-2">
                <p className="text-sm font-medium flex items-center gap-2">
                  <MessageSquare className="h-4 w-4" />
                  Webhook URL for GHL (SMS)
                </p>
                <code className="block text-xs bg-background p-2 rounded border break-all">
                  {process.env.NEXT_PUBLIC_APP_URL || "https://zrg-dashboard.vercel.app"}/api/webhooks/ghl/sms
                </code>
                <p className="text-xs text-muted-foreground">
                  Configure this URL in GHL → Automation → Webhooks to receive inbound SMS notifications.
                </p>
              </div>

              {/* EmailBison Webhook */}
              <div className="p-4 rounded-lg bg-muted/50 space-y-2">
                <p className="text-sm font-medium flex items-center gap-2">
                  <Mail className="h-4 w-4" />
                  Webhook URL for EmailBison
                </p>
                <code className="block text-xs bg-background p-2 rounded border break-all">
                  {process.env.NEXT_PUBLIC_APP_URL || "https://zrg-dashboard.vercel.app"}/api/webhooks/email
                </code>
                <p className="text-xs text-muted-foreground">
                  Configure this URL in EmailBison → Settings → Webhooks to receive inbound email notifications.
                </p>
                <p className="text-xs text-muted-foreground mt-2">
                  <strong>Important:</strong> Set your EmailBison Workspace ID above to enable automatic webhook routing. The system matches incoming webhooks by the <code className="bg-background px-1 py-0.5 rounded">workspace_id</code> in the payload.
                </p>
              </div>

              {/* LinkedIn/Unipile Webhook */}
              <div className="p-4 rounded-lg bg-muted/50 space-y-2">
                <p className="text-sm font-medium flex items-center gap-2">
                  <Linkedin className="h-4 w-4" />
                  Webhook URL for LinkedIn (Unipile)
                </p>
                <code className="block text-xs bg-background p-2 rounded border break-all">
                  {process.env.NEXT_PUBLIC_APP_URL || "https://zrg-dashboard.vercel.app"}/api/webhooks/linkedin
                </code>
                <p className="text-xs text-muted-foreground">
                  Configure this URL in Unipile when creating webhooks for message_received and new_relation events.
                </p>
                <p className="text-xs text-muted-foreground mt-2">
                  <strong>Important:</strong> Set your LinkedIn Account ID above for each workspace. Include the <code className="bg-background px-1 py-0.5 rounded">x-unipile-secret</code> header when creating webhooks.
                </p>
              </div>

              {/* Calendly Webhook */}
              <div className="p-4 rounded-lg bg-muted/50 space-y-2">
                <p className="text-sm font-medium flex items-center gap-2">
                  <Calendar className="h-4 w-4" />
                  Webhook URL for Calendly (per workspace)
                </p>
                <code className="block text-xs bg-background p-2 rounded border break-all">
                  {process.env.NEXT_PUBLIC_APP_URL || "https://zrg-dashboard.vercel.app"}/api/webhooks/calendly/&lt;workspaceId&gt;
                </code>
                <p className="text-xs text-muted-foreground">
                  Calendly webhook subscriptions are created automatically when Calendly is connected. The webhook endpoint includes the workspace ID so we can verify and route events.
                </p>
              </div>

              {/* monday.com Workspace Provisioning */}
              <div className="p-4 rounded-lg bg-muted/50 space-y-2">
                <p className="text-sm font-medium flex items-center gap-2">
                  <Key className="h-4 w-4" />
                  Webhook URL for Workspace Provisioning (monday.com)
                </p>
                <code className="block text-xs bg-background p-2 rounded border break-all">
                  {process.env.NEXT_PUBLIC_APP_URL || "https://zrg-dashboard.vercel.app"}/api/admin/workspaces
                </code>
                <p className="text-xs text-muted-foreground">
                  Configure a monday.com HTTP request automation to <strong>POST</strong> to this endpoint to create workspaces automatically.
                </p>
                <p className="text-xs text-muted-foreground mt-2">
                  <strong>Auth:</strong> Send <code className="bg-background px-1 py-0.5 rounded">Authorization: Bearer WORKSPACE_PROVISIONING_SECRET</code> (or <code className="bg-background px-1 py-0.5 rounded">x-workspace-provisioning-secret</code>).
                </p>
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
