"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Plus,
  Trash2,
  Edit2,
  ChevronDown,
  ChevronUp,
  Mail,
  MessageSquare,
  Linkedin,
  Phone,
  Calendar,
  GripVertical,
  Check,
  X,
  Loader2,
  Play,
  Pause,
  Copy,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { toast } from "sonner";
import {
  getFollowUpSequences,
  createFollowUpSequence,
  updateFollowUpSequence,
  deleteFollowUpSequence,
  toggleSequenceActive,
  createDefaultSequence,
  createAllDefaultSequences,
  type FollowUpSequenceData,
  type FollowUpStepData,
  type StepCondition,
} from "@/actions/followup-sequence-actions";

interface FollowUpSequenceManagerProps {
  clientId: string | null;
}

const CHANNEL_ICONS = {
  email: Mail,
  sms: MessageSquare,
  linkedin: Linkedin,
  ai_voice: Phone,
};

const CHANNEL_LABELS = {
  email: "Email",
  sms: "SMS",
  linkedin: "LinkedIn",
  ai_voice: "AI Voice",
};

const TRIGGER_OPTIONS = [
  { value: "no_response", label: "No response (after 24h)" },
  { value: "meeting_selected", label: "After meeting selected" },
  { value: "manual", label: "Manual trigger only" },
];

const CONDITION_OPTIONS = [
  { value: "always", label: "Always run" },
  { value: "phone_provided", label: "If phone number provided" },
  { value: "linkedin_connected", label: "If LinkedIn connected" },
  { value: "no_response", label: "If no response" },
  { value: "email_opened", label: "If email opened" },
];

export function FollowUpSequenceManager({ clientId }: FollowUpSequenceManagerProps) {
  const [sequences, setSequences] = useState<FollowUpSequenceData[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [expandedSequenceId, setExpandedSequenceId] = useState<string | null>(null);
  
  // Dialog state
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingSequence, setEditingSequence] = useState<FollowUpSequenceData | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  // Form state for new/edit sequence
  const [formData, setFormData] = useState({
    name: "",
    description: "",
    triggerOn: "no_response" as "no_response" | "meeting_selected" | "manual",
    steps: [] as Omit<FollowUpStepData, "id">[],
  });

  // Load sequences
  const loadSequences = useCallback(async () => {
    if (!clientId) {
      setSequences([]);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    const result = await getFollowUpSequences(clientId);
    if (result.success && result.data) {
      setSequences(result.data);
    }
    setIsLoading(false);
  }, [clientId]);

  useEffect(() => {
    loadSequences();
  }, [loadSequences]);

  // Create default sequence (No Response only)
  const handleCreateDefault = async () => {
    if (!clientId) return;
    setIsSaving(true);
    const result = await createDefaultSequence(clientId);
    if (result.success) {
      toast.success("Default sequence created");
      loadSequences();
    } else {
      toast.error(result.error || "Failed to create sequence");
    }
    setIsSaving(false);
  };

  // Create all default sequences (No Response + Post-Booking)
  const handleCreateAllDefaults = async () => {
    if (!clientId) return;
    setIsSaving(true);
    const result = await createAllDefaultSequences(clientId);
    if (result.success) {
      const count = result.sequenceIds?.length || 0;
      toast.success(`${count} default sequence${count !== 1 ? 's' : ''} created`);
      loadSequences();
    } else {
      const errorMsg = result.errors?.join(", ") || "Failed to create sequences";
      toast.error(errorMsg);
    }
    setIsSaving(false);
  };

  // Open dialog for new sequence
  const handleNewSequence = () => {
    setEditingSequence(null);
    setFormData({
      name: "",
      description: "",
      triggerOn: "no_response",
      steps: [
        {
          stepOrder: 1,
          dayOffset: 2,
          channel: "email",
          messageTemplate: "",
          subject: "",
          condition: { type: "always" },
          requiresApproval: false,
          fallbackStepId: null,
        },
      ],
    });
    setIsDialogOpen(true);
  };

  // Open dialog for editing
  const handleEditSequence = (sequence: FollowUpSequenceData) => {
    setEditingSequence(sequence);
    setFormData({
      name: sequence.name,
      description: sequence.description || "",
      triggerOn: sequence.triggerOn,
      steps: sequence.steps.map((s) => ({
        stepOrder: s.stepOrder,
        dayOffset: s.dayOffset,
        channel: s.channel,
        messageTemplate: s.messageTemplate,
        subject: s.subject,
        condition: s.condition,
        requiresApproval: s.requiresApproval,
        fallbackStepId: s.fallbackStepId,
      })),
    });
    setIsDialogOpen(true);
  };

  // Save sequence
  const handleSaveSequence = async () => {
    if (!clientId) return;
    if (!formData.name.trim()) {
      toast.error("Please enter a sequence name");
      return;
    }
    if (formData.steps.length === 0) {
      toast.error("Please add at least one step");
      return;
    }

    setIsSaving(true);

    if (editingSequence) {
      const result = await updateFollowUpSequence(editingSequence.id, {
        name: formData.name,
        description: formData.description,
        triggerOn: formData.triggerOn,
        steps: formData.steps,
      });
      if (result.success) {
        toast.success("Sequence updated");
        setIsDialogOpen(false);
        loadSequences();
      } else {
        toast.error(result.error || "Failed to update sequence");
      }
    } else {
      const result = await createFollowUpSequence({
        clientId,
        name: formData.name,
        description: formData.description,
        triggerOn: formData.triggerOn,
        steps: formData.steps,
      });
      if (result.success) {
        toast.success("Sequence created");
        setIsDialogOpen(false);
        loadSequences();
      } else {
        toast.error(result.error || "Failed to create sequence");
      }
    }

    setIsSaving(false);
  };

  // Delete sequence
  const handleDeleteSequence = async (sequenceId: string) => {
    if (!confirm("Are you sure you want to delete this sequence?")) return;

    const result = await deleteFollowUpSequence(sequenceId);
    if (result.success) {
      toast.success("Sequence deleted");
      loadSequences();
    } else {
      toast.error(result.error || "Failed to delete sequence");
    }
  };

  // Toggle sequence active
  const handleToggleActive = async (sequenceId: string) => {
    const result = await toggleSequenceActive(sequenceId);
    if (result.success) {
      setSequences((prev) =>
        prev.map((s) =>
          s.id === sequenceId ? { ...s, isActive: result.isActive! } : s
        )
      );
      toast.success(result.isActive ? "Sequence activated" : "Sequence paused");
    } else {
      toast.error(result.error || "Failed to toggle sequence");
    }
  };

  // Add step
  const handleAddStep = () => {
    const lastStep = formData.steps[formData.steps.length - 1];
    const newStep: Omit<FollowUpStepData, "id"> = {
      stepOrder: (lastStep?.stepOrder || 0) + 1,
      dayOffset: (lastStep?.dayOffset || 0) + 2,
      channel: "email",
      messageTemplate: "",
      subject: "",
      condition: { type: "always" },
      requiresApproval: false,
      fallbackStepId: null,
    };
    setFormData({ ...formData, steps: [...formData.steps, newStep] });
  };

  // Remove step
  const handleRemoveStep = (index: number) => {
    const newSteps = formData.steps.filter((_, i) => i !== index);
    // Renumber steps
    newSteps.forEach((s, i) => {
      s.stepOrder = i + 1;
    });
    setFormData({ ...formData, steps: newSteps });
  };

  // Update step
  const handleUpdateStep = (index: number, updates: Partial<Omit<FollowUpStepData, "id">>) => {
    const newSteps = [...formData.steps];
    newSteps[index] = { ...newSteps[index], ...updates };
    setFormData({ ...formData, steps: newSteps });
  };

  const appendToStepMessageTemplate = (index: number, snippet: string) => {
    const current = formData.steps[index]?.messageTemplate || "";
    const needsSpacer = current.length > 0 && !current.endsWith(" ") && !current.endsWith("\n");
    handleUpdateStep(index, { messageTemplate: `${current}${needsSpacer ? " " : ""}${snippet}` });
  };

  if (!clientId) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-muted-foreground">
          Select a workspace to manage follow-up sequences
        </CardContent>
      </Card>
    );
  }

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-8 flex items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6 px-6 sm:px-8 pb-10">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">Follow-Up Sequences</h3>
          <p className="text-sm text-muted-foreground">
            Create automated multi-step follow-up sequences for your leads
          </p>
        </div>
        <div className="flex items-center gap-2">
          {sequences.length === 0 && (
            <Button
              variant="outline"
              onClick={handleCreateAllDefaults}
              disabled={isSaving}
            >
              {isSaving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Create All Default Sequences
            </Button>
          )}
          <Button onClick={handleNewSequence}>
            <Plus className="h-4 w-4 mr-2" />
            New Sequence
          </Button>
        </div>
      </div>

      {/* Sequences List */}
      {sequences.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Calendar className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
            <h4 className="text-lg font-medium mb-2">No Sequences Yet</h4>
            <p className="text-muted-foreground mb-4">
              Create your first follow-up sequence to automate lead engagement
            </p>
            <div className="flex flex-col sm:flex-row gap-2 justify-center">
              <Button onClick={handleCreateAllDefaults} disabled={isSaving}>
                {isSaving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Create All Default Sequences
              </Button>
              <Button variant="outline" onClick={handleCreateDefault} disabled={isSaving}>
                {isSaving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Create Day 2/5/7 Only
              </Button>
            </div>
            <p className="text-xs text-muted-foreground mt-4">
              &quot;All Default&quot; creates No Response (Day 2/5/7), Meeting Requested (Day 1/2/5/7), and Post-Booking Qualification sequences
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {sequences.map((sequence) => (
            <Card key={sequence.id}>
                <Collapsible
                  open={expandedSequenceId === sequence.id}
                  onOpenChange={(open: boolean) =>
                    setExpandedSequenceId(open ? sequence.id : null)
                  }
                >
                <CardHeader className="py-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <CollapsibleTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-8 w-8">
                          {expandedSequenceId === sequence.id ? (
                            <ChevronUp className="h-4 w-4" />
                          ) : (
                            <ChevronDown className="h-4 w-4" />
                          )}
                        </Button>
                      </CollapsibleTrigger>
                      <div>
                        <div className="flex items-center gap-2">
                          <h4 className="font-medium">{sequence.name}</h4>
                          <Badge
                            variant={sequence.isActive ? "default" : "secondary"}
                            className="text-xs"
                          >
                            {sequence.isActive ? "Active" : "Paused"}
                          </Badge>
                        </div>
                        <p className="text-sm text-muted-foreground">
                          {sequence.steps.length} steps ·{" "}
                          {TRIGGER_OPTIONS.find((t) => t.value === sequence.triggerOn)?.label}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleToggleActive(sequence.id)}
                        title={sequence.isActive ? "Pause sequence" : "Activate sequence"}
                      >
                        {sequence.isActive ? (
                          <Pause className="h-4 w-4" />
                        ) : (
                          <Play className="h-4 w-4" />
                        )}
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleEditSequence(sequence)}
                      >
                        <Edit2 className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="text-destructive hover:text-destructive"
                        onClick={() => handleDeleteSequence(sequence.id)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CollapsibleContent>
                  <CardContent className="pt-0">
                    {sequence.description && (
                      <p className="text-sm text-muted-foreground mb-4">
                        {sequence.description}
                      </p>
                    )}
                    {/* Steps Timeline */}
                    <div className="relative pl-6 space-y-4">
                      <div className="absolute left-2 top-2 bottom-2 w-0.5 bg-border" />
                      {sequence.steps.map((step, index) => {
                        const ChannelIcon = CHANNEL_ICONS[step.channel];
                        const isUnsupported = step.channel === "ai_voice";

                        return (
                          <div key={step.id || index} className="relative flex items-start gap-3">
                            <div
                              className={`absolute -left-4 w-4 h-4 rounded-full border-2 bg-background ${
                                isUnsupported
                                  ? "border-muted-foreground"
                                  : "border-primary"
                              }`}
                            />
                            <div className="flex-1 p-3 rounded-lg border bg-muted/50">
                              <div className="flex items-center gap-2 mb-1">
                                <Badge variant="outline" className="text-xs">
                                  Day {step.dayOffset}
                                </Badge>
                                <ChannelIcon className="h-4 w-4 text-muted-foreground" />
                                <span className="text-sm font-medium">
                                  {CHANNEL_LABELS[step.channel]}
                                </span>
                                {step.channel === "ai_voice" && (
                                  <Badge variant="secondary" className="text-xs">
                                    Coming Soon
                                  </Badge>
                                )}
                                {step.requiresApproval && (
                                  <Badge variant="outline" className="text-xs text-amber-500 border-amber-500/30">
                                    Requires Approval
                                  </Badge>
                                )}
                              </div>
                              {step.condition && step.condition.type !== "always" && (
                                <p className="text-xs text-muted-foreground">
                                  Condition:{" "}
                                  {CONDITION_OPTIONS.find((c) => c.value === step.condition?.type)?.label}
                                </p>
                              )}
                              {step.messageTemplate && (
                                <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                                  {step.messageTemplate.slice(0, 100)}
                                  {step.messageTemplate.length > 100 && "..."}
                                </p>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </CardContent>
                </CollapsibleContent>
              </Collapsible>
            </Card>
          ))}
        </div>
      )}

      {/* Create/Edit Dialog */}
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editingSequence ? "Edit Sequence" : "Create New Sequence"}
            </DialogTitle>
            <DialogDescription>
              Define the steps and timing for your follow-up sequence
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-6 py-4">
            {/* Basic Info */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="name">Sequence Name</Label>
                <Input
                  id="name"
                  placeholder="e.g., Post-Meeting Follow-up"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>Trigger</Label>
                <Select
                  value={formData.triggerOn}
                  onValueChange={(v) =>
                    setFormData({
                      ...formData,
                      triggerOn: v as typeof formData.triggerOn,
                    })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TRIGGER_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="description">Description (optional)</Label>
              <Textarea
                id="description"
                placeholder="Brief description of this sequence..."
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                rows={2}
              />
            </div>

            <Separator />

            {/* Steps */}
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <Label>Steps</Label>
                <Button variant="outline" size="sm" onClick={handleAddStep}>
                  <Plus className="h-4 w-4 mr-1" />
                  Add Step
                </Button>
              </div>

              {formData.steps.map((step, index) => {
                const ChannelIcon = CHANNEL_ICONS[step.channel];
                const isUnsupported = step.channel === "ai_voice";

                return (
                  <Card key={index} className="bg-muted/50">
                    <CardContent className="pt-4 space-y-4">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <GripVertical className="h-4 w-4 text-muted-foreground" />
                          <Badge variant="outline">Step {index + 1}</Badge>
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-destructive hover:text-destructive"
                          onClick={() => handleRemoveStep(index)}
                          disabled={formData.steps.length === 1}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>

                      <div className="grid grid-cols-3 gap-3">
                        <div className="space-y-1.5">
                          <Label className="text-xs">Day</Label>
                          <Input
                            type="number"
                            min={0}
                            value={step.dayOffset}
                            onChange={(e) =>
                              handleUpdateStep(index, {
                                dayOffset: parseInt(e.target.value) || 0,
                              })
                            }
                          />
                        </div>
                        <div className="space-y-1.5">
                          <Label className="text-xs">Channel</Label>
                          <Select
                            value={step.channel}
                            onValueChange={(v) =>
                              handleUpdateStep(index, {
                                channel: v as typeof step.channel,
                              })
                            }
                          >
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="email">
                                <div className="flex items-center gap-2">
                                  <Mail className="h-4 w-4" />
                                  Email
                                </div>
                              </SelectItem>
                              <SelectItem value="sms">
                                <div className="flex items-center gap-2">
                                  <MessageSquare className="h-4 w-4" />
                                  SMS
                                </div>
                              </SelectItem>
                              <SelectItem value="linkedin">
                                <div className="flex items-center gap-2">
                                  <Linkedin className="h-4 w-4" />
                                  LinkedIn
                                </div>
                              </SelectItem>
                              <SelectItem value="ai_voice">
                                <div className="flex items-center gap-2">
                                  <Phone className="h-4 w-4" />
                                  AI Voice (Coming Soon)
                                </div>
                              </SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-1.5">
                          <Label className="text-xs">Condition</Label>
                          <Select
                            value={step.condition?.type || "always"}
                            onValueChange={(v) =>
                              handleUpdateStep(index, {
                                condition: { type: v as StepCondition["type"] },
                              })
                            }
                          >
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {CONDITION_OPTIONS.map((opt) => (
                                <SelectItem key={opt.value} value={opt.value}>
                                  {opt.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>

                      {step.channel === "email" && (
                        <div className="space-y-1.5">
                          <Label className="text-xs">Subject Line</Label>
                          <Input
                            placeholder="Re: Following up..."
                            value={step.subject || ""}
                            onChange={(e) =>
                              handleUpdateStep(index, { subject: e.target.value })
                            }
                          />
                        </div>
                      )}

                      <div className="space-y-1.5">
                        <Label className="text-xs">Message Template</Label>
                        <div className="flex flex-wrap items-center gap-2">
                          <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            onClick={() => appendToStepMessageTemplate(index, "{calendarLink}")}
                            disabled={isUnsupported}
                            className="h-7 px-2 text-xs"
                            title="Insert {calendarLink}"
                          >
                            <Calendar className="h-3.5 w-3.5 mr-1.5" />
                            Calendar Link
                          </Button>
                        </div>
                        <Textarea
                          placeholder={`Hi {firstName},\n\nYour message here...`}
                          value={step.messageTemplate || ""}
                          onChange={(e) =>
                            handleUpdateStep(index, { messageTemplate: e.target.value })
                          }
                          rows={3}
                          disabled={isUnsupported}
                        />
                        <p className="text-xs text-muted-foreground">
                          Variables: {"{firstName}"}, {"{lastName}"}, {"{email}"}, {"{availability}"}, {"{calendarLink}"}
                        </p>
                      </div>

                      <div className="flex items-center justify-between pt-2">
                        <label className="flex items-center gap-2 text-sm">
                          <Switch
                            checked={step.requiresApproval}
                            onCheckedChange={(v) =>
                              handleUpdateStep(index, { requiresApproval: v })
                            }
                          />
                          Require manual approval
                        </label>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSaveSequence} disabled={isSaving}>
              {isSaving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {editingSequence ? "Update Sequence" : "Create Sequence"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
