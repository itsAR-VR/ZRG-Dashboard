"use client"

import { useState, useEffect, useCallback } from "react"
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
} from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Separator } from "@/components/ui/separator"
import { getFollowUpTasks, completeFollowUpTask, skipFollowUpTask, snoozeFollowUpTask } from "@/actions/followup-actions"
import {
  getWorkspaceFollowUpInstances,
  pauseFollowUpInstance,
  resumeFollowUpInstance,
  cancelFollowUpInstance,
  type FollowUpInstanceData,
} from "@/actions/followup-sequence-actions"
import { toast } from "sonner"
import { cn } from "@/lib/utils"

const typeIcons = {
  email: Mail,
  call: Phone,
  linkedin: Linkedin,
  sms: MessageSquare,
}

const typeColors = {
  email: "text-blue-500",
  call: "text-green-500",
  linkedin: "text-sky-500",
  sms: "text-purple-500",
}

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

// Unified task type
interface UnifiedTask {
  id: string
  type: "email" | "call" | "linkedin" | "sms"
  dueDate: Date
  leadName: string
  leadCompany: string
  leadScore?: number
  leadTitle?: string
  sequenceStep?: number | null
  totalSteps?: number | null
  campaignName?: string | null
  suggestedMessage?: string | null
}

interface TaskCardProps {
  task: UnifiedTask
  onExecute: (id: string) => void
  onSnooze: (id: string) => void
  onSkip: (id: string) => void
}

// Sequence Instance Card Component
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
              <p className="text-xs text-amber-500 mt-2">Lead replied - awaiting review</p>
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

function TaskCard({ task, onExecute, onSnooze, onSkip }: TaskCardProps) {
  const Icon = typeIcons[task.type]
  const overdue = isOverdue(task.dueDate)

  return (
    <Card className={`transition-colors ${overdue ? "border-destructive/50 bg-destructive/5" : ""}`}>
      <CardContent className="p-4">
        <div className="flex items-start gap-4">
          <div className={`mt-1 rounded-lg bg-muted p-2 ${typeColors[task.type]}`}>
            <Icon className="h-5 w-5" />
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="font-semibold truncate">{task.leadName}</span>
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

interface FollowUpsViewProps {
  activeWorkspace?: string | null
}

export function FollowUpsView({ activeWorkspace }: FollowUpsViewProps) {
  const [tasks, setTasks] = useState<UnifiedTask[]>([])
  const [instances, setInstances] = useState<FollowUpInstanceData[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [instanceActionInProgress, setInstanceActionInProgress] = useState<string | null>(null)

  const fetchData = useCallback(async () => {
    if (!activeWorkspace) {
      setTasks([])
      setInstances([])
      setIsLoading(false)
      return
    }

    setIsLoading(true)
    try {
      const [tasksResult, instancesResult] = await Promise.all([
        getFollowUpTasks("all", activeWorkspace),
        getWorkspaceFollowUpInstances(activeWorkspace, "active"),
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
        }))
        setTasks(dbTasks)
      } else {
        setTasks([])
      }

      if (instancesResult.success && instancesResult.data) {
        setInstances(instancesResult.data)
      } else {
        setInstances([])
      }
    } catch (error) {
      console.error("Failed to fetch follow-up data:", error)
      setTasks([])
      setInstances([])
    }
    
    setIsLoading(false)
  }, [activeWorkspace])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  // Instance handlers
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

  // Group instances by next step due date
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

  const overdueTasks = tasks.filter((t) => isOverdue(t.dueDate))
  const todayTasks = tasks.filter((t) => isToday(t.dueDate))
  const upcomingTasks = tasks.filter((t) => !isOverdue(t.dueDate) && !isToday(t.dueDate))

  const handleExecute = async (id: string) => {
    // Optimistic update
    setTasks(tasks.filter((t) => t.id !== id))
    const result = await completeFollowUpTask(id)
    if (result.success) {
      toast.success("Task completed")
    } else {
      toast.error(result.error || "Failed to complete task")
    }
  }

  const handleSnooze = async (id: string) => {
    // Optimistic update - snooze for 1 day
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
    // Optimistic update
    setTasks(tasks.filter((t) => t.id !== id))
    const result = await skipFollowUpTask(id)
    if (result.success) {
      toast.success("Task skipped")
    } else {
      toast.error(result.error || "Failed to skip task")
    }
  }

  if (isLoading) {
    return (
      <div className="flex flex-col h-full items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  // Empty state when no tasks
  if (tasks.length === 0) {
    return (
      <div className="flex flex-col h-full">
        <div className="border-b px-6 py-4">
          <h1 className="text-2xl font-bold">Follow-ups</h1>
          <p className="text-muted-foreground">Manage your scheduled outreach tasks</p>
        </div>
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center space-y-4">
            <div className="p-4 rounded-full bg-muted/50 w-fit mx-auto">
              <Calendar className="h-12 w-12 text-muted-foreground" />
            </div>
            <div>
              <h3 className="text-lg font-semibold">No follow-up tasks</h3>
              <p className="text-sm text-muted-foreground max-w-sm">
                {activeWorkspace 
                  ? "This workspace doesn't have any follow-up tasks. Tasks will appear when leads need follow-ups."
                  : "Select a workspace to view its follow-up tasks."
                }
              </p>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      <div className="border-b px-6 py-4">
        <h1 className="text-2xl font-bold">Follow-ups</h1>
        <p className="text-muted-foreground">Manage your scheduled outreach tasks</p>
      </div>

      <div className="flex-1 overflow-hidden p-6">
        <div className="grid grid-cols-3 gap-4 mb-6">
          <Card>
            <CardContent className="p-4 flex items-center gap-3">
              <div className="rounded-full bg-destructive/10 p-2">
                <AlertCircle className="h-5 w-5 text-destructive" />
              </div>
              <div>
                <p className="text-2xl font-bold">{overdueTasks.length}</p>
                <p className="text-sm text-muted-foreground">Overdue</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 flex items-center gap-3">
              <div className="rounded-full bg-primary/10 p-2">
                <Clock className="h-5 w-5 text-primary" />
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
                <Calendar className="h-5 w-5 text-muted-foreground" />
              </div>
              <div>
                <p className="text-2xl font-bold">{upcomingTasks.length}</p>
                <p className="text-sm text-muted-foreground">Upcoming</p>
              </div>
            </CardContent>
          </Card>
        </div>

        <Tabs defaultValue="all" className="h-[calc(100%-120px)]">
          <TabsList>
            <TabsTrigger value="all">All ({tasks.length})</TabsTrigger>
            <TabsTrigger value="overdue" className="text-destructive">
              Overdue ({overdueTasks.length})
            </TabsTrigger>
            <TabsTrigger value="today">Today ({todayTasks.length})</TabsTrigger>
            <TabsTrigger value="upcoming">Upcoming ({upcomingTasks.length})</TabsTrigger>
            <TabsTrigger value="sequences">
              Sequences ({instances.length})
            </TabsTrigger>
          </TabsList>

          <ScrollArea className="h-[calc(100%-48px)] mt-4">
            <TabsContent value="all" className="mt-0 space-y-3 pr-4">
              {tasks.map((task) => (
                <TaskCard
                  key={task.id}
                  task={task}
                  onExecute={handleExecute}
                  onSnooze={handleSnooze}
                  onSkip={handleSkip}
                />
              ))}
            </TabsContent>

            <TabsContent value="overdue" className="mt-0 space-y-3 pr-4">
              {overdueTasks.map((task) => (
                <TaskCard
                  key={task.id}
                  task={task}
                  onExecute={handleExecute}
                  onSnooze={handleSnooze}
                  onSkip={handleSkip}
                />
              ))}
              {overdueTasks.length === 0 && (
                <div className="text-center py-12 text-muted-foreground">
                  <AlertCircle className="h-12 w-12 mx-auto mb-4 opacity-50" />
                  <p>No overdue tasks</p>
                </div>
              )}
            </TabsContent>

            <TabsContent value="today" className="mt-0 space-y-3 pr-4">
              {todayTasks.map((task) => (
                <TaskCard
                  key={task.id}
                  task={task}
                  onExecute={handleExecute}
                  onSnooze={handleSnooze}
                  onSkip={handleSkip}
                />
              ))}
              {todayTasks.length === 0 && (
                <div className="text-center py-12 text-muted-foreground">
                  <Clock className="h-12 w-12 mx-auto mb-4 opacity-50" />
                  <p>No tasks due today</p>
                </div>
              )}
            </TabsContent>

            <TabsContent value="upcoming" className="mt-0 space-y-3 pr-4">
              {upcomingTasks.map((task) => (
                <TaskCard
                  key={task.id}
                  task={task}
                  onExecute={handleExecute}
                  onSnooze={handleSnooze}
                  onSkip={handleSkip}
                />
              ))}
              {upcomingTasks.length === 0 && (
                <div className="text-center py-12 text-muted-foreground">
                  <Calendar className="h-12 w-12 mx-auto mb-4 opacity-50" />
                  <p>No upcoming tasks</p>
                </div>
              )}
            </TabsContent>

            {/* Active Sequences Tab */}
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
          </ScrollArea>
        </Tabs>
      </div>
    </div>
  )
}
