"use client"

import { useState, useEffect, useCallback } from "react"
import { useRouter } from "next/navigation"
import {
  Mail,
  Phone,
  Linkedin,
  MessageSquare,
  Clock,
  AlertCircle,
  Calendar,
  Play,
  Clock4,
  SkipForward,
  Loader2,
  Pause,
  XCircle,
  ListTodo,
  Settings2,
  MessageCircle,
  Send,
  CheckCircle2,
  ChevronDown,
  Zap,
} from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  getFollowUpTasks,
  completeFollowUpTask,
  skipFollowUpTask,
  snoozeFollowUpTask,
  getFollowUpTaggedLeads,
  updateLeadFollowUpStatus,
  type FollowUpTaggedLeadData,
  type FollowUpOutcome,
  type FollowUpTaskType,
} from "@/actions/followup-actions"
import {
  getWorkspaceFollowUpInstances,
  pauseFollowUpInstance,
  resumeFollowUpInstance,
  cancelFollowUpInstance,
  type FollowUpInstanceData,
} from "@/actions/followup-sequence-actions"
import { FollowUpSequenceManager } from "./followup-sequence-manager"
import { ReactivationsView } from "./reactivations-view"
import { toast } from "sonner"
import { cn } from "@/lib/utils"

const typeIcons: Record<FollowUpTaskType, typeof Mail> = {
  email: Mail,
  call: Phone,
  linkedin: Linkedin,
  sms: MessageSquare,
  "meeting-canceled": XCircle,
  "meeting-rescheduled": Calendar,
}

const typeColors: Record<FollowUpTaskType, string> = {
  email: "text-blue-500",
  call: "text-green-500",
  linkedin: "text-sky-500",
  sms: "text-purple-500",
  "meeting-canceled": "text-red-500",
  "meeting-rescheduled": "text-orange-500",
}

// Default icon for unknown task types (defensive fallback)
const defaultIcon = AlertCircle
const defaultColor = "text-muted-foreground"

function isToday(date: Date): boolean {
  const today = new Date()
  return new Date(date).toDateString() === today.toDateString()
}

function isOverdue(date: Date): boolean {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return new Date(date) < today
}

function formatDueDate(date: Date): string {
  const d = new Date(date)
  if (isToday(d)) return "Today"
  if (isOverdue(d)) {
    const days = Math.ceil((Date.now() - d.getTime()) / (1000 * 60 * 60 * 24))
    return `${days} day${days > 1 ? "s" : ""} overdue`
  }
  const days = Math.ceil((d.getTime() - Date.now()) / (1000 * 60 * 60 * 24))
  if (days === 1) return "Tomorrow"
  if (days <= 7) return `In ${days} days`
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" })
}

function formatTimeSince(date: Date | null): string {
  if (!date) return "No messages"
  const now = new Date()
  const d = new Date(date)
  const diffMs = now.getTime() - d.getTime()
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60))
  
  if (diffDays === 0) {
    if (diffHours === 0) return "Just now"
    return `${diffHours}h ago`
  }
  if (diffDays === 1) return "Yesterday"
  if (diffDays < 7) return `${diffDays} days ago`
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" })
}

// Unified task type
interface UnifiedTask {
  id: string
  type: FollowUpTaskType
  dueDate: Date
  leadName: string
  leadCompany: string
  leadScore?: number
  leadTitle?: string
  sequenceStep?: number | null
  totalSteps?: number | null
  campaignName?: string | null
  suggestedMessage?: string | null
  isUrgent?: boolean
}

interface TaskCardProps {
  task: UnifiedTask
  onExecute: (id: string) => void
  onSnooze: (id: string) => void
  onSkip: (id: string) => void
}

// ============================================================================
// Follow-Up Conversation Card (for leads tagged with "Follow Up")
// ============================================================================

interface FollowUpConversationCardProps {
  lead: FollowUpTaggedLeadData
  onSendFollowUp: (leadId: string) => void
  onMarkDone: (leadId: string, outcome: FollowUpOutcome) => void
  onSnooze: (leadId: string) => void
  onStartSequence: (leadId: string) => void
  actionInProgress: string | null
}

function FollowUpConversationCard({
  lead,
  onSendFollowUp,
  onMarkDone,
  onSnooze,
  onStartSequence,
  actionInProgress,
}: FollowUpConversationCardProps) {
  const isLoading = actionInProgress === lead.id
  const leadName = [lead.firstName, lead.lastName].filter(Boolean).join(" ") || "Unknown"
  const isSnoozed = lead.sentimentTag === "Snoozed"

  return (
    <Card className={cn(
      "transition-colors",
      isSnoozed && "border-amber-500/30 bg-amber-500/5"
    )}>
      <CardContent className="p-4">
        <div className="flex items-start gap-4">
          <div className={cn(
            "mt-1 rounded-lg p-2",
            isSnoozed ? "bg-amber-500/10" : "bg-primary/10"
          )}>
            <MessageCircle className={cn(
              "h-5 w-5",
              isSnoozed ? "text-amber-500" : "text-primary"
            )} />
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="font-semibold truncate">{leadName}</span>
              <Badge variant="outline" className="text-xs shrink-0">
                Score: {lead.leadScore}
              </Badge>
              {isSnoozed && (
                <Badge variant="secondary" className="text-xs shrink-0 text-amber-600">
                  Snoozed
                </Badge>
              )}
            </div>

            <p className="text-sm text-muted-foreground truncate">
              {lead.company}
            </p>

            {lead.lastMessagePreview && (
              <p className="mt-2 text-sm bg-muted/50 rounded-md p-2 line-clamp-2">
                {lead.lastMessagePreview}
              </p>
            )}

            <div className="flex items-center justify-between mt-3">
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <Clock className="h-3 w-3" />
                {lead.lastOutboundAt 
                  ? `Sent ${formatTimeSince(lead.lastOutboundAt)}`
                  : "No outbound messages"
                }
              </span>

              <div className="flex items-center gap-2">
                {/* Send Follow-Up */}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onSendFollowUp(lead.id)}
                  disabled={isLoading}
                >
                  <Send className="h-4 w-4 mr-1" />
                  Send
                </Button>

                {/* Mark as Done (Dropdown) */}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="sm" disabled={isLoading}>
                      {isLoading ? (
                        <Loader2 className="h-4 w-4 animate-spin mr-1" />
                      ) : (
                        <CheckCircle2 className="h-4 w-4 mr-1" />
                      )}
                      Done
                      <ChevronDown className="h-3 w-3 ml-1" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => onMarkDone(lead.id, "no-response")}>
                      No Response (keep following up)
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => onMarkDone(lead.id, "replied")}>
                      Replied
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => onMarkDone(lead.id, "meeting-booked")}>
                      Meeting Booked
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => onMarkDone(lead.id, "not-interested")}>
                      Not Interested
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>

                {/* Snooze */}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onSnooze(lead.id)}
                  disabled={isLoading || isSnoozed}
                >
                  <Clock4 className="h-4 w-4 mr-1" />
                  Snooze
                </Button>

                {/* Start Sequence */}
                <Button
                  size="sm"
                  onClick={() => onStartSequence(lead.id)}
                  disabled={isLoading}
                >
                  <Zap className="h-4 w-4 mr-1" />
                  Sequence
                </Button>
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

// ============================================================================
// Sequence Instance Card Component
// ============================================================================

interface SequenceInstanceCardProps {
  instance: FollowUpInstanceData
  onPause: (id: string) => void
  onResume: (id: string) => void
  onCancel: (id: string) => void
  actionInProgress: string | null
}

function SequenceInstanceCard({ instance, onPause, onResume, onCancel, actionInProgress }: SequenceInstanceCardProps) {
  const progress = (instance.currentStep / instance.totalSteps) * 100
  const isActionInProgress = actionInProgress === instance.id

  return (
    <Card className={cn(
      "transition-colors",
      instance.status === "paused" && "border-amber-500/30 bg-amber-500/5"
    )}>
      <CardContent className="p-4">
        <div className="flex items-start gap-4">
          <div className="mt-1 rounded-lg bg-muted p-2">
            <ListTodo className="h-5 w-5 text-primary" />
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="font-semibold truncate">{instance.leadName}</span>
              <Badge
                variant={instance.status === "active" ? "default" : "secondary"}
                className="text-xs"
              >
                {instance.status}
              </Badge>
            </div>

            <p className="text-sm text-muted-foreground truncate">
              {instance.sequenceName}
            </p>

            {/* Progress bar */}
            <div className="mt-2 space-y-1">
              <div className="flex items-center justify-between text-xs">
                <span>Step {instance.currentStep}/{instance.totalSteps}</span>
                {instance.nextStepDue && instance.status === "active" && (
                  <span className="text-muted-foreground">
                    Next: {new Date(instance.nextStepDue).toLocaleDateString()}
                  </span>
                )}
              </div>
              <div className="w-full h-1.5 bg-muted rounded-full overflow-hidden">
                <div
                  className={cn(
                    "h-full transition-all duration-300",
                    instance.status === "active" ? "bg-primary" : "bg-amber-500"
                  )}
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>

	        {instance.pausedReason === "lead_replied" && (
	          <p className="text-xs text-amber-500 mt-2">Lead replied — paused until you reply</p>
	        )}

            {/* Actions */}
            <div className="flex items-center gap-2 mt-3">
              {instance.status === "active" ? (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onPause(instance.id)}
                  disabled={isActionInProgress}
                >
                  {isActionInProgress ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-1" />
                  ) : (
                    <Pause className="h-4 w-4 mr-1" />
                  )}
                  Pause
                </Button>
              ) : (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onResume(instance.id)}
                  disabled={isActionInProgress}
                >
                  {isActionInProgress ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-1" />
                  ) : (
                    <Play className="h-4 w-4 mr-1" />
                  )}
                  Resume
                </Button>
              )}
              <Button
                variant="ghost"
                size="sm"
                className="text-destructive hover:text-destructive"
                onClick={() => onCancel(instance.id)}
                disabled={isActionInProgress}
              >
                <XCircle className="h-4 w-4 mr-1" />
                Cancel
              </Button>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

// ============================================================================
// Task Card Component
// ============================================================================

function TaskCard({ task, onExecute, onSnooze, onSkip }: TaskCardProps) {
  // Safe icon/color lookup with fallback for unknown types
  const Icon = typeIcons[task.type] ?? defaultIcon
  const iconColor = typeColors[task.type] ?? defaultColor
  const overdue = isOverdue(task.dueDate)
  const isUrgent = task.isUrgent || task.type === "meeting-canceled" || task.type === "meeting-rescheduled"

  // Determine card styling: urgent tasks get red border/background
  const cardClass = cn(
    "transition-colors",
    isUrgent && "border-red-500/50 bg-red-50 dark:bg-red-950/20",
    overdue && !isUrgent && "border-destructive/50 bg-destructive/5"
  )

  return (
    <Card className={cardClass}>
      <CardContent className="p-4">
        <div className="flex items-start gap-4">
          <div className={`mt-1 rounded-lg bg-muted p-2 ${iconColor}`}>
            <Icon className="h-5 w-5" />
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="font-semibold truncate">{task.leadName}</span>
              {isUrgent && (
                <Badge variant="destructive" className="text-xs shrink-0">
                  {task.type === "meeting-canceled" ? "Canceled" : "Rescheduled"}
                </Badge>
              )}
              {task.leadScore && (
                <Badge variant="outline" className="text-xs shrink-0">
                  Score: {task.leadScore}
                </Badge>
              )}
            </div>

            <p className="text-sm text-muted-foreground truncate">
              {task.leadTitle ? `${task.leadTitle} at ` : ""}{task.leadCompany}
            </p>

            {(task.campaignName || task.sequenceStep) && (
              <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
                {task.campaignName && (
                  <span className="flex items-center gap-1">
                    <Calendar className="h-3 w-3" />
                    {task.campaignName}
                  </span>
                )}
                {task.sequenceStep && task.totalSteps && (
                  <span className="flex items-center gap-1">
                    Step {task.sequenceStep}/{task.totalSteps}
                  </span>
                )}
              </div>
            )}

            {task.suggestedMessage && (
              <p className="mt-3 text-sm bg-muted/50 rounded-md p-2 line-clamp-2">{task.suggestedMessage}</p>
            )}

            <div className="flex items-center justify-between mt-3">
              <span
                className={`flex items-center gap-1 text-xs ${overdue ? "text-destructive" : "text-muted-foreground"}`}
              >
                {overdue ? <AlertCircle className="h-3 w-3" /> : <Clock className="h-3 w-3" />}
                {formatDueDate(task.dueDate)}
              </span>

              <div className="flex items-center gap-2">
                <Button variant="ghost" size="sm" onClick={() => onSkip(task.id)}>
                  <SkipForward className="h-4 w-4 mr-1" />
                  Skip
                </Button>
                <Button variant="ghost" size="sm" onClick={() => onSnooze(task.id)}>
                  <Clock4 className="h-4 w-4 mr-1" />
                  Snooze
                </Button>
                <Button size="sm" onClick={() => onExecute(task.id)}>
                  <Play className="h-4 w-4 mr-1" />
                  Execute
                </Button>
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

// ============================================================================
// Main Follow-Ups View Component
// ============================================================================

interface FollowUpsViewProps {
  activeWorkspace?: string | null
  activeTab?: string
  onTabChange?: (tab: string) => void
}

export function FollowUpsView({ activeWorkspace, activeTab = "needs-followup", onTabChange }: FollowUpsViewProps) {
  const router = useRouter()
  const [tasks, setTasks] = useState<UnifiedTask[]>([])
  const [instances, setInstances] = useState<FollowUpInstanceData[]>([])
  const [followUpLeads, setFollowUpLeads] = useState<FollowUpTaggedLeadData[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [instanceActionInProgress, setInstanceActionInProgress] = useState<string | null>(null)
  const [leadActionInProgress, setLeadActionInProgress] = useState<string | null>(null)
  const [showSequenceManager, setShowSequenceManager] = useState(false)
  
  // Local state for tab management (fallback when onTabChange is not provided)
  const [localTab, setLocalTab] = useState(activeTab)
  
  // Use prop values if provided, otherwise use local state
  const currentTab = onTabChange ? activeTab : localTab
  const handleTabChange = onTabChange ?? setLocalTab

  const fetchData = useCallback(async () => {
    if (!activeWorkspace) {
      setTasks([])
      setInstances([])
      setFollowUpLeads([])
      setIsLoading(false)
      return
    }

    setIsLoading(true)
		try {
	      const [tasksResult, instancesResult, leadsResult] = await Promise.all([
	        getFollowUpTasks("all", activeWorkspace),
	        // Fetch paused + active so the "Paused" section persists after refresh.
	        // Filter out completed/cancelled client-side so this view stays focused.
	        getWorkspaceFollowUpInstances(activeWorkspace, "all"),
	        getFollowUpTaggedLeads(activeWorkspace),
	      ])
      
      if (tasksResult.success && tasksResult.data) {
        const dbTasks: UnifiedTask[] = tasksResult.data.map((t) => ({
          id: t.id,
          type: t.type,
          dueDate: new Date(t.dueDate),
          leadName: t.leadName,
          leadCompany: t.leadCompany,
          sequenceStep: t.sequenceStep,
          totalSteps: t.totalSteps,
          campaignName: t.campaignName,
          suggestedMessage: t.suggestedMessage,
          isUrgent: t.isUrgent,
        }))
        setTasks(dbTasks)
      } else {
        setTasks([])
      }

	      if (instancesResult.success && instancesResult.data) {
	        const activeOrPaused = instancesResult.data.filter(
	          (inst) => inst.status === "active" || inst.status === "paused"
	        )
	        setInstances(activeOrPaused)
	      } else {
	        setInstances([])
	      }

      if (leadsResult.success && leadsResult.data) {
        setFollowUpLeads(leadsResult.data)
      } else {
        setFollowUpLeads([])
      }
    } catch (error) {
      console.error("Failed to fetch follow-up data:", error)
      setTasks([])
      setInstances([])
      setFollowUpLeads([])
    }
    
    setIsLoading(false)
  }, [activeWorkspace])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  // ============================================================================
  // Follow-Up Lead Handlers
  // ============================================================================

  const handleSendFollowUp = (leadId: string) => {
    // Navigate to inbox with this lead's conversation selected
    router.push(`/?view=inbox&leadId=${leadId}`)
  }

  const handleMarkDone = async (leadId: string, outcome: FollowUpOutcome) => {
    setLeadActionInProgress(leadId)
    const result = await updateLeadFollowUpStatus(leadId, outcome)
    if (result.success) {
      const outcomeMessages: Record<FollowUpOutcome, string> = {
        "no-response": "Marked as no response - keeping in follow-up list",
        "replied": "Marked as replied",
        "meeting-booked": "Meeting booked!",
        "not-interested": "Marked as not interested",
        "snoozed": "Snoozed",
      }
      toast.success(outcomeMessages[outcome])
      fetchData()
    } else {
      toast.error(result.error || "Failed to update status")
    }
    setLeadActionInProgress(null)
  }

  const handleSnoozeLead = async (leadId: string) => {
    setLeadActionInProgress(leadId)
    const result = await updateLeadFollowUpStatus(leadId, "snoozed")
    if (result.success) {
      toast.success("Lead snoozed - change sentiment tag to bring it back")
      fetchData()
    } else {
      toast.error(result.error || "Failed to snooze lead")
    }
    setLeadActionInProgress(null)
  }

  const handleStartSequence = (leadId: string) => {
    // Navigate to inbox with CRM drawer open for this lead to start sequence
    router.push(`/?view=inbox&leadId=${leadId}&action=sequence`)
    toast.info("Opening lead to start sequence...")
  }

  // ============================================================================
  // Instance Handlers
  // ============================================================================

  const handlePauseInstance = async (instanceId: string) => {
    setInstanceActionInProgress(instanceId)
    const result = await pauseFollowUpInstance(instanceId, "manual")
    if (result.success) {
      toast.success("Sequence paused")
      fetchData()
    } else {
      toast.error(result.error || "Failed to pause sequence")
    }
    setInstanceActionInProgress(null)
  }

  const handleResumeInstance = async (instanceId: string) => {
    setInstanceActionInProgress(instanceId)
    const result = await resumeFollowUpInstance(instanceId)
    if (result.success) {
      toast.success("Sequence resumed")
      fetchData()
    } else {
      toast.error(result.error || "Failed to resume sequence")
    }
    setInstanceActionInProgress(null)
  }

  const handleCancelInstance = async (instanceId: string) => {
    setInstanceActionInProgress(instanceId)
    const result = await cancelFollowUpInstance(instanceId)
    if (result.success) {
      toast.success("Sequence cancelled")
      fetchData()
    } else {
      toast.error(result.error || "Failed to cancel sequence")
    }
    setInstanceActionInProgress(null)
  }

  // ============================================================================
  // Task Handlers
  // ============================================================================

  const handleExecute = async (id: string) => {
    setTasks(tasks.filter((t) => t.id !== id))
    const result = await completeFollowUpTask(id)
    if (result.success) {
      toast.success("Task completed")
    } else {
      toast.error(result.error || "Failed to complete task")
    }
  }

  const handleSnooze = async (id: string) => {
    const newDueDate = new Date()
    newDueDate.setDate(newDueDate.getDate() + 1)
    newDueDate.setHours(9, 0, 0, 0)
    
    setTasks(tasks.map((t) => (t.id === id ? { ...t, dueDate: newDueDate } : t)))
    
    const result = await snoozeFollowUpTask(id, 1)
    if (result.success) {
      toast.success("Task snoozed until tomorrow at 9 AM")
    } else {
      toast.error(result.error || "Failed to snooze task")
    }
  }

  const handleSkip = async (id: string) => {
    setTasks(tasks.filter((t) => t.id !== id))
    const result = await skipFollowUpTask(id)
    if (result.success) {
      toast.success("Task skipped")
    } else {
      toast.error(result.error || "Failed to skip task")
    }
  }

  // ============================================================================
  // Group Instances by Day
  // ============================================================================

  const groupInstancesByDay = (instances: FollowUpInstanceData[]) => {
    const groups: { [key: string]: FollowUpInstanceData[] } = {
      today: [],
      tomorrow: [],
      thisWeek: [],
      later: [],
      paused: [],
    }

    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const tomorrow = new Date(today)
    tomorrow.setDate(tomorrow.getDate() + 1)
    const nextWeek = new Date(today)
    nextWeek.setDate(nextWeek.getDate() + 7)

    for (const inst of instances) {
      if (inst.status === "paused") {
        groups.paused.push(inst)
        continue
      }

      if (!inst.nextStepDue) {
        groups.later.push(inst)
        continue
      }

      const dueDate = new Date(inst.nextStepDue)
      dueDate.setHours(0, 0, 0, 0)

      if (dueDate.getTime() === today.getTime()) {
        groups.today.push(inst)
      } else if (dueDate.getTime() === tomorrow.getTime()) {
        groups.tomorrow.push(inst)
      } else if (dueDate < nextWeek) {
        groups.thisWeek.push(inst)
      } else {
        groups.later.push(inst)
      }
    }

    return groups
  }

  const groupedInstances = groupInstancesByDay(instances)

  // Computed values
  const overdueTasks = tasks.filter((t) => isOverdue(t.dueDate))
  const todayTasks = tasks.filter((t) => isToday(t.dueDate))
  // Use total followUpLeads count (includes both "Follow Up" and "Snoozed") to match tab badge
  const needsFollowUpCount = followUpLeads.length

  if (isLoading) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="border-b px-8 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Follow-ups</h1>
            <p className="text-muted-foreground">Manage conversations and scheduled tasks</p>
          </div>
          <Button variant="outline" onClick={() => setShowSequenceManager(true)}>
            <Settings2 className="h-4 w-4 mr-2" />
            Manage Sequences
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-hidden p-8">
        {/* Stats Cards */}
        <div className="grid grid-cols-4 gap-4 mb-6">
          <Card>
            <CardContent className="p-4 flex items-center gap-3">
              <div className="rounded-full bg-primary/10 p-2">
                <MessageCircle className="h-5 w-5 text-primary" />
              </div>
              <div>
                <p className="text-2xl font-bold">{needsFollowUpCount}</p>
                <p className="text-sm text-muted-foreground">Needs Follow-Up</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 flex items-center gap-3">
              <div className="rounded-full bg-destructive/10 p-2">
                <AlertCircle className="h-5 w-5 text-destructive" />
              </div>
              <div>
                <p className="text-2xl font-bold">{overdueTasks.length}</p>
                <p className="text-sm text-muted-foreground">Overdue Tasks</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 flex items-center gap-3">
              <div className="rounded-full bg-amber-500/10 p-2">
                <Clock className="h-5 w-5 text-amber-500" />
              </div>
              <div>
                <p className="text-2xl font-bold">{todayTasks.length}</p>
                <p className="text-sm text-muted-foreground">Due Today</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 flex items-center gap-3">
              <div className="rounded-full bg-muted p-2">
                <ListTodo className="h-5 w-5 text-muted-foreground" />
              </div>
              <div>
                <p className="text-2xl font-bold">{instances.length}</p>
                <p className="text-sm text-muted-foreground">Active Sequences</p>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Tabs */}
        <Tabs value={currentTab} onValueChange={handleTabChange} className="h-[calc(100%-120px)]">
          <TabsList>
            <TabsTrigger value="needs-followup">
              Needs Follow-Up ({followUpLeads.length})
            </TabsTrigger>
            <TabsTrigger value="tasks">
              Tasks ({tasks.length})
            </TabsTrigger>
            <TabsTrigger value="sequences">
              Sequences ({instances.length})
            </TabsTrigger>
            <TabsTrigger value="reactivations">Reactivations</TabsTrigger>
          </TabsList>

          <ScrollArea className="h-[calc(100%-48px)] mt-4">
            {/* Needs Follow-Up Tab */}
            <TabsContent value="needs-followup" className="mt-0 space-y-3 pr-4">
              {followUpLeads.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">
                  <MessageCircle className="h-12 w-12 mx-auto mb-4 opacity-50" />
                  <p>No conversations need follow-up</p>
                  <p className="text-sm mt-2">
                    Leads tagged with &quot;Follow Up&quot; sentiment will appear here
                  </p>
                </div>
              ) : (
                followUpLeads.map((lead) => (
                  <FollowUpConversationCard
                    key={lead.id}
                    lead={lead}
                    onSendFollowUp={handleSendFollowUp}
                    onMarkDone={handleMarkDone}
                    onSnooze={handleSnoozeLead}
                    onStartSequence={handleStartSequence}
                    actionInProgress={leadActionInProgress}
                  />
                ))
              )}
            </TabsContent>

            {/* Tasks Tab */}
            <TabsContent value="tasks" className="mt-0 space-y-3 pr-4">
              {tasks.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">
                  <Calendar className="h-12 w-12 mx-auto mb-4 opacity-50" />
                  <p>No scheduled tasks</p>
                  <p className="text-sm mt-2">
                    {activeWorkspace 
                      ? "Tasks from sequences will appear here"
                      : "Select a workspace to view tasks"
                    }
                  </p>
                </div>
              ) : (
                tasks.map((task) => (
                  <TaskCard
                    key={task.id}
                    task={task}
                    onExecute={handleExecute}
                    onSnooze={handleSnooze}
                    onSkip={handleSkip}
                  />
                ))
              )}
            </TabsContent>

            {/* Sequences Tab */}
            <TabsContent value="sequences" className="mt-0 space-y-6 pr-4">
              {instances.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">
                  <ListTodo className="h-12 w-12 mx-auto mb-4 opacity-50" />
                  <p>No active sequences</p>
                  <p className="text-sm mt-2">Start a sequence from a lead&apos;s CRM drawer</p>
                </div>
              ) : (
                <>
                  {/* Today */}
                  {groupedInstances.today.length > 0 && (
                    <div className="space-y-3">
                      <h3 className="font-semibold text-sm flex items-center gap-2">
                        <Clock className="h-4 w-4 text-primary" />
                        Due Today ({groupedInstances.today.length})
                      </h3>
                      {groupedInstances.today.map((inst) => (
                        <SequenceInstanceCard
                          key={inst.id}
                          instance={inst}
                          onPause={handlePauseInstance}
                          onResume={handleResumeInstance}
                          onCancel={handleCancelInstance}
                          actionInProgress={instanceActionInProgress}
                        />
                      ))}
                    </div>
                  )}

                  {/* Tomorrow */}
                  {groupedInstances.tomorrow.length > 0 && (
                    <div className="space-y-3">
                      <h3 className="font-semibold text-sm flex items-center gap-2">
                        <Calendar className="h-4 w-4 text-muted-foreground" />
                        Tomorrow ({groupedInstances.tomorrow.length})
                      </h3>
                      {groupedInstances.tomorrow.map((inst) => (
                        <SequenceInstanceCard
                          key={inst.id}
                          instance={inst}
                          onPause={handlePauseInstance}
                          onResume={handleResumeInstance}
                          onCancel={handleCancelInstance}
                          actionInProgress={instanceActionInProgress}
                        />
                      ))}
                    </div>
                  )}

                  {/* This Week */}
                  {groupedInstances.thisWeek.length > 0 && (
                    <div className="space-y-3">
                      <h3 className="font-semibold text-sm flex items-center gap-2">
                        <Calendar className="h-4 w-4 text-muted-foreground" />
                        This Week ({groupedInstances.thisWeek.length})
                      </h3>
                      {groupedInstances.thisWeek.map((inst) => (
                        <SequenceInstanceCard
                          key={inst.id}
                          instance={inst}
                          onPause={handlePauseInstance}
                          onResume={handleResumeInstance}
                          onCancel={handleCancelInstance}
                          actionInProgress={instanceActionInProgress}
                        />
                      ))}
                    </div>
                  )}

                  {/* Later */}
                  {groupedInstances.later.length > 0 && (
                    <div className="space-y-3">
                      <h3 className="font-semibold text-sm flex items-center gap-2">
                        <Calendar className="h-4 w-4 text-muted-foreground" />
                        Later ({groupedInstances.later.length})
                      </h3>
                      {groupedInstances.later.map((inst) => (
                        <SequenceInstanceCard
                          key={inst.id}
                          instance={inst}
                          onPause={handlePauseInstance}
                          onResume={handleResumeInstance}
                          onCancel={handleCancelInstance}
                          actionInProgress={instanceActionInProgress}
                        />
                      ))}
                    </div>
                  )}

                  {/* Paused */}
                  {groupedInstances.paused.length > 0 && (
                    <div className="space-y-3">
                      <h3 className="font-semibold text-sm flex items-center gap-2 text-amber-500">
                        <Pause className="h-4 w-4" />
                        Paused ({groupedInstances.paused.length})
                      </h3>
                      {groupedInstances.paused.map((inst) => (
                        <SequenceInstanceCard
                          key={inst.id}
                          instance={inst}
                          onPause={handlePauseInstance}
                          onResume={handleResumeInstance}
                          onCancel={handleCancelInstance}
                          actionInProgress={instanceActionInProgress}
                        />
                      ))}
                    </div>
                  )}
                </>
              )}
            </TabsContent>

            {/* Reactivations Tab */}
            <TabsContent value="reactivations" className="mt-0 space-y-6 pr-4">
              <ReactivationsView activeWorkspace={activeWorkspace ?? null} />
            </TabsContent>
          </ScrollArea>
        </Tabs>
      </div>

      {/* Full-Screen Sheet for Sequence Manager */}
      <Sheet open={showSequenceManager} onOpenChange={setShowSequenceManager}>
        <SheetContent 
          side="right" 
          className="w-full sm:max-w-none sm:w-[90vw] lg:w-[80vw] overflow-y-auto"
        >
          <SheetHeader>
            <SheetTitle>Manage Follow-Up Sequences</SheetTitle>
            <SheetDescription>
              Create and edit sequence templates for automated follow-ups
            </SheetDescription>
          </SheetHeader>
          <div className="mt-6">
            <FollowUpSequenceManager clientId={activeWorkspace || null} />
          </div>
        </SheetContent>
      </Sheet>
    </div>
  )
}
