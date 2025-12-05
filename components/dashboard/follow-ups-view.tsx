"use client"

import { useState, useEffect } from "react"
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
} from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { getFollowUpTasks, completeFollowUpTask, skipFollowUpTask } from "@/actions/followup-actions"

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
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    async function fetchTasks() {
      setIsLoading(true)
      const result = await getFollowUpTasks("all", activeWorkspace)
      
      if (result.success && result.data) {
        const dbTasks: UnifiedTask[] = result.data.map((t) => ({
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
      
      setIsLoading(false)
    }

    fetchTasks()
  }, [activeWorkspace])

  const overdueTasks = tasks.filter((t) => isOverdue(t.dueDate))
  const todayTasks = tasks.filter((t) => isToday(t.dueDate))
  const upcomingTasks = tasks.filter((t) => !isOverdue(t.dueDate) && !isToday(t.dueDate))

  const handleExecute = async (id: string) => {
    setTasks(tasks.filter((t) => t.id !== id))
    await completeFollowUpTask(id)
  }

  const handleSnooze = (id: string) => {
    setTasks(tasks.map((t) => (t.id === id ? { ...t, dueDate: new Date(Date.now() + 1000 * 60 * 60 * 24) } : t)))
  }

  const handleSkip = async (id: string) => {
    setTasks(tasks.filter((t) => t.id !== id))
    await skipFollowUpTask(id)
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
          </TabsList>

          <ScrollArea className="h-[calc(100%-48px)] mt-4">
            <TabsContent value="all" className="mt-0 space-y-3">
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

            <TabsContent value="overdue" className="mt-0 space-y-3">
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

            <TabsContent value="today" className="mt-0 space-y-3">
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

            <TabsContent value="upcoming" className="mt-0 space-y-3">
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
          </ScrollArea>
        </Tabs>
      </div>
    </div>
  )
}
