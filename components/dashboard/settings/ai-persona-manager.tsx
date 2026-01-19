"use client";

/**
 * AI Persona Manager (Phase 39)
 *
 * CRUD interface for managing AI personas.
 * AI personas define how the AI communicates: name, tone, greeting, signature, goals, etc.
 */

import { useCallback, useEffect, useState } from "react";
import {
  Plus,
  Trash2,
  Edit2,
  Copy,
  Bot,
  Star,
  Check,
  Mail,
  MessageSquare,
  Loader2,
  ChevronDown,
  ChevronUp,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Separator } from "@/components/ui/separator";
import {
  listAiPersonas,
  getAiPersona,
  createAiPersona,
  updateAiPersona,
  deleteAiPersona,
  setDefaultAiPersona,
  duplicateAiPersona,
  getOrCreateDefaultPersonaFromSettings,
  type AiPersonaSummary,
  type AiPersonaData,
  type CreateAiPersonaInput,
} from "@/actions/ai-persona-actions";

interface AiPersonaManagerProps {
  activeWorkspace?: string | null;
}

// Tone options
const TONE_OPTIONS = [
  { value: "friendly-professional", label: "Friendly Professional" },
  { value: "professional", label: "Professional" },
  { value: "friendly", label: "Friendly" },
  { value: "casual", label: "Casual" },
  { value: "formal", label: "Formal" },
  { value: "direct", label: "Direct" },
  { value: "consultative", label: "Consultative" },
];

export function AiPersonaManager({ activeWorkspace }: AiPersonaManagerProps) {
  const [personas, setPersonas] = useState<AiPersonaSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [editingPersona, setEditingPersona] = useState<AiPersonaData | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<AiPersonaSummary | null>(null);
  const [showMigrationBanner, setShowMigrationBanner] = useState(false);

  // Form state for create/edit
  const [formName, setFormName] = useState("");
  const [formPersonaName, setFormPersonaName] = useState("");
  const [formTone, setFormTone] = useState("friendly-professional");
  const [formGreeting, setFormGreeting] = useState("");
  const [formSmsGreeting, setFormSmsGreeting] = useState("");
  const [formSignature, setFormSignature] = useState("");
  const [formGoals, setFormGoals] = useState("");
  const [formServiceDescription, setFormServiceDescription] = useState("");
  // Note: ICP removed from persona form - it's workspace-level in General Settings (Phase 39g)
  const [saving, setSaving] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);

  // Load personas (with auto-create default on first visit per Phase 39g locked decision)
  const loadPersonas = useCallback(async () => {
    if (!activeWorkspace) {
      setPersonas([]);
      return;
    }

    setLoading(true);
    const result = await listAiPersonas(activeWorkspace);
    if (result.success && result.data) {
      if (result.data.length === 0) {
        // Auto-create default persona from WorkspaceSettings (Phase 39g locked decision)
        // This is admin-gated and idempotent - will fail gracefully for non-admins
        const createResult = await getOrCreateDefaultPersonaFromSettings(activeWorkspace);
        if (createResult.success && createResult.data) {
          // Reload after auto-create
          const reloadResult = await listAiPersonas(activeWorkspace);
          if (reloadResult.success && reloadResult.data) {
            setPersonas(reloadResult.data);
            setShowMigrationBanner(false);
          }
        } else {
          // Auto-create failed (likely non-admin) - show migration banner for manual action
          setPersonas([]);
          setShowMigrationBanner(true);
        }
      } else {
        setPersonas(result.data);
        setShowMigrationBanner(false);
      }
    } else {
      toast.error(result.error || "Failed to load AI personas");
    }
    setLoading(false);
  }, [activeWorkspace]);

  useEffect(() => {
    loadPersonas();
  }, [loadPersonas]);

  // Reset form
  const resetForm = () => {
    setFormName("");
    setFormPersonaName("");
    setFormTone("friendly-professional");
    setFormGreeting("");
    setFormSmsGreeting("");
    setFormSignature("");
    setFormGoals("");
    setFormServiceDescription("");
    setAdvancedOpen(false);
  };

  // Open create dialog
  const handleCreate = () => {
    resetForm();
    setIsCreating(true);
    setEditingPersona(null);
  };

  // Open edit dialog
  const handleEdit = async (persona: AiPersonaSummary) => {
    const result = await getAiPersona(persona.id);
    if (result.success && result.data) {
      setFormName(result.data.name);
      setFormPersonaName(result.data.personaName || "");
      setFormTone(result.data.tone);
      setFormGreeting(result.data.greeting || "");
      setFormSmsGreeting(result.data.smsGreeting || "");
      setFormSignature(result.data.signature || "");
      setFormGoals(result.data.goals || "");
      setFormServiceDescription(result.data.serviceDescription || "");
      setEditingPersona(result.data);
      setIsCreating(false);
      // Open advanced if any advanced fields have values
      setAdvancedOpen(!!result.data.serviceDescription);
    } else {
      toast.error(result.error || "Failed to load persona");
    }
  };

  // Duplicate persona
  const handleDuplicate = async (persona: AiPersonaSummary) => {
    const result = await duplicateAiPersona(persona.id);
    if (result.success) {
      toast.success("Persona duplicated");
      loadPersonas();
    } else {
      toast.error(result.error || "Failed to duplicate");
    }
  };

  // Set as default
  const handleSetDefault = async (persona: AiPersonaSummary) => {
    if (persona.isDefault) return;

    const result = await setDefaultAiPersona(persona.id);
    if (result.success) {
      toast.success(`"${persona.name}" is now the default persona`);
      loadPersonas();
    } else {
      toast.error(result.error || "Failed to set default");
    }
  };

  // Delete persona
  const handleDelete = async () => {
    if (!deleteTarget) return;

    const result = await deleteAiPersona(deleteTarget.id);
    if (result.success) {
      toast.success("Persona deleted");
      loadPersonas();
    } else {
      toast.error(result.error || "Failed to delete");
    }
    setDeleteTarget(null);
  };

  // Save persona (create or update)
  const handleSave = async () => {
    if (!activeWorkspace) return;

    if (!formName.trim()) {
      toast.error("Persona name is required");
      return;
    }

    setSaving(true);

    const input: CreateAiPersonaInput = {
      name: formName.trim(),
      personaName: formPersonaName.trim() || null,
      tone: formTone,
      greeting: formGreeting.trim() || null,
      smsGreeting: formSmsGreeting.trim() || null,
      signature: formSignature.trim() || null,
      goals: formGoals.trim() || null,
      serviceDescription: formServiceDescription.trim() || null,
      // Note: ICP is workspace-level in General Settings (Phase 39g)
    };

    if (editingPersona) {
      // Update existing
      const result = await updateAiPersona(editingPersona.id, input);
      if (result.success) {
        toast.success("Persona updated");
        setEditingPersona(null);
        loadPersonas();
      } else {
        toast.error(result.error || "Failed to update persona");
      }
    } else {
      // Create new
      const result = await createAiPersona(activeWorkspace, input);
      if (result.success) {
        toast.success("Persona created");
        setIsCreating(false);
        loadPersonas();
      } else {
        toast.error(result.error || "Failed to create persona");
      }
    }

    setSaving(false);
  };

  // Migrate from settings
  const handleMigrateFromSettings = async () => {
    if (!activeWorkspace) return;

    setSaving(true);
    const result = await getOrCreateDefaultPersonaFromSettings(activeWorkspace);
    if (result.success && result.data) {
      toast.success("Created persona from existing settings");
      setShowMigrationBanner(false);
      loadPersonas();
    } else {
      toast.error(result.error || "Failed to create persona from settings");
    }
    setSaving(false);
  };

  // Dialog open state
  const isDialogOpen = isCreating || editingPersona !== null;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Bot className="h-5 w-5" />
              AI Personas
            </CardTitle>
            <CardDescription>
              Create multiple personas to customize how the AI communicates for different campaigns
            </CardDescription>
          </div>
          <Button onClick={handleCreate} disabled={!activeWorkspace || loading}>
            <Plus className="h-4 w-4 mr-1.5" />
            Create Persona
          </Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Migration Banner */}
        {showMigrationBanner && !loading && (
          <div className="rounded-lg border bg-muted/30 p-4 space-y-3">
            <div className="flex items-start gap-3">
              <Bot className="h-5 w-5 text-primary mt-0.5" />
              <div className="space-y-1">
                <p className="text-sm font-medium">
                  Get started with AI Personas
                </p>
                <p className="text-sm text-muted-foreground">
                  Create your first persona from your existing AI personality settings, or start fresh with a new persona.
                </p>
              </div>
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handleMigrateFromSettings}
                disabled={saving}
              >
                {saving ? (
                  <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                ) : (
                  <Users className="h-4 w-4 mr-1.5" />
                )}
                Import from Current Settings
              </Button>
              <Button variant="ghost" size="sm" onClick={handleCreate}>
                <Plus className="h-4 w-4 mr-1.5" />
                Create New Persona
              </Button>
            </div>
          </div>
        )}

        {/* Loading */}
        {loading && (
          <div className="py-8 text-center text-muted-foreground">
            <Loader2 className="h-6 w-6 animate-spin mx-auto mb-2" />
            Loading personas...
          </div>
        )}

        {/* No workspace selected */}
        {!activeWorkspace && !loading && (
          <div className="py-8 text-center text-muted-foreground">
            Select a workspace to manage AI personas.
          </div>
        )}

        {/* Persona List */}
        {activeWorkspace && !loading && personas.length > 0 && (
          <div className="grid gap-3">
            {personas.map((persona) => (
              <div
                key={persona.id}
                className="flex items-center justify-between gap-4 p-4 rounded-lg border bg-card hover:bg-muted/30 transition-colors"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="flex items-center justify-center h-10 w-10 rounded-full bg-primary/10 text-primary shrink-0">
                    <Bot className="h-5 w-5" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium truncate">{persona.name}</span>
                      {persona.isDefault && (
                        <Badge variant="default" className="text-xs shrink-0">
                          <Star className="h-3 w-3 mr-1" />
                          Default
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      {persona.personaName && (
                        <span className="truncate">Signs as: {persona.personaName}</span>
                      )}
                      <Badge variant="outline" className="text-xs">
                        {TONE_OPTIONS.find((t) => t.value === persona.tone)?.label || persona.tone}
                      </Badge>
                      {persona.campaignCount > 0 && (
                        <span className="text-xs">
                          {persona.campaignCount} campaign{persona.campaignCount !== 1 ? "s" : ""}
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-1 shrink-0">
                  {!persona.isDefault && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleSetDefault(persona)}
                      title="Set as default"
                    >
                      <Star className="h-4 w-4" />
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleEdit(persona)}
                    title="Edit"
                  >
                    <Edit2 className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleDuplicate(persona)}
                    title="Duplicate"
                  >
                    <Copy className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setDeleteTarget(persona)}
                    title="Delete"
                    className="text-muted-foreground hover:text-destructive"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Empty state (after loading, with workspace, no migration banner) */}
        {activeWorkspace && !loading && personas.length === 0 && !showMigrationBanner && (
          <div className="py-8 text-center text-muted-foreground">
            <Bot className="h-10 w-10 mx-auto mb-3 opacity-50" />
            <p>No personas yet.</p>
            <p className="text-sm mt-1">Create your first persona to customize how the AI communicates.</p>
          </div>
        )}
      </CardContent>

      {/* Create/Edit Dialog */}
      <Dialog open={isDialogOpen} onOpenChange={(open) => {
        if (!open) {
          setIsCreating(false);
          setEditingPersona(null);
        }
      }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editingPersona ? "Edit Persona" : "Create Persona"}
            </DialogTitle>
            <DialogDescription>
              {editingPersona
                ? "Update the persona settings below."
                : "Define how the AI should communicate using this persona."}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-6 py-4">
            {/* Basic Info */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="persona-name">Persona Name *</Label>
                <Input
                  id="persona-name"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  placeholder="e.g., Direct Sales Rep"
                />
                <p className="text-xs text-muted-foreground">
                  Internal name to identify this persona
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="persona-display-name">AI Display Name</Label>
                <Input
                  id="persona-display-name"
                  value={formPersonaName}
                  onChange={(e) => setFormPersonaName(e.target.value)}
                  placeholder="e.g., Sarah"
                />
                <p className="text-xs text-muted-foreground">
                  Name used in outreach messages
                </p>
              </div>
            </div>

            {/* Tone */}
            <div className="space-y-2">
              <Label>Communication Tone</Label>
              <Select value={formTone} onValueChange={setFormTone}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TONE_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Greetings */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="email-greeting" className="flex items-center gap-2">
                  <Mail className="h-4 w-4" />
                  Email Greeting
                </Label>
                <Input
                  id="email-greeting"
                  value={formGreeting}
                  onChange={(e) => setFormGreeting(e.target.value)}
                  placeholder="Hi {firstName},"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="sms-greeting" className="flex items-center gap-2">
                  <MessageSquare className="h-4 w-4" />
                  SMS Greeting
                </Label>
                <Input
                  id="sms-greeting"
                  value={formSmsGreeting}
                  onChange={(e) => setFormSmsGreeting(e.target.value)}
                  placeholder="Hi {firstName},"
                />
              </div>
            </div>
            <p className="text-xs text-muted-foreground -mt-2">
              Use {"{firstName}"}, {"{lastName}"} as variables in greetings
            </p>

            {/* Signature */}
            <div className="space-y-2">
              <Label htmlFor="signature">Email Signature</Label>
              <Textarea
                id="signature"
                value={formSignature}
                onChange={(e) => setFormSignature(e.target.value)}
                rows={3}
                placeholder="Best regards,&#10;Your Name&#10;Company Name"
              />
            </div>

            {/* Goals */}
            <div className="space-y-2">
              <Label htmlFor="goals">AI Goals & Strategy</Label>
              <Textarea
                id="goals"
                value={formGoals}
                onChange={(e) => setFormGoals(e.target.value)}
                rows={3}
                placeholder="Example: Prioritize booking intro calls within 7 days; keep tone consultative."
              />
              <p className="text-xs text-muted-foreground">
                Describe the goals the AI should prioritize with this persona.
              </p>
            </div>

            {/* Advanced Section */}
            <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
              <CollapsibleTrigger asChild>
                <Button variant="ghost" size="sm" className="w-full justify-between">
                  <span className="text-sm text-muted-foreground">
                    Advanced Settings
                  </span>
                  {advancedOpen ? (
                    <ChevronUp className="h-4 w-4" />
                  ) : (
                    <ChevronDown className="h-4 w-4" />
                  )}
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent className="space-y-4 pt-4">
                <Separator />

                {/* Service Description */}
                <div className="space-y-2">
                  <Label htmlFor="service-description">Service Description</Label>
                  <Textarea
                    id="service-description"
                    value={formServiceDescription}
                    onChange={(e) => setFormServiceDescription(e.target.value)}
                    rows={4}
                    placeholder="Describe your business, services, and value proposition."
                  />
                  <p className="text-xs text-muted-foreground">
                    Helps the AI communicate your offering effectively.
                  </p>
                </div>

              </CollapsibleContent>
            </Collapsible>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setIsCreating(false);
                setEditingPersona(null);
              }}
            >
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saving || !formName.trim()}>
              {saving ? (
                <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
              ) : (
                <Check className="h-4 w-4 mr-1.5" />
              )}
              {editingPersona ? "Save Changes" : "Create Persona"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={deleteTarget !== null} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Persona</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget?.isDefault ? (
                <>
                  This is the default persona. Deleting it will promote another persona to default.
                  {deleteTarget?.campaignCount > 0 && (
                    <>
                      {" "}The {deleteTarget.campaignCount} campaign{deleteTarget.campaignCount !== 1 ? "s" : ""}{" "}
                      using this persona will fall back to the new default.
                    </>
                  )}
                </>
              ) : deleteTarget?.campaignCount && deleteTarget.campaignCount > 0 ? (
                <>
                  The {deleteTarget.campaignCount} campaign{deleteTarget.campaignCount !== 1 ? "s" : ""}{" "}
                  using this persona will fall back to the default persona.
                </>
              ) : (
                <>Are you sure you want to delete &quot;{deleteTarget?.name}&quot;?</>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
