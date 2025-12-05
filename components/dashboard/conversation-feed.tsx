"use client"

import { useState } from "react"
import type { Conversation } from "@/lib/mock-data"
import { ConversationCard } from "./conversation-card"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Separator } from "@/components/ui/separator"
import { Search, SlidersHorizontal, AlertCircle, FileEdit, Clock } from "lucide-react"

export interface FilterState {
  requiresAttention: boolean
  hasAiDraft: boolean
  awaitingReply: boolean
}

interface FilterCounts {
  attention: number
  drafts: number
  awaiting: number
}

interface ConversationFeedProps {
  conversations: Conversation[]
  activeConversationId: string | null
  onSelectConversation: (id: string) => void
  filters: FilterState
  onFiltersChange: (filters: FilterState) => void
  filterCounts: FilterCounts
}

export function ConversationFeed({ 
  conversations, 
  activeConversationId, 
  onSelectConversation,
  filters,
  onFiltersChange,
  filterCounts,
}: ConversationFeedProps) {
  const [searchQuery, setSearchQuery] = useState("")

  const filteredConversations = conversations.filter(
    (conv) =>
      conv.lead.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      conv.lead.company.toLowerCase().includes(searchQuery.toLowerCase()) ||
      conv.lastMessage.toLowerCase().includes(searchQuery.toLowerCase()),
  )

  const activeFilterCount = [filters.requiresAttention, filters.hasAiDraft, filters.awaitingReply].filter(Boolean).length

  return (
    <div className="flex h-full w-80 flex-col border-r border-border bg-background">
      {/* Search & Filters */}
      <div className="space-y-3 border-b border-border p-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search conversations..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>
        <div className="flex gap-2">
          <Select defaultValue="all">
            <SelectTrigger className="flex-1 text-xs">
              <SelectValue placeholder="Date" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Time</SelectItem>
              <SelectItem value="today">Today</SelectItem>
              <SelectItem value="week">This Week</SelectItem>
              <SelectItem value="month">This Month</SelectItem>
            </SelectContent>
          </Select>
          <Select defaultValue="all">
            <SelectTrigger className="flex-1 text-xs">
              <SelectValue placeholder="Campaign" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Campaigns</SelectItem>
              <SelectItem value="outreach-q4">Outreach Q4</SelectItem>
              <SelectItem value="nurture">Nurture</SelectItem>
            </SelectContent>
          </Select>
          
          {/* Filter Popover */}
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="icon" className="shrink-0 bg-transparent relative">
                <SlidersHorizontal className="h-4 w-4" />
                {activeFilterCount > 0 && (
                  <Badge 
                    variant="destructive" 
                    className="absolute -top-1 -right-1 h-4 w-4 p-0 flex items-center justify-center text-[10px]"
                  >
                    {activeFilterCount}
                  </Badge>
                )}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-64" align="end">
              <div className="space-y-4">
                <div className="font-medium text-sm">Filters</div>
                <Separator />
                
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                      <Checkbox 
                        id="attention" 
                        checked={filters.requiresAttention}
                        onCheckedChange={(checked) => 
                          onFiltersChange({ ...filters, requiresAttention: checked as boolean })
                        }
                      />
                      <Label htmlFor="attention" className="flex items-center gap-2 text-sm cursor-pointer">
                        <AlertCircle className="h-3.5 w-3.5 text-destructive" />
                        Requires Attention
                      </Label>
                    </div>
                    {filterCounts.attention > 0 && (
                      <Badge variant="destructive" className="text-[10px] h-5">
                        {filterCounts.attention}
                      </Badge>
                    )}
                  </div>

                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                      <Checkbox 
                        id="drafts" 
                        checked={filters.hasAiDraft}
                        onCheckedChange={(checked) => 
                          onFiltersChange({ ...filters, hasAiDraft: checked as boolean })
                        }
                      />
                      <Label htmlFor="drafts" className="flex items-center gap-2 text-sm cursor-pointer">
                        <FileEdit className="h-3.5 w-3.5 text-amber-500" />
                        AI Draft Ready
                      </Label>
                    </div>
                    {filterCounts.drafts > 0 && (
                      <Badge variant="outline" className="text-[10px] h-5 border-amber-500 text-amber-500">
                        {filterCounts.drafts}
                      </Badge>
                    )}
                  </div>

                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                      <Checkbox 
                        id="awaiting" 
                        checked={filters.awaitingReply}
                        onCheckedChange={(checked) => 
                          onFiltersChange({ ...filters, awaitingReply: checked as boolean })
                        }
                      />
                      <Label htmlFor="awaiting" className="flex items-center gap-2 text-sm cursor-pointer">
                        <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                        Awaiting Reply
                      </Label>
                    </div>
                    {filterCounts.awaiting > 0 && (
                      <Badge variant="secondary" className="text-[10px] h-5">
                        {filterCounts.awaiting}
                      </Badge>
                    )}
                  </div>
                </div>

                {activeFilterCount > 0 && (
                  <>
                    <Separator />
                    <Button 
                      variant="ghost" 
                      size="sm" 
                      className="w-full text-xs"
                      onClick={() => onFiltersChange({ requiresAttention: false, hasAiDraft: false, awaitingReply: false })}
                    >
                      Clear All Filters
                    </Button>
                  </>
                )}
              </div>
            </PopoverContent>
          </Popover>
        </div>
      </div>

      {/* Conversation List */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {filteredConversations.length === 0 ? (
          <div className="flex h-full items-center justify-center text-muted-foreground">No conversations found</div>
        ) : (
          filteredConversations.map((conversation) => (
            <ConversationCard
              key={conversation.id}
              conversation={conversation}
              isActive={activeConversationId === conversation.id}
              onClick={() => onSelectConversation(conversation.id)}
            />
          ))
        )}
      </div>
    </div>
  )
}
