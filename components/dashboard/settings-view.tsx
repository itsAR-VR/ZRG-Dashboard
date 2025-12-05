"use client"

import { useState } from "react"
import {
  Mail,
  Linkedin,
  MessageSquare,
  Phone,
  Check,
  Plus,
  Trash2,
  User,
  Clock,
  Globe,
  Bell,
  Shield,
  Users,
  Bot,
  Sparkles,
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { IntegrationsManager } from "./settings/integrations-manager"

interface Integration {
  id: string
  name: string
  icon: typeof Mail
  connected: boolean
  account?: string
}

const integrations: Integration[] = [
  { id: "gmail", name: "Gmail", icon: Mail, connected: true, account: "alex@zeroriskgrowth.com" },
  { id: "outlook", name: "Outlook", icon: Mail, connected: false },
  { id: "linkedin", name: "LinkedIn", icon: Linkedin, connected: true, account: "Alex Thompson" },
  { id: "twilio", name: "Twilio SMS", icon: MessageSquare, connected: true, account: "+1 (555) 000-1234" },
  { id: "dialpad", name: "Dialpad", icon: Phone, connected: false },
]

const teamMembers = [
  {
    id: "1",
    name: "Alex Thompson",
    email: "alex@zeroriskgrowth.com",
    role: "Admin",
    avatar: "/diverse-group-meeting.png",
  },
  {
    id: "2",
    name: "Jordan Lee",
    email: "jordan@zeroriskgrowth.com",
    role: "Manager",
    avatar: "/jordan-landscape.png",
  },
  {
    id: "3",
    name: "Sam Rivera",
    email: "sam@zeroriskgrowth.com",
    role: "Member",
    avatar: "/sam-portrait.png",
  },
]

export function SettingsView() {
  const [aiPersona, setAiPersona] = useState({
    name: "Alex",
    tone: "professional",
    greeting: "Hi {firstName},",
    signature: "Best regards,\nAlex Thompson\nZero Risk Growth",
  })

  const [availability, setAvailability] = useState({
    timezone: "America/Los_Angeles",
    startTime: "09:00",
    endTime: "17:00",
    workDays: ["monday", "tuesday", "wednesday", "thursday", "friday"],
  })

  const [notifications, setNotifications] = useState({
    emailDigest: true,
    slackAlerts: true,
    urgentOnly: false,
    meetingRequests: true,
  })

  return (
    <div className="flex flex-col h-full overflow-auto">
      <div className="border-b px-6 py-4">
        <h1 className="text-2xl font-bold">Settings</h1>
        <p className="text-muted-foreground">Manage your account and preferences</p>
      </div>

      <div className="p-6">
        <Tabs defaultValue="general" className="space-y-6">
          <TabsList className="grid w-full max-w-2xl grid-cols-4">
            <TabsTrigger value="general">General</TabsTrigger>
            <TabsTrigger value="integrations">Integrations</TabsTrigger>
            <TabsTrigger value="ai">AI Personality</TabsTrigger>
            <TabsTrigger value="team">Team</TabsTrigger>
          </TabsList>

          {/* General Settings */}
          <TabsContent value="general" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <User className="h-5 w-5" />
                  Profile
                </CardTitle>
                <CardDescription>Your personal account settings</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center gap-4">
                  <Avatar className="h-20 w-20">
                    <AvatarImage src="/abstract-profile.png" />
                    <AvatarFallback>AT</AvatarFallback>
                  </Avatar>
                  <div>
                    <Button variant="outline" size="sm">
                      Change Photo
                    </Button>
                    <p className="text-xs text-muted-foreground mt-1">JPG, PNG. Max 2MB.</p>
                  </div>
                </div>
                <Separator />
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="firstName">First Name</Label>
                    <Input id="firstName" defaultValue="Alex" />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="lastName">Last Name</Label>
                    <Input id="lastName" defaultValue="Thompson" />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="email">Email</Label>
                  <Input id="email" type="email" defaultValue="alex@zeroriskgrowth.com" />
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
                    onValueChange={(v) => setAvailability({ ...availability, timezone: v })}
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
                      onChange={(e) => setAvailability({ ...availability, startTime: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>End Time</Label>
                    <Input
                      type="time"
                      value={availability.endTime}
                      onChange={(e) => setAvailability({ ...availability, endTime: e.target.value })}
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
                    onCheckedChange={(v) => setNotifications({ ...notifications, emailDigest: v })}
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
                    onCheckedChange={(v) => setNotifications({ ...notifications, slackAlerts: v })}
                  />
                </div>
                <Separator />
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium">Meeting Requests Only</p>
                    <p className="text-sm text-muted-foreground">Only notify for high-priority leads</p>
                  </div>
                  <Switch
                    checked={notifications.meetingRequests}
                    onCheckedChange={(v) => setNotifications({ ...notifications, meetingRequests: v })}
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
                              Not Connected
                            </Badge>
                          )}
                        </div>
                        {integration.account && <p className="text-sm text-muted-foreground">{integration.account}</p>}
                      </div>
                    </div>
                    <Button variant={integration.connected ? "outline" : "default"} size="sm">
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
                      onChange={(e) => setAiPersona({ ...aiPersona, name: e.target.value })}
                    />
                    <p className="text-xs text-muted-foreground">The name used in outreach messages</p>
                  </div>
                  <div className="space-y-2">
                    <Label>Communication Tone</Label>
                    <Select value={aiPersona.tone} onValueChange={(v) => setAiPersona({ ...aiPersona, tone: v })}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
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
                    onChange={(e) => setAiPersona({ ...aiPersona, greeting: e.target.value })}
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
                    onChange={(e) => setAiPersona({ ...aiPersona, signature: e.target.value })}
                    rows={4}
                  />
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
                      <Switch defaultChecked />
                    </div>
                    <div className="flex items-center justify-between p-3 rounded-lg border">
                      <span className="text-sm">Flag uncertain responses for review</span>
                      <Switch defaultChecked />
                    </div>
                    <div className="flex items-center justify-between p-3 rounded-lg border">
                      <span className="text-sm">Pause sequences for Out-of-Office replies</span>
                      <Switch defaultChecked />
                    </div>
                    <div className="flex items-center justify-between p-3 rounded-lg border">
                      <span className="text-sm">Auto-blacklist explicit opt-outs</span>
                      <Switch defaultChecked />
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Team Management */}
          <TabsContent value="team" className="space-y-6">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="flex items-center gap-2">
                      <Users className="h-5 w-5" />
                      Team Members
                    </CardTitle>
                    <CardDescription>Manage who has access to this workspace</CardDescription>
                  </div>
                  <Button>
                    <Plus className="h-4 w-4 mr-2" />
                    Invite Member
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Member</TableHead>
                      <TableHead>Role</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {teamMembers.map((member) => (
                      <TableRow key={member.id}>
                        <TableCell>
                          <div className="flex items-center gap-3">
                            <Avatar>
                              <AvatarImage src={member.avatar || "/placeholder.svg"} />
                              <AvatarFallback>
                                {member.name
                                  .split(" ")
                                  .map((n) => n[0])
                                  .join("")}
                              </AvatarFallback>
                            </Avatar>
                            <div>
                              <p className="font-medium">{member.name}</p>
                              <p className="text-sm text-muted-foreground">{member.email}</p>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Select defaultValue={member.role.toLowerCase()}>
                            <SelectTrigger className="w-[120px]">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="admin">Admin</SelectItem>
                              <SelectItem value="manager">Manager</SelectItem>
                              <SelectItem value="member">Member</SelectItem>
                            </SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell className="text-right">
                          <Button variant="ghost" size="icon" className="text-destructive hover:text-destructive">
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
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
                  <Switch />
                </div>
                <Separator />
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium">SSO (Single Sign-On)</p>
                    <p className="text-sm text-muted-foreground">Enable SAML-based SSO</p>
                  </div>
                  <Button variant="outline" size="sm">
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
