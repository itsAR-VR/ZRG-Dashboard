"use client"

import { useState, useEffect, useCallback } from "react"
import {
  Mail,
  Linkedin,
  MessageSquare,
  Phone,
  Check,
  Clock,
  Globe,
  Bell,
  Shield,
  Users,
  Bot,
  Sparkles,
  Loader2,
  Save,
  Lock,
  Plus,
  Trash2,
  FileText,
  Link2,
  HelpCircle,
  Briefcase,
} from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Switch } from "@/components/ui/switch"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Separator } from "@/components/ui/separator"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { IntegrationsManager } from "./settings/integrations-manager"
import { FollowUpSequenceManager } from "./settings/followup-sequence-manager"
import { 
  getUserSettings, 
  updateUserSettings, 
  addKnowledgeAsset,
  deleteKnowledgeAsset,
  type UserSettingsData,
  type KnowledgeAssetData,
  type QualificationQuestion,
} from "@/actions/settings-actions"
import { toast } from "sonner"
import { useUser } from "@/contexts/user-context"

interface Integration {
  id: string
  name: string
  icon: typeof Mail
  connected: boolean
  account?: string
}

const integrations: Integration[] = [
  { id: "gmail", name: "Gmail", icon: Mail, connected: false },
  { id: "outlook", name: "Outlook", icon: Mail, connected: false },
  { id: "linkedin", name: "LinkedIn", icon: Linkedin, connected: false },
  { id: "twilio", name: "Twilio SMS", icon: MessageSquare, connected: false },
  { id: "dialpad", name: "Dialpad", icon: Phone, connected: false },
]

interface SettingsViewProps {
  activeWorkspace?: string | null
}

export function SettingsView({ activeWorkspace }: SettingsViewProps) {
  const { user, isLoading: isUserLoading } = useUser()
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [hasChanges, setHasChanges] = useState(false)

  // Settings state from database
  const [settings, setSettings] = useState<UserSettingsData | null>(null)

  // Local state for form inputs
  const [aiPersona, setAiPersona] = useState({
    name: "",
    tone: "friendly-professional",
    greeting: "Hi {firstName},",
    signature: "",
    goals: "",
    serviceDescription: "",
  })

  // Qualification questions state
  const [qualificationQuestions, setQualificationQuestions] = useState<QualificationQuestion[]>([])
  const [newQuestion, setNewQuestion] = useState("")

  // Knowledge assets state
  const [knowledgeAssets, setKnowledgeAssets] = useState<KnowledgeAssetData[]>([])
  const [newAssetName, setNewAssetName] = useState("")
  const [newAssetContent, setNewAssetContent] = useState("")
  const [newAssetType, setNewAssetType] = useState<"text" | "url">("text")

  const [availability, setAvailability] = useState({
    timezone: "America/Los_Angeles",
    startTime: "09:00",
    endTime: "17:00",
  })

  const [notifications, setNotifications] = useState({
    emailDigest: true,
    slackAlerts: true,
  })

  const [automationRules, setAutomationRules] = useState({
    autoApproveMeetings: true,
    flagUncertainReplies: true,
    pauseForOOO: true,
    autoBlacklist: true,
  })

  // Load settings when workspace changes
  useEffect(() => {
    async function loadSettings() {
      setIsLoading(true)
      const result = await getUserSettings(activeWorkspace)
      
      if (result.success && result.data) {
        setSettings(result.data)
        // Populate form state from database
        setAiPersona({
          name: result.data.aiPersonaName || "",
          tone: result.data.aiTone || "friendly-professional",
          greeting: result.data.aiGreeting || "Hi {firstName},",
          signature: result.data.aiSignature || "",
          goals: result.data.aiGoals || "",
          serviceDescription: result.data.serviceDescription || "",
        })
        setAvailability({
          timezone: result.data.timezone || "America/Los_Angeles",
          startTime: result.data.workStartTime || "09:00",
          endTime: result.data.workEndTime || "17:00",
        })
        setNotifications({
          emailDigest: result.data.emailDigest,
          slackAlerts: result.data.slackAlerts,
        })
        setAutomationRules({
          autoApproveMeetings: result.data.autoApproveMeetings,
          flagUncertainReplies: result.data.flagUncertainReplies,
          pauseForOOO: result.data.pauseForOOO,
          autoBlacklist: result.data.autoBlacklist,
        })
        // Parse qualification questions from JSON
        if (result.data.qualificationQuestions) {
          try {
            setQualificationQuestions(JSON.parse(result.data.qualificationQuestions))
          } catch {
            setQualificationQuestions([])
          }
        } else {
          setQualificationQuestions([])
        }
        // Set knowledge assets
        if (result.knowledgeAssets) {
          setKnowledgeAssets(result.knowledgeAssets)
        }
      }
      
      setIsLoading(false)
    }

    loadSettings()
  }, [activeWorkspace])

  // Track changes
  const handleChange = () => {
    setHasChanges(true)
  }

  // Save all settings
  const handleSaveSettings = async () => {
    setIsSaving(true)
    
    const result = await updateUserSettings(activeWorkspace, {
      aiPersonaName: aiPersona.name || undefined,
      aiTone: aiPersona.tone,
      aiGreeting: aiPersona.greeting,
      aiSignature: aiPersona.signature || undefined,
      aiGoals: aiPersona.goals || undefined,
      serviceDescription: aiPersona.serviceDescription || undefined,
      qualificationQuestions: qualificationQuestions.length > 0 
        ? JSON.stringify(qualificationQuestions) 
        : undefined,
      autoApproveMeetings: automationRules.autoApproveMeetings,
      flagUncertainReplies: automationRules.flagUncertainReplies,
      pauseForOOO: automationRules.pauseForOOO,
      autoBlacklist: automationRules.autoBlacklist,
      emailDigest: notifications.emailDigest,
      slackAlerts: notifications.slackAlerts,
      timezone: availability.timezone,
      workStartTime: availability.startTime,
      workEndTime: availability.endTime,
    })

    if (result.success) {
      toast.success("Settings saved", {
        description: "Your settings have been saved successfully.",
      })
      setHasChanges(false)
    } else {
      toast.error("Error", {
        description: result.error || "Failed to save settings.",
      })
    }

    setIsSaving(false)
  }

  // Qualification question handlers
  const handleAddQuestion = useCallback(() => {
    if (!newQuestion.trim()) return
    const question: QualificationQuestion = {
      id: crypto.randomUUID(),
      question: newQuestion.trim(),
      required: false,
    }
    setQualificationQuestions(prev => [...prev, question])
    setNewQuestion("")
    handleChange()
  }, [newQuestion])

  const handleRemoveQuestion = useCallback((id: string) => {
    setQualificationQuestions(prev => prev.filter(q => q.id !== id))
    handleChange()
  }, [])

  const handleToggleQuestionRequired = useCallback((id: string) => {
    setQualificationQuestions(prev => 
      prev.map(q => q.id === id ? { ...q, required: !q.required } : q)
    )
    handleChange()
  }, [])

  // Knowledge asset handlers
  const handleAddAsset = useCallback(async () => {
    if (!newAssetName.trim() || !newAssetContent.trim()) {
      toast.error("Please provide both name and content for the asset")
      return
    }

    const result = await addKnowledgeAsset(activeWorkspace, {
      name: newAssetName.trim(),
      type: newAssetType,
      textContent: newAssetContent.trim(),
    })

    if (result.success && result.assetId) {
      setKnowledgeAssets(prev => [{
        id: result.assetId!,
        name: newAssetName.trim(),
        type: newAssetType,
        fileUrl: null,
        textContent: newAssetContent.trim(),
        originalFileName: null,
        mimeType: null,
        createdAt: new Date(),
      }, ...prev])
      setNewAssetName("")
      setNewAssetContent("")
      toast.success("Knowledge asset added")
    } else {
      toast.error(result.error || "Failed to add asset")
    }
  }, [activeWorkspace, newAssetName, newAssetContent, newAssetType])

  const handleDeleteAsset = useCallback(async (assetId: string) => {
    const result = await deleteKnowledgeAsset(assetId)
    if (result.success) {
      setKnowledgeAssets(prev => prev.filter(a => a.id !== assetId))
      toast.success("Asset deleted")
    } else {
      toast.error(result.error || "Failed to delete asset")
    }
  }, [])

  // Get user display info
  const userDisplayName = user?.fullName || user?.email?.split("@")[0] || "User"
  const userEmail = user?.email || ""
  const userAvatar = user?.avatarUrl || ""
  const userProvider = "email"
  const userInitials = userDisplayName
    .split(" ")
    .map((n: string) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2)

  if (isLoading || isUserLoading) {
    return (
      <div className="flex flex-col h-full items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full overflow-auto">
      <div className="border-b px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Settings</h1>
            <p className="text-muted-foreground">Manage your account and preferences</p>
          </div>
          {hasChanges && (
            <Button onClick={handleSaveSettings} disabled={isSaving}>
              {isSaving ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  <Save className="h-4 w-4 mr-2" />
                  Save Changes
                </>
              )}
            </Button>
          )}
        </div>
      </div>

      <div className="p-6">
        <Tabs defaultValue="general" className="space-y-6">
          <TabsList className="grid w-full max-w-3xl grid-cols-5">
            <TabsTrigger value="general">General</TabsTrigger>
            <TabsTrigger value="integrations">Integrations</TabsTrigger>
            <TabsTrigger value="ai">AI Personality</TabsTrigger>
            <TabsTrigger value="followups">Follow-Ups</TabsTrigger>
            <TabsTrigger value="team">Team</TabsTrigger>
          </TabsList>

          {/* General Settings */}
          <TabsContent value="general" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Users className="h-5 w-5" />
                  Profile
                </CardTitle>
                <CardDescription>Your personal account settings (managed via your login provider)</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center gap-4">
                  <Avatar className="h-20 w-20">
                    {userAvatar ? (
                      <AvatarImage src={userAvatar} alt={userDisplayName} />
                    ) : null}
                    <AvatarFallback className="text-lg">{userInitials}</AvatarFallback>
                  </Avatar>
                  <div>
                    <p className="font-semibold text-lg">{userDisplayName}</p>
                    <p className="text-sm text-muted-foreground">{userEmail}</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Profile managed by {userProvider} login
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Clock className="h-5 w-5" />
                  Availability
                </CardTitle>
                <CardDescription>Set your working hours for scheduling</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label>Timezone</Label>
                  <Select
                    value={availability.timezone}
                    onValueChange={(v) => {
                      setAvailability({ ...availability, timezone: v })
                      handleChange()
                    }}
                  >
                    <SelectTrigger>
                      <Globe className="h-4 w-4 mr-2" />
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="America/Los_Angeles">Pacific Time (PT)</SelectItem>
                      <SelectItem value="America/Denver">Mountain Time (MT)</SelectItem>
                      <SelectItem value="America/Chicago">Central Time (CT)</SelectItem>
                      <SelectItem value="America/New_York">Eastern Time (ET)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Start Time</Label>
                    <Input
                      type="time"
                      value={availability.startTime}
                      onChange={(e) => {
                        setAvailability({ ...availability, startTime: e.target.value })
                        handleChange()
                      }}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>End Time</Label>
                    <Input
                      type="time"
                      value={availability.endTime}
                      onChange={(e) => {
                        setAvailability({ ...availability, endTime: e.target.value })
                        handleChange()
                      }}
                    />
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Bell className="h-5 w-5" />
                  Notifications
                </CardTitle>
                <CardDescription>Configure how you receive alerts</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium">Email Digest</p>
                    <p className="text-sm text-muted-foreground">Daily summary of activity</p>
                  </div>
                  <Switch
                    checked={notifications.emailDigest}
                    onCheckedChange={(v) => {
                      setNotifications({ ...notifications, emailDigest: v })
                      handleChange()
                    }}
                  />
                </div>
                <Separator />
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium">Slack Alerts</p>
                    <p className="text-sm text-muted-foreground">Real-time notifications in Slack</p>
                  </div>
                  <Switch
                    checked={notifications.slackAlerts}
                    onCheckedChange={(v) => {
                      setNotifications({ ...notifications, slackAlerts: v })
                      handleChange()
                    }}
                  />
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Integrations */}
          <TabsContent value="integrations" className="space-y-6">
            {/* GHL Workspaces - Dynamic Multi-Tenancy */}
            <IntegrationsManager />

            {/* Other Channel Integrations */}
            <Card>
              <CardHeader>
                <CardTitle>Other Channels</CardTitle>
                <CardDescription>Additional channel integrations (coming soon)</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {integrations.map((integration) => (
                  <div key={integration.id} className="flex items-center justify-between p-4 rounded-lg border">
                    <div className="flex items-center gap-4">
                      <div className={`p-2 rounded-lg ${integration.connected ? "bg-primary/10" : "bg-muted"}`}>
                        <integration.icon
                          className={`h-5 w-5 ${integration.connected ? "text-primary" : "text-muted-foreground"}`}
                        />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <p className="font-medium">{integration.name}</p>
                          {integration.connected ? (
                            <Badge variant="outline" className="text-green-500 border-green-500/30 bg-green-500/10">
                              <Check className="h-3 w-3 mr-1" />
                              Connected
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="text-muted-foreground">
                              Coming Soon
                            </Badge>
                          )}
                        </div>
                        {integration.account && <p className="text-sm text-muted-foreground">{integration.account}</p>}
                      </div>
                    </div>
                    <Button variant="outline" size="sm" disabled={!integration.connected}>
                      {integration.connected ? "Disconnect" : "Connect"}
                    </Button>
                  </div>
                ))}
              </CardContent>
            </Card>
          </TabsContent>

          {/* AI Personality */}
          <TabsContent value="ai" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Bot className="h-5 w-5" />
                  AI Persona Configuration
                </CardTitle>
                <CardDescription>Customize how the AI represents you in outreach</CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="aiName">AI Display Name</Label>
                    <Input
                      id="aiName"
                      value={aiPersona.name}
                      onChange={(e) => {
                        setAiPersona({ ...aiPersona, name: e.target.value })
                        handleChange()
                      }}
                      placeholder="Your name for outreach"
                    />
                    <p className="text-xs text-muted-foreground">The name used in outreach messages</p>
                  </div>
                  <div className="space-y-2">
                    <Label>Communication Tone</Label>
                    <Select 
                      value={aiPersona.tone} 
                      onValueChange={(v) => {
                        setAiPersona({ ...aiPersona, tone: v })
                        handleChange()
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="friendly-professional">Friendly Professional</SelectItem>
                        <SelectItem value="professional">Professional</SelectItem>
                        <SelectItem value="friendly">Friendly</SelectItem>
                        <SelectItem value="casual">Casual</SelectItem>
                        <SelectItem value="formal">Formal</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="greeting">Default Greeting Template</Label>
                  <Input
                    id="greeting"
                    value={aiPersona.greeting}
                    onChange={(e) => {
                      setAiPersona({ ...aiPersona, greeting: e.target.value })
                      handleChange()
                    }}
                  />
                  <p className="text-xs text-muted-foreground">
                    Use {"{firstName}"}, {"{lastName}"}, {"{company}"} as variables
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="signature">Email Signature</Label>
                  <Textarea
                    id="signature"
                    value={aiPersona.signature}
                    onChange={(e) => {
                      setAiPersona({ ...aiPersona, signature: e.target.value })
                      handleChange()
                    }}
                    rows={4}
                    placeholder="Best regards,&#10;Your Name&#10;Company Name"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="aiGoals">AI Goals & Strategy</Label>
                  <Textarea
                    id="aiGoals"
                    value={aiPersona.goals}
                    onChange={(e) => {
                      setAiPersona({ ...aiPersona, goals: e.target.value })
                      handleChange()
                    }}
                    rows={4}
                    placeholder="Example: Prioritize booking intro calls within 7 days; keep tone consultative; surface upsell opportunities."
                  />
                  <p className="text-xs text-muted-foreground">
                    Describe the goals/strategy the AI should prioritize. Combined with sentiment to choose responses.
                  </p>
                </div>

                <Separator />

                {/* Service Description */}
                <div className="space-y-4">
                  <div className="flex items-center gap-2">
                    <Briefcase className="h-5 w-5 text-primary" />
                    <h4 className="font-semibold">Service Description</h4>
                  </div>
                  <Textarea
                    id="serviceDescription"
                    value={aiPersona.serviceDescription}
                    onChange={(e) => {
                      setAiPersona({ ...aiPersona, serviceDescription: e.target.value })
                      handleChange()
                    }}
                    rows={6}
                    placeholder="Describe your business, services, and value proposition. This helps the AI understand what you offer and communicate it effectively to leads.&#10;&#10;Example: We are a B2B SaaS company providing AI-powered sales automation tools. Our main product helps sales teams automate follow-ups, qualify leads, and book more meetings."
                  />
                  <p className="text-xs text-muted-foreground">
                    Provide detailed context about your business so the AI can tailor responses appropriately.
                  </p>
                </div>

                <Separator />

                {/* Qualification Questions */}
                <div className="space-y-4">
                  <div className="flex items-center gap-2">
                    <HelpCircle className="h-5 w-5 text-primary" />
                    <h4 className="font-semibold">Qualification Questions</h4>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Questions the AI should ask to qualify leads. These will be woven into conversations naturally.
                  </p>
                  
                  {/* Existing questions */}
                  <div className="space-y-2">
                    {qualificationQuestions.map((q) => (
                      <div key={q.id} className="flex items-center gap-2 p-3 rounded-lg border">
                        <span className="flex-1 text-sm">{q.question}</span>
                        <div className="flex items-center gap-2">
                          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                            <Switch
                              checked={q.required}
                              onCheckedChange={() => handleToggleQuestionRequired(q.id)}
                              className="h-4 w-7"
                            />
                            Required
                          </label>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-muted-foreground hover:text-destructive"
                            onClick={() => handleRemoveQuestion(q.id)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                  
                  {/* Add new question */}
                  <div className="flex gap-2">
                    <Input
                      placeholder="Add a qualification question..."
                      value={newQuestion}
                      onChange={(e) => setNewQuestion(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault()
                          handleAddQuestion()
                        }
                      }}
                    />
                    <Button 
                      variant="outline" 
                      size="icon"
                      onClick={handleAddQuestion}
                      disabled={!newQuestion.trim()}
                    >
                      <Plus className="h-4 w-4" />
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Examples: "What is your current monthly budget for this solution?", "Who else is involved in this decision?"
                  </p>
                </div>

                <Separator />

                {/* Knowledge Assets */}
                <div className="space-y-4">
                  <div className="flex items-center gap-2">
                    <FileText className="h-5 w-5 text-primary" />
                    <h4 className="font-semibold">Knowledge Assets</h4>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Add documents, text snippets, or URLs that the AI can reference when generating responses.
                  </p>
                  
                  {/* Existing assets */}
                  {knowledgeAssets.length > 0 && (
                    <div className="space-y-2">
                      {knowledgeAssets.map((asset) => (
                        <div key={asset.id} className="flex items-center gap-3 p-3 rounded-lg border">
                          {asset.type === "url" ? (
                            <Link2 className="h-4 w-4 text-muted-foreground" />
                          ) : (
                            <FileText className="h-4 w-4 text-muted-foreground" />
                          )}
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium truncate">{asset.name}</p>
                            <p className="text-xs text-muted-foreground truncate">
                              {asset.type === "url" ? asset.textContent : `${asset.textContent?.slice(0, 100)}...`}
                            </p>
                          </div>
                          <Badge variant="outline" className="text-xs">
                            {asset.type}
                          </Badge>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-muted-foreground hover:text-destructive"
                            onClick={() => handleDeleteAsset(asset.id)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
                  
                  {/* Add new asset */}
                  <div className="space-y-3 p-4 rounded-lg border border-dashed">
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <Label className="text-xs">Asset Name</Label>
                        <Input
                          placeholder="e.g., Pricing Guide"
                          value={newAssetName}
                          onChange={(e) => setNewAssetName(e.target.value)}
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-xs">Type</Label>
                        <Select value={newAssetType} onValueChange={(v) => setNewAssetType(v as "text" | "url")}>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="text">Text Snippet</SelectItem>
                            <SelectItem value="url">URL / Link</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">
                        {newAssetType === "url" ? "URL" : "Content"}
                      </Label>
                      <Textarea
                        placeholder={newAssetType === "url" 
                          ? "https://example.com/pricing" 
                          : "Paste content here that the AI can reference..."
                        }
                        value={newAssetContent}
                        onChange={(e) => setNewAssetContent(e.target.value)}
                        rows={3}
                      />
                    </div>
                    <Button 
                      variant="outline" 
                      size="sm"
                      onClick={handleAddAsset}
                      disabled={!newAssetName.trim() || !newAssetContent.trim()}
                    >
                      <Plus className="h-4 w-4 mr-1.5" />
                      Add Asset
                    </Button>
                    <p className="text-xs text-muted-foreground">
                      File uploads coming soon. For now, paste text content directly.
                    </p>
                  </div>
                </div>

                <Separator />

                <div className="space-y-4">
                  <div className="flex items-center gap-2">
                    <Sparkles className="h-5 w-5 text-primary" />
                    <h4 className="font-semibold">AI Behavior Rules</h4>
                  </div>
                  <div className="grid gap-3">
                    <div className="flex items-center justify-between p-3 rounded-lg border">
                      <span className="text-sm">Auto-approve meeting confirmations</span>
                      <Switch 
                        checked={automationRules.autoApproveMeetings}
                        onCheckedChange={(v) => {
                          setAutomationRules({ ...automationRules, autoApproveMeetings: v })
                          handleChange()
                        }}
                      />
                    </div>
                    <div className="flex items-center justify-between p-3 rounded-lg border">
                      <span className="text-sm">Flag uncertain responses for review</span>
                      <Switch 
                        checked={automationRules.flagUncertainReplies}
                        onCheckedChange={(v) => {
                          setAutomationRules({ ...automationRules, flagUncertainReplies: v })
                          handleChange()
                        }}
                      />
                    </div>
                    <div className="flex items-center justify-between p-3 rounded-lg border">
                      <span className="text-sm">Pause sequences for Out-of-Office replies</span>
                      <Switch 
                        checked={automationRules.pauseForOOO}
                        onCheckedChange={(v) => {
                          setAutomationRules({ ...automationRules, pauseForOOO: v })
                          handleChange()
                        }}
                      />
                    </div>
                    <div className="flex items-center justify-between p-3 rounded-lg border">
                      <span className="text-sm">Auto-blacklist explicit opt-outs</span>
                      <Switch 
                        checked={automationRules.autoBlacklist}
                        onCheckedChange={(v) => {
                          setAutomationRules({ ...automationRules, autoBlacklist: v })
                          handleChange()
                        }}
                      />
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Follow-Up Sequences */}
          <TabsContent value="followups" className="space-y-6">
            <FollowUpSequenceManager clientId={activeWorkspace || null} />
          </TabsContent>

          {/* Team Management */}
          <TabsContent value="team" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Users className="h-5 w-5" />
                  Team Members
                </CardTitle>
                <CardDescription>Manage who has access to this workspace</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <div className="rounded-full bg-muted p-4 mb-4">
                    <Lock className="h-8 w-8 text-muted-foreground" />
                  </div>
                  <h3 className="text-lg font-semibold mb-2">Team Management Coming Soon</h3>
                  <p className="text-sm text-muted-foreground max-w-md">
                    Multi-user team management and role-based access control will be available in a future update.
                    Currently, each workspace is tied to your individual account.
                  </p>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Shield className="h-5 w-5" />
                  Security
                </CardTitle>
                <CardDescription>Security settings for your workspace</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium">Two-Factor Authentication</p>
                    <p className="text-sm text-muted-foreground">Require 2FA for all team members</p>
                  </div>
                  <Switch 
                    disabled 
                    onCheckedChange={() => toast.info("Coming soon", { description: "2FA will be available in a future update." })}
                  />
                </div>
                <Separator />
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium">SSO (Single Sign-On)</p>
                    <p className="text-sm text-muted-foreground">Enable SAML-based SSO</p>
                  </div>
                  <Button 
                    variant="outline" 
                    size="sm" 
                    disabled
                    onClick={() => toast.info("Coming soon", { description: "SSO will be available in a future update." })}
                  >
                    Configure
                  </Button>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  )
}
