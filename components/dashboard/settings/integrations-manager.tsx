"use client";

import { useState, useEffect, useTransition } from "react";
import { Plus, Trash2, Building2, Key, MapPin, Loader2, RefreshCw } from "lucide-react";
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
import { getClients, createClient, deleteClient } from "@/actions/client-actions";
import { syncCampaignsFromGHL } from "@/actions/campaign-actions";
import { toast } from "sonner";

interface Client {
  id: string;
  name: string;
  ghlLocationId: string;
  workspaceId: string;
  createdAt: Date;
  _count: {
    leads: number;
    campaigns?: number;
  };
}

export function IntegrationsManager() {
  const [clients, setClients] = useState<Client[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isPending, startTransition] = useTransition();
  const [syncingClientId, setSyncingClientId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  // Form state
  const [formData, setFormData] = useState({
    name: "",
    ghlLocationId: "",
    ghlPrivateKey: "",
  });

  // Fetch clients on mount
  useEffect(() => {
    fetchClients();
  }, []);

  async function fetchClients() {
    setIsLoading(true);
    const result = await getClients();
    if (result.success && result.data) {
      setClients(result.data as Client[]);
    } else {
      setError(result.error || "Failed to load clients");
    }
    setIsLoading(false);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    startTransition(async () => {
      const result = await createClient(formData);
      if (result.success) {
        setFormData({ name: "", ghlLocationId: "", ghlPrivateKey: "" });
        setShowForm(false);
        toast.success("Workspace added successfully");
        await fetchClients();
      } else {
        setError(result.error || "Failed to create client");
      }
    });
  }

  async function handleDelete(id: string) {
    if (!confirm("Are you sure you want to delete this client? This will also delete all associated leads and messages.")) {
      return;
    }

    startTransition(async () => {
      const result = await deleteClient(id);
      if (result.success) {
        toast.success("Workspace deleted");
        await fetchClients();
      } else {
        setError(result.error || "Failed to delete client");
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
          <Button onClick={() => setShowForm(!showForm)} variant={showForm ? "outline" : "default"}>
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
        {showForm && (
          <>
            <form onSubmit={handleSubmit} className="space-y-4 p-4 border rounded-lg bg-muted/30">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="name" className="flex items-center gap-2">
                    <Building2 className="h-4 w-4" />
                    Client Name
                  </Label>
                  <Input
                    id="name"
                    placeholder="e.g., Acme Corp"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
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
                    value={formData.ghlLocationId}
                    onChange={(e) => setFormData({ ...formData, ghlLocationId: e.target.value })}
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
                  placeholder="pit_xxxxxxxxxxxxxxxx"
                  value={formData.ghlPrivateKey}
                  onChange={(e) => setFormData({ ...formData, ghlPrivateKey: e.target.value })}
                  required
                />
                <p className="text-xs text-muted-foreground">
                  Found in GHL → Settings → Integrations → Private Integrations
                </p>
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
              {clients.map((client) => (
                <TableRow key={client.id}>
                  <TableCell className="font-medium">{client.name}</TableCell>
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
                  <TableCell className="text-right space-x-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleSyncCampaigns(client.id)}
                      disabled={syncingClientId === client.id}
                    >
                      {syncingClientId === client.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <>
                          <RefreshCw className="h-4 w-4 mr-1" />
                          Sync Campaigns
                        </>
                      )}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleDelete(client.id)}
                      disabled={isPending}
                      className="text-destructive hover:text-destructive hover:bg-destructive/10"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}

        {/* Webhook URL Info */}
        {clients.length > 0 && (
          <>
            <Separator />
            <div className="p-4 rounded-lg bg-muted/50 space-y-2">
              <p className="text-sm font-medium">Webhook URL for GHL</p>
              <code className="block text-xs bg-background p-2 rounded border break-all">
                {process.env.NEXT_PUBLIC_APP_URL || "https://zrg-dashboard.vercel.app"}/api/webhooks/ghl/sms
              </code>
              <p className="text-xs text-muted-foreground">
                Configure this URL in GHL → Automation → Webhooks to receive inbound SMS notifications.
              </p>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
