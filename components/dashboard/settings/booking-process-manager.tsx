"use client";

/**
 * Booking Process Manager (Phase 36)
 *
 * CRUD interface for managing booking processes and their stages.
 */

import { useCallback, useEffect, useState } from "react";
import {
  Plus,
  Trash2,
  Edit2,
  Copy,
  ChevronDown,
  ChevronUp,
  Mail,
  MessageSquare,
  Linkedin,
  Link2,
  Clock,
  HelpCircle,
  Globe,
  AlertTriangle,
  Loader2,
  Save,
  X,
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
import { Switch } from "@/components/ui/switch";
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
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import {
  listBookingProcesses,
  getBookingProcess,
  createBookingProcess,
  updateBookingProcess,
  deleteBookingProcess,
  duplicateBookingProcess,
  type BookingProcessSummary,
  type BookingProcessWithStages,
  type BookingProcessStageInput,
} from "@/actions/booking-process-actions";
import {
  BOOKING_PROCESS_TEMPLATES,
  type TemplateBookingProcess,
} from "@/lib/booking-process-templates";
import type { BookingProcessLinkType } from "@prisma/client";

interface BookingProcessManagerProps {
  activeWorkspace?: string | null;
  qualificationQuestions?: Array<{ id: string; question: string; required?: boolean }>;
}

// Default stage for new stages
const defaultStage: BookingProcessStageInput = {
  stageNumber: 1,
  includeBookingLink: false,
  linkType: "PLAIN_URL",
  includeSuggestedTimes: false,
  numberOfTimesToSuggest: 3,
  includeQualifyingQuestions: false,
  qualificationQuestionIds: [],
  includeTimezoneAsk: false,
  applyToEmail: true,
  applyToSms: true,
  applyToLinkedin: true,
};

export function BookingProcessManager({
  activeWorkspace,
  qualificationQuestions = [],
}: BookingProcessManagerProps) {
  const [processes, setProcesses] = useState<BookingProcessSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [editingProcess, setEditingProcess] = useState<BookingProcessWithStages | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<BookingProcessSummary | null>(null);
  const [showTemplates, setShowTemplates] = useState(false);

  // Form state for create/edit
  const [formName, setFormName] = useState("");
  const [formDescription, setFormDescription] = useState("");
  const [formMaxWaves, setFormMaxWaves] = useState(5);
  const [formStages, setFormStages] = useState<BookingProcessStageInput[]>([{ ...defaultStage }]);
  const [saving, setSaving] = useState(false);

  // Load processes
  const loadProcesses = useCallback(async () => {
    if (!activeWorkspace) {
      setProcesses([]);
      return;
    }

    setLoading(true);
    const result = await listBookingProcesses(activeWorkspace);
    if (result.success && result.data) {
      setProcesses(result.data);
    } else {
      toast.error(result.error || "Failed to load booking processes");
    }
    setLoading(false);
  }, [activeWorkspace]);

  useEffect(() => {
    loadProcesses();
  }, [loadProcesses]);

  // Reset form
  const resetForm = () => {
    setFormName("");
    setFormDescription("");
    setFormMaxWaves(5);
    setFormStages([{ ...defaultStage }]);
  };

  // Open create dialog
  const handleCreate = () => {
    resetForm();
    setIsCreating(true);
    setEditingProcess(null);
  };

  // Open edit dialog
  const handleEdit = async (process: BookingProcessSummary) => {
    const result = await getBookingProcess(process.id);
    if (result.success && result.data) {
      setFormName(result.data.name);
      setFormDescription(result.data.description || "");
      setFormMaxWaves(result.data.maxWavesBeforeEscalation);
      setFormStages(
        result.data.stages.map((s) => ({
          stageNumber: s.stageNumber,
          includeBookingLink: s.includeBookingLink,
          linkType: s.linkType,
          includeSuggestedTimes: s.includeSuggestedTimes,
          numberOfTimesToSuggest: s.numberOfTimesToSuggest,
          includeQualifyingQuestions: s.includeQualifyingQuestions,
          qualificationQuestionIds: s.qualificationQuestionIds,
          includeTimezoneAsk: s.includeTimezoneAsk,
          applyToEmail: s.applyToEmail,
          applyToSms: s.applyToSms,
          applyToLinkedin: s.applyToLinkedin,
        }))
      );
      setEditingProcess(result.data);
      setIsCreating(false);
    } else {
      toast.error(result.error || "Failed to load booking process");
    }
  };

  // Duplicate process
  const handleDuplicate = async (process: BookingProcessSummary) => {
    const result = await duplicateBookingProcess(process.id);
    if (result.success) {
      toast.success("Booking process duplicated");
      loadProcesses();
    } else {
      toast.error(result.error || "Failed to duplicate");
    }
  };

  // Delete process
  const handleDelete = async () => {
    if (!deleteTarget) return;

    const result = await deleteBookingProcess(deleteTarget.id);
    if (result.success) {
      toast.success("Booking process deleted");
      loadProcesses();
    } else {
      toast.error(result.error || "Failed to delete");
    }
    setDeleteTarget(null);
  };

  // Save (create or update)
  const handleSave = async () => {
    if (!activeWorkspace) return;

    // Validate
    if (!formName.trim()) {
      toast.error("Name is required");
      return;
    }

    if (formStages.length === 0) {
      toast.error("At least one stage is required");
      return;
    }

    // Renumber stages
    const numberedStages = formStages.map((s, i) => ({
      ...s,
      stageNumber: i + 1,
    }));

    setSaving(true);

    if (editingProcess) {
      // Update
      const result = await updateBookingProcess(editingProcess.id, {
        name: formName.trim(),
        description: formDescription.trim() || undefined,
        maxWavesBeforeEscalation: formMaxWaves,
        stages: numberedStages,
      });

      if (result.success) {
        toast.success("Booking process updated");
        setEditingProcess(null);
        loadProcesses();
      } else {
        toast.error(result.error || "Failed to update");
      }
    } else {
      // Create
      const result = await createBookingProcess({
        clientId: activeWorkspace,
        name: formName.trim(),
        description: formDescription.trim() || undefined,
        maxWavesBeforeEscalation: formMaxWaves,
        stages: numberedStages,
      });

      if (result.success) {
        toast.success("Booking process created");
        setIsCreating(false);
        loadProcesses();
      } else {
        toast.error(result.error || "Failed to create");
      }
    }

    setSaving(false);
  };

  // Create from template
  const handleCreateFromTemplate = (template: TemplateBookingProcess) => {
    setFormName(template.name);
    setFormDescription(template.description);
    setFormMaxWaves(5);
    setFormStages([...template.stages]);
    setShowTemplates(false);
    setIsCreating(true);
    setEditingProcess(null);
  };

  // Stage management
  const addStage = () => {
    setFormStages([
      ...formStages,
      { ...defaultStage, stageNumber: formStages.length + 1 },
    ]);
  };

  const removeStage = (index: number) => {
    if (formStages.length <= 1) {
      toast.error("At least one stage is required");
      return;
    }
    setFormStages(formStages.filter((_, i) => i !== index));
  };

  const moveStage = (index: number, direction: "up" | "down") => {
    const newStages = [...formStages];
    const swapIndex = direction === "up" ? index - 1 : index + 1;
    if (swapIndex < 0 || swapIndex >= newStages.length) return;
    [newStages[index], newStages[swapIndex]] = [newStages[swapIndex], newStages[index]];
    setFormStages(newStages);
  };

  const updateStage = (index: number, updates: Partial<BookingProcessStageInput>) => {
    setFormStages(
      formStages.map((s, i) => (i === index ? { ...s, ...updates } : s))
    );
  };

  const isDialogOpen = isCreating || editingProcess !== null;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Clock className="h-5 w-5" />
              Booking Processes
            </CardTitle>
            <CardDescription>
              Define when and how the AI offers booking links, times, and qualifying questions
            </CardDescription>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setShowTemplates(true)}>
              Templates
            </Button>
            <Button size="sm" onClick={handleCreate}>
              <Plus className="h-4 w-4 mr-1" />
              New Process
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : processes.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <Clock className="h-12 w-12 mx-auto mb-4 opacity-50" />
            <p>No booking processes yet</p>
            <p className="text-sm">Create one to control how the AI handles booking</p>
          </div>
        ) : (
          <div className="space-y-2">
            {processes.map((process) => (
              <div
                key={process.id}
                className="flex items-center justify-between p-3 border rounded-lg hover:bg-muted/50"
              >
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{process.name}</span>
                    <Badge variant="secondary">{process.stageCount} stages</Badge>
                    {process.campaignCount > 0 && (
                      <Badge variant="outline">
                        {process.campaignCount} campaign{process.campaignCount !== 1 ? "s" : ""}
                      </Badge>
                    )}
                  </div>
                  {process.description && (
                    <p className="text-sm text-muted-foreground mt-1">
                      {process.description}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => handleEdit(process)}
                  >
                    <Edit2 className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => handleDuplicate(process)}
                  >
                    <Copy className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setDeleteTarget(process)}
                    disabled={process.campaignCount > 0}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Templates Dialog */}
        <Dialog open={showTemplates} onOpenChange={setShowTemplates}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>Booking Process Templates</DialogTitle>
              <DialogDescription>
                Choose a template to get started quickly
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3 max-h-[400px] overflow-y-auto">
              {BOOKING_PROCESS_TEMPLATES.map((template) => (
                <div
                  key={template.name}
                  className="p-4 border rounded-lg hover:bg-muted/50 cursor-pointer"
                  onClick={() => handleCreateFromTemplate(template)}
                >
                  <div className="font-medium">{template.name}</div>
                  <div className="text-sm text-muted-foreground mt-1">
                    {template.description}
                  </div>
                  <div className="flex items-center gap-2 mt-2">
                    <Badge variant="secondary">{template.stages.length} stages</Badge>
                    {template.stages[0].includeBookingLink && (
                      <Badge variant="outline">Link in Stage 1</Badge>
                    )}
                    {template.stages[0].includeSuggestedTimes && (
                      <Badge variant="outline">Times in Stage 1</Badge>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </DialogContent>
        </Dialog>

        {/* Create/Edit Dialog */}
        <Dialog open={isDialogOpen} onOpenChange={(open) => {
          if (!open) {
            setIsCreating(false);
            setEditingProcess(null);
          }
        }}>
          <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>
                {editingProcess ? "Edit Booking Process" : "Create Booking Process"}
              </DialogTitle>
              <DialogDescription>
                Configure when and how the AI handles booking for leads
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-6">
              {/* Basic Info */}
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="name">Name *</Label>
                    <Input
                      id="name"
                      value={formName}
                      onChange={(e) => setFormName(e.target.value)}
                      placeholder="e.g., Direct Link First"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="maxWaves">Max Waves Before Escalation</Label>
                    <Input
                      id="maxWaves"
                      type="number"
                      min={1}
                      max={20}
                      value={formMaxWaves}
                      onChange={(e) => setFormMaxWaves(parseInt(e.target.value) || 5)}
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="description">Description</Label>
                  <Textarea
                    id="description"
                    value={formDescription}
                    onChange={(e) => setFormDescription(e.target.value)}
                    placeholder="When to use this booking process..."
                    rows={2}
                  />
                </div>
              </div>

              <Separator />

              {/* Stages */}
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <Label>Stages (Waves)</Label>
                  <Button variant="outline" size="sm" onClick={addStage}>
                    <Plus className="h-4 w-4 mr-1" />
                    Add Stage
                  </Button>
                </div>

                {formStages.map((stage, index) => (
                  <StageEditor
                    key={index}
                    stage={stage}
                    stageNumber={index + 1}
                    totalStages={formStages.length}
                    qualificationQuestions={qualificationQuestions}
                    onUpdate={(updates) => updateStage(index, updates)}
                    onRemove={() => removeStage(index)}
                    onMoveUp={() => moveStage(index, "up")}
                    onMoveDown={() => moveStage(index, "down")}
                  />
                ))}
              </div>
            </div>

            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => {
                  setIsCreating(false);
                  setEditingProcess(null);
                }}
              >
                Cancel
              </Button>
              <Button onClick={handleSave} disabled={saving}>
                {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                {editingProcess ? "Save Changes" : "Create Process"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Delete Confirmation */}
        <AlertDialog open={deleteTarget !== null} onOpenChange={(open) => !open && setDeleteTarget(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete Booking Process?</AlertDialogTitle>
              <AlertDialogDescription>
                This will permanently delete &ldquo;{deleteTarget?.name}&rdquo;. This action cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={handleDelete}>Delete</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </CardContent>
    </Card>
  );
}

// ----------------------------------------------------------------------------
// Stage Editor Component
// ----------------------------------------------------------------------------

interface StageEditorProps {
  stage: BookingProcessStageInput;
  stageNumber: number;
  totalStages: number;
  qualificationQuestions: Array<{ id: string; question: string; required?: boolean }>;
  onUpdate: (updates: Partial<BookingProcessStageInput>) => void;
  onRemove: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
}

function StageEditor({
  stage,
  stageNumber,
  totalStages,
  qualificationQuestions,
  onUpdate,
  onRemove,
  onMoveUp,
  onMoveDown,
}: StageEditorProps) {
  const [expanded, setExpanded] = useState(true);

  // Warnings
  const warnings: string[] = [];
  if (stageNumber === 1 && stage.includeBookingLink) {
    warnings.push("Including a booking link in the first reply may impact email deliverability.");
  }
  if (stage.linkType === "HYPERLINKED_TEXT") {
    warnings.push("Hyperlinked text may increase spam risk. Plain URLs are generally safer.");
  }
  if (stage.applyToSms && stage.linkType === "HYPERLINKED_TEXT") {
    warnings.push("SMS will always use plain URL regardless of link type setting.");
  }

  const noChannelsSelected = !stage.applyToEmail && !stage.applyToSms && !stage.applyToLinkedin;

  return (
    <div className="border rounded-lg overflow-hidden">
      {/* Header */}
      <div
        className="flex items-center justify-between p-3 bg-muted/30 cursor-pointer"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-3">
          <span className="font-medium">Wave {stageNumber}</span>
          <div className="flex items-center gap-1">
            {stage.applyToEmail && <Mail className="h-4 w-4 text-muted-foreground" />}
            {stage.applyToSms && <MessageSquare className="h-4 w-4 text-muted-foreground" />}
            {stage.applyToLinkedin && <Linkedin className="h-4 w-4 text-muted-foreground" />}
          </div>
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            {stage.includeBookingLink && <Badge variant="outline" className="text-xs">Link</Badge>}
            {stage.includeSuggestedTimes && <Badge variant="outline" className="text-xs">Times</Badge>}
            {stage.includeQualifyingQuestions && <Badge variant="outline" className="text-xs">Questions</Badge>}
            {stage.includeTimezoneAsk && <Badge variant="outline" className="text-xs">Timezone</Badge>}
          </div>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            onClick={(e) => { e.stopPropagation(); onMoveUp(); }}
            disabled={stageNumber === 1}
          >
            <ChevronUp className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={(e) => { e.stopPropagation(); onMoveDown(); }}
            disabled={stageNumber === totalStages}
          >
            <ChevronDown className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={(e) => { e.stopPropagation(); onRemove(); }}
            disabled={totalStages <= 1}
          >
            <X className="h-4 w-4" />
          </Button>
          {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </div>
      </div>

      {/* Content */}
      {expanded && (
        <div className="p-4 space-y-4">
          {/* Warnings */}
          {warnings.length > 0 && (
            <div className="space-y-1">
              {warnings.map((warning, i) => (
                <div key={i} className="flex items-start gap-2 text-sm text-amber-600">
                  <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                  <span>{warning}</span>
                </div>
              ))}
            </div>
          )}

          {/* Channel Selection */}
          <div className="space-y-2">
            <Label>Channels</Label>
            <div className="flex items-center gap-4">
              <label className="flex items-center gap-2 cursor-pointer">
                <Checkbox
                  checked={stage.applyToEmail}
                  onCheckedChange={(checked) => onUpdate({ applyToEmail: !!checked })}
                />
                <Mail className="h-4 w-4" />
                <span className="text-sm">Email</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <Checkbox
                  checked={stage.applyToSms}
                  onCheckedChange={(checked) => onUpdate({ applyToSms: !!checked })}
                />
                <MessageSquare className="h-4 w-4" />
                <span className="text-sm">SMS</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <Checkbox
                  checked={stage.applyToLinkedin}
                  onCheckedChange={(checked) => onUpdate({ applyToLinkedin: !!checked })}
                />
                <Linkedin className="h-4 w-4" />
                <span className="text-sm">LinkedIn</span>
              </label>
            </div>
            {noChannelsSelected && (
              <p className="text-sm text-destructive">At least one channel must be selected</p>
            )}
          </div>

          <Separator />

          {/* Booking Link */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Link2 className="h-4 w-4 text-muted-foreground" />
                <Label>Include Booking Link</Label>
              </div>
              <Switch
                checked={stage.includeBookingLink}
                onCheckedChange={(checked) => onUpdate({ includeBookingLink: checked })}
              />
            </div>
            {stage.includeBookingLink && (
              <div className="ml-6 space-y-2">
                <Label className="text-sm">Link Type</Label>
                <Select
                  value={stage.linkType}
                  onValueChange={(value) => onUpdate({ linkType: value as BookingProcessLinkType })}
                >
                  <SelectTrigger className="w-[200px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="PLAIN_URL">Plain URL (recommended)</SelectItem>
                    <SelectItem value="HYPERLINKED_TEXT">Hyperlinked Text</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          {/* Suggested Times */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Clock className="h-4 w-4 text-muted-foreground" />
                <Label>Include Suggested Times</Label>
              </div>
              <Switch
                checked={stage.includeSuggestedTimes}
                onCheckedChange={(checked) => onUpdate({ includeSuggestedTimes: checked })}
              />
            </div>
            {stage.includeSuggestedTimes && (
              <div className="ml-6 space-y-2">
                <Label className="text-sm">Number of Times</Label>
                <Select
                  value={String(stage.numberOfTimesToSuggest)}
                  onValueChange={(value) => onUpdate({ numberOfTimesToSuggest: parseInt(value) })}
                >
                  <SelectTrigger className="w-[100px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="2">2</SelectItem>
                    <SelectItem value="3">3</SelectItem>
                    <SelectItem value="4">4</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          {/* Qualifying Questions */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <HelpCircle className="h-4 w-4 text-muted-foreground" />
                <Label>Include Qualifying Questions</Label>
              </div>
              <Switch
                checked={stage.includeQualifyingQuestions}
                onCheckedChange={(checked) => onUpdate({ includeQualifyingQuestions: checked })}
              />
            </div>
            {stage.includeQualifyingQuestions && (
              <div className="ml-6 space-y-2">
                <Label className="text-sm">Select Questions</Label>
                {qualificationQuestions.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No qualification questions configured. Add them in AI Personality settings.
                  </p>
                ) : (
                  <div className="space-y-2 max-h-[150px] overflow-y-auto">
                    {qualificationQuestions.map((q) => (
                      <label key={q.id} className="flex items-start gap-2 cursor-pointer">
                        <Checkbox
                          checked={stage.qualificationQuestionIds.includes(q.id)}
                          onCheckedChange={(checked) => {
                            const newIds = checked
                              ? [...stage.qualificationQuestionIds, q.id]
                              : stage.qualificationQuestionIds.filter((id) => id !== q.id);
                            onUpdate({ qualificationQuestionIds: newIds });
                          }}
                        />
                        <span className="text-sm">
                          {q.question}
                          {q.required && (
                            <Badge variant="secondary" className="ml-2 text-xs">Required</Badge>
                          )}
                        </span>
                      </label>
                    ))}
                  </div>
                )}
                <p className="text-xs text-muted-foreground">
                  Note: Required questions are always included when this toggle is enabled. SMS limits to 2 questions.
                </p>
              </div>
            )}
          </div>

          {/* Timezone Ask */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Globe className="h-4 w-4 text-muted-foreground" />
              <Label>Ask for Timezone</Label>
            </div>
            <Switch
              checked={stage.includeTimezoneAsk}
              onCheckedChange={(checked) => onUpdate({ includeTimezoneAsk: checked })}
            />
          </div>
        </div>
      )}
    </div>
  );
}
