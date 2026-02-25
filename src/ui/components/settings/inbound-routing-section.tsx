/**
 * Inbound Routing settings section (Issues #1506, #1507, #1508).
 *
 * Three sub-sections:
 * 1. Channel Defaults — per-channel-type default agent/prompt/context
 * 2. Inbound Destinations — auto-discovered addresses with routing overrides
 * 3. Prompt Templates — reusable prompt templates for routing
 */

import { AlertCircle, Bot, ChevronsUpDown, FileText, Loader2, Mail, MessageSquare, Pencil, Phone, Plus, Radio, Trash2, Waves } from 'lucide-react';
import * as React from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Badge } from '@/ui/components/ui/badge';
import { Button } from '@/ui/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/ui/components/ui/card';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/ui/components/ui/command';
import { Input } from '@/ui/components/ui/input';
import { Label } from '@/ui/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/ui/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/ui/components/ui/select';
import { Separator } from '@/ui/components/ui/separator';
import { Switch } from '@/ui/components/ui/switch';
import { Textarea } from '@/ui/components/ui/textarea';
import { apiClient } from '@/ui/lib/api-client';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ChannelDefault {
  id: string;
  channel_type: string;
  agent_id: string;
  prompt_template_id: string | null;
  context_id: string | null;
}

interface InboundDestination {
  id: string;
  address: string;
  channel_type: string;
  display_name: string | null;
  agent_id: string | null;
  prompt_template_id: string | null;
  context_id: string | null;
  is_active: boolean;
}

interface PromptTemplate {
  id: string;
  label: string;
  content: string;
  channel_type: string;
  is_default: boolean;
  is_active: boolean;
}

type ChannelType = 'sms' | 'email' | 'ha_observation';

const CHANNEL_TYPES: { value: ChannelType; label: string; icon: React.ElementType }[] = [
  { value: 'sms', label: 'SMS', icon: Phone },
  { value: 'email', label: 'Email', icon: Mail },
  { value: 'ha_observation', label: 'HA Observations', icon: Waves },
];

const CHANNEL_TYPE_OPTIONS = ['sms', 'email', 'ha_observation', 'general'] as const;

function channelIcon(type: string) {
  switch (type) {
    case 'sms': return Phone;
    case 'email': return Mail;
    case 'ha_observation': return Waves;
    default: return MessageSquare;
  }
}

function channelLabel(type: string) {
  switch (type) {
    case 'sms': return 'SMS';
    case 'email': return 'Email';
    case 'ha_observation': return 'HA Observations';
    case 'general': return 'General';
    default: return type;
  }
}

// ---------------------------------------------------------------------------
// Agent Combobox (#1806)
// ---------------------------------------------------------------------------

interface AgentComboboxProps {
  /** Current agent ID value. */
  value: string;
  /** Called when the user selects or types an agent ID. */
  onChange: (value: string) => void;
  /** Known agent IDs from existing channel defaults. */
  knownAgents: string[];
  /** HTML id for label association. */
  id?: string;
  /** Channel type key used for test IDs. */
  channelType: string;
}

/** Combobox that shows known agents as suggestions and allows free text entry. */
function AgentCombobox({ value, onChange, knownAgents, id, channelType }: AgentComboboxProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  // When the popover opens, sync the search field with the current value
  const handleOpenChange = useCallback((nextOpen: boolean) => {
    if (nextOpen) {
      setSearch(value);
    }
    setOpen(nextOpen);
  }, [value]);

  const handleSelect = useCallback((agentId: string) => {
    onChange(agentId);
    setOpen(false);
  }, [onChange]);

  // Allow using the typed text directly (free text entry)
  const handleUseCustom = useCallback(() => {
    if (search.trim()) {
      onChange(search.trim());
      setOpen(false);
    }
  }, [search, onChange]);

  // Filter known agents by search term
  const filtered = useMemo(
    () => knownAgents.filter((a) => a.toLowerCase().includes(search.toLowerCase())),
    [knownAgents, search],
  );

  const showCustomOption = search.trim() !== '' && !knownAgents.includes(search.trim());

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          variant="outline"
          role="combobox"
          aria-expanded={open}
          data-testid={`agent-combobox-trigger-${channelType}`}
          className="mt-1 w-full justify-between font-normal"
        >
          <span className="truncate">{value || 'Select agent...'}</span>
          <ChevronsUpDown className="ml-2 size-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput
            ref={inputRef}
            data-testid={`agent-combobox-input-${channelType}`}
            placeholder="Type or select agent ID..."
            value={search}
            onValueChange={setSearch}
          />
          <CommandList>
            <CommandEmpty>No known agents found.</CommandEmpty>
            {filtered.length > 0 && (
              <CommandGroup heading="Known Agents">
                {filtered.map((agentId) => (
                  <CommandItem
                    key={agentId}
                    value={agentId}
                    onSelect={() => handleSelect(agentId)}
                  >
                    {agentId}
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {showCustomOption && (
              <CommandGroup heading="Custom">
                <CommandItem
                  value={`custom-${search.trim()}`}
                  onSelect={handleUseCustom}
                >
                  Use &ldquo;{search.trim()}&rdquo;
                </CommandItem>
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

// ---------------------------------------------------------------------------
// Channel Defaults Section (#1508)
// ---------------------------------------------------------------------------

function ChannelDefaultsSection() {
  const [defaults, setDefaults] = useState<ChannelDefault[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [editValues, setEditValues] = useState<Record<string, { agent_id: string }>>({});
  const [error, setError] = useState<string | null>(null);

  const fetchDefaults = useCallback(async () => {
    try {
      const data = await apiClient.get<ChannelDefault[]>('/api/channel-defaults');
      const items = Array.isArray(data) ? data : [];
      setDefaults(items);
      const values: Record<string, { agent_id: string }> = {};
      for (const d of items) {
        values[d.channel_type] = { agent_id: d.agent_id };
      }
      setEditValues(values);
      setError(null);
    } catch {
      setError('Failed to load channel defaults');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchDefaults(); }, [fetchDefaults]);

  const handleSave = useCallback(async (channelType: string) => {
    const val = editValues[channelType];
    if (!val?.agent_id?.trim()) return;
    setSaving(channelType);
    setError(null);
    try {
      await apiClient.put<ChannelDefault>(`/api/channel-defaults/${channelType}`, {
        agent_id: val.agent_id.trim(),
      });
      await fetchDefaults();
    } catch {
      setError('Failed to save channel default');
    } finally {
      setSaving(null);
    }
  }, [editValues, fetchDefaults]);

  // Collect unique agent IDs from existing defaults for combobox suggestions
  const knownAgents = useMemo(
    () => [...new Set(defaults.map((d) => d.agent_id).filter(Boolean))],
    [defaults],
  );

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Radio className="size-5" />Channel Defaults</CardTitle>
        </CardHeader>
        <CardContent><div className="flex justify-center py-8"><Loader2 className="size-6 animate-spin text-muted-foreground" /></div></CardContent>
      </Card>
    );
  }

  return (
    <Card data-testid="channel-defaults-section">
      <CardHeader>
        <div className="flex items-center gap-2">
          <Radio className="size-5 text-muted-foreground" />
          <CardTitle>Channel Defaults</CardTitle>
        </div>
        <CardDescription>Default routing for each channel type. Applied when a destination has no override.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && (
          <div data-testid="channel-defaults-error" className="flex items-center gap-2 rounded-lg border border-destructive/50 bg-destructive/10 p-3">
            <AlertCircle className="size-4 shrink-0 text-destructive" />
            <p className="text-sm text-destructive">{error}</p>
          </div>
        )}
        {CHANNEL_TYPES.map(({ value, label, icon: Icon }) => {
          const existing = defaults.find(d => d.channel_type === value);
          const editVal = editValues[value] ?? { agent_id: '' };

          return (
            <div key={value} className="rounded-lg border p-4">
              <div className="mb-3 flex items-center gap-2">
                <Icon className="size-4 text-muted-foreground" />
                <span className="text-sm font-medium">{label}</span>
                {existing ? (
                  <Badge variant="secondary" className="ml-auto text-xs">Configured</Badge>
                ) : (
                  <Badge variant="outline" className="ml-auto text-xs">Not configured</Badge>
                )}
              </div>
              <div className="flex items-end gap-2">
                <div className="flex-1">
                  <Label htmlFor={`default-agent-${value}`} className="text-xs text-muted-foreground">Agent ID</Label>
                  <AgentCombobox
                    id={`default-agent-${value}`}
                    value={editVal.agent_id}
                    onChange={(agentId) => setEditValues(prev => ({
                      ...prev,
                      [value]: { agent_id: agentId },
                    }))}
                    knownAgents={knownAgents}
                    channelType={value}
                  />
                </div>
                <Button
                  size="sm"
                  onClick={() => handleSave(value)}
                  disabled={saving === value || !editVal.agent_id?.trim()}
                >
                  {saving === value ? <Loader2 className="size-4 animate-spin" /> : 'Save'}
                </Button>
              </div>
              {!existing && (
                <p className="mt-2 text-xs text-muted-foreground">
                  Messages will be stored but not dispatched until a default is configured.
                </p>
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Inbound Destinations Section (#1507)
// ---------------------------------------------------------------------------

function InboundDestinationsSection() {
  const [destinations, setDestinations] = useState<InboundDestination[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>('all');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editAgent, setEditAgent] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchDestinations = useCallback(async () => {
    try {
      const data = await apiClient.get<{ items: InboundDestination[]; total: number }>(
        '/api/inbound-destinations?limit=100&include_inactive=true',
      );
      setDestinations(Array.isArray(data.items) ? data.items : []);
      setError(null);
    } catch {
      setError('Failed to load inbound destinations');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchDestinations(); }, [fetchDestinations]);

  const handleEdit = useCallback((dest: InboundDestination) => {
    setEditingId(dest.id);
    setEditAgent(dest.agent_id ?? '');
  }, []);

  const handleSave = useCallback(async (id: string) => {
    setSaving(true);
    setError(null);
    try {
      await apiClient.put<InboundDestination>(`/api/inbound-destinations/${id}`, {
        agent_id: editAgent.trim() || null,
      });
      setEditingId(null);
      await fetchDestinations();
    } catch {
      setError('Failed to save destination override');
    } finally {
      setSaving(false);
    }
  }, [editAgent, fetchDestinations]);

  const filtered = destinations.filter(d =>
    filter === 'all' || d.channel_type === filter,
  );

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Bot className="size-5" />Inbound Destinations</CardTitle>
        </CardHeader>
        <CardContent><div className="flex justify-center py-8"><Loader2 className="size-6 animate-spin text-muted-foreground" /></div></CardContent>
      </Card>
    );
  }

  return (
    <Card data-testid="inbound-destinations-section">
      <CardHeader>
        <div className="flex items-center gap-2">
          <Bot className="size-5 text-muted-foreground" />
          <CardTitle>Inbound Destinations</CardTitle>
        </div>
        <CardDescription>Auto-discovered addresses that have received messages. Set routing overrides per destination.</CardDescription>
      </CardHeader>
      <CardContent>
        {error && (
          <div data-testid="inbound-destinations-error" className="mb-4 flex items-center gap-2 rounded-lg border border-destructive/50 bg-destructive/10 p-3">
            <AlertCircle className="size-4 shrink-0 text-destructive" />
            <p className="text-sm text-destructive">{error}</p>
          </div>
        )}
        {/* Filter */}
        <div className="mb-4">
          <Select value={filter} onValueChange={setFilter}>
            <SelectTrigger className="w-48">
              <SelectValue placeholder="All channels" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All channels</SelectItem>
              <SelectItem value="sms">SMS</SelectItem>
              <SelectItem value="email">Email</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {filtered.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-8 text-center text-muted-foreground">
            <AlertCircle className="size-8" />
            <p className="text-sm">No destinations discovered yet.</p>
            <p className="text-xs">Destinations are created automatically when messages arrive.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {filtered.map((dest) => {
              const Icon = channelIcon(dest.channel_type);
              const isEditing = editingId === dest.id;

              return (
                <div key={dest.id} className="flex items-center gap-3 rounded-lg border p-3">
                  <Icon className="size-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium">{dest.address}</span>
                      {!dest.is_active && <Badge variant="outline" className="text-xs">Inactive</Badge>}
                    </div>
                    {dest.agent_id ? (
                      <span className="text-xs text-muted-foreground">Override: {dest.agent_id}</span>
                    ) : (
                      <span className="text-xs text-muted-foreground">Using channel default</span>
                    )}
                  </div>

                  {isEditing ? (
                    <div className="flex items-center gap-2">
                      <Input
                        value={editAgent}
                        onChange={(e) => setEditAgent(e.target.value)}
                        placeholder="Agent ID (empty = use default)"
                        className="h-8 w-48 text-xs"
                      />
                      <Button size="sm" variant="ghost" onClick={() => handleSave(dest.id)} disabled={saving}>
                        {saving ? <Loader2 className="size-3 animate-spin" /> : 'Save'}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setEditingId(null)}>Cancel</Button>
                    </div>
                  ) : (
                    <Button size="sm" variant="ghost" onClick={() => handleEdit(dest)}>
                      <Pencil className="size-3" />
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Prompt Templates Section (#1506)
// ---------------------------------------------------------------------------

function PromptTemplatesSection() {
  const [templates, setTemplates] = useState<PromptTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<PromptTemplate | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Form state
  const [formLabel, setFormLabel] = useState('');
  const [formContent, setFormContent] = useState('');
  const [formChannel, setFormChannel] = useState<string>('sms');
  const [formIsDefault, setFormIsDefault] = useState(false);

  const fetchTemplates = useCallback(async () => {
    try {
      const data = await apiClient.get<{ items: PromptTemplate[]; total: number }>(
        '/api/prompt-templates?limit=100&include_inactive=true',
      );
      setTemplates(Array.isArray(data.items) ? data.items : []);
      setError(null);
    } catch {
      setError('Failed to load prompt templates');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchTemplates(); }, [fetchTemplates]);

  const resetForm = useCallback(() => {
    setFormLabel('');
    setFormContent('');
    setFormChannel('sms');
    setFormIsDefault(false);
    setCreating(false);
    setEditing(null);
  }, []);

  const startCreate = useCallback(() => {
    resetForm();
    setCreating(true);
  }, [resetForm]);

  const startEdit = useCallback((t: PromptTemplate) => {
    setEditing(t);
    setFormLabel(t.label);
    setFormContent(t.content);
    setFormChannel(t.channel_type);
    setFormIsDefault(t.is_default);
    setCreating(false);
  }, []);

  const handleSave = useCallback(async () => {
    if (!formLabel.trim() || !formContent.trim()) return;
    setSaving(true);
    setError(null);
    try {
      if (editing) {
        await apiClient.patch(`/api/prompt-templates/${editing.id}`, {
          label: formLabel.trim(),
          content: formContent,
          channel_type: formChannel,
          is_default: formIsDefault,
        });
      } else {
        await apiClient.post('/api/prompt-templates', {
          label: formLabel.trim(),
          content: formContent,
          channel_type: formChannel,
          is_default: formIsDefault,
        });
      }
      resetForm();
      await fetchTemplates();
    } catch {
      setError('Failed to save prompt template');
    } finally {
      setSaving(false);
    }
  }, [editing, formLabel, formContent, formChannel, formIsDefault, resetForm, fetchTemplates]);

  const handleDelete = useCallback(async (id: string) => {
    setError(null);
    try {
      await apiClient.delete(`/api/prompt-templates/${id}`);
      await fetchTemplates();
    } catch {
      setError('Failed to delete prompt template');
    }
  }, [fetchTemplates]);

  const showForm = creating || editing !== null;

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><FileText className="size-5" />Prompt Templates</CardTitle>
        </CardHeader>
        <CardContent><div className="flex justify-center py-8"><Loader2 className="size-6 animate-spin text-muted-foreground" /></div></CardContent>
      </Card>
    );
  }

  return (
    <Card data-testid="prompt-templates-section">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <FileText className="size-5 text-muted-foreground" />
            <CardTitle>Prompt Templates</CardTitle>
          </div>
          {!showForm && (
            <Button size="sm" onClick={startCreate}>
              <Plus className="mr-1 size-4" /> New Template
            </Button>
          )}
        </div>
        <CardDescription>Reusable prompt templates for agent routing. Linked to channel defaults or destination overrides.</CardDescription>
      </CardHeader>
      <CardContent>
        {error && (
          <div data-testid="prompt-templates-error" className="mb-4 flex items-center gap-2 rounded-lg border border-destructive/50 bg-destructive/10 p-3">
            <AlertCircle className="size-4 shrink-0 text-destructive" />
            <p className="text-sm text-destructive">{error}</p>
          </div>
        )}
        {/* Create/Edit form */}
        {showForm && (
          <div className="mb-4 space-y-3 rounded-lg border bg-muted/30 p-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="pt-label" className="text-xs">Label</Label>
                <Input
                  id="pt-label"
                  value={formLabel}
                  onChange={(e) => setFormLabel(e.target.value)}
                  placeholder="e.g. SMS Triage Prompt"
                  className="mt-1"
                />
              </div>
              <div>
                <Label htmlFor="pt-channel" className="text-xs">Channel Type</Label>
                <Select value={formChannel} onValueChange={setFormChannel}>
                  <SelectTrigger id="pt-channel" className="mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CHANNEL_TYPE_OPTIONS.map(ct => (
                      <SelectItem key={ct} value={ct}>{channelLabel(ct)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label htmlFor="pt-content" className="text-xs">Content</Label>
              <Textarea
                id="pt-content"
                value={formContent}
                onChange={(e) => setFormContent(e.target.value)}
                placeholder="You are an SMS triage agent. Classify the incoming message..."
                rows={4}
                className="mt-1"
              />
              <p className="mt-1 text-xs text-muted-foreground">
                Available variables: {'{{sender}}'}, {'{{recipient}}'}, {'{{subject}}'}, {'{{body}}'}, {'{{contact_name}}'}, {'{{timestamp}}'}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Switch
                id="pt-default"
                checked={formIsDefault}
                onCheckedChange={setFormIsDefault}
              />
              <Label htmlFor="pt-default" className="text-xs">Set as default for this channel type</Label>
            </div>
            <div className="flex gap-2">
              <Button size="sm" onClick={handleSave} disabled={saving || !formLabel.trim() || !formContent.trim()}>
                {saving ? <Loader2 className="mr-1 size-4 animate-spin" /> : null}
                {editing ? 'Update' : 'Create'}
              </Button>
              <Button size="sm" variant="ghost" onClick={resetForm}>Cancel</Button>
            </div>
          </div>
        )}

        {/* Templates list */}
        {templates.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-8 text-center text-muted-foreground">
            <FileText className="size-8" />
            <p className="text-sm">No prompt templates yet.</p>
            <p className="text-xs">Create templates to configure agent prompts for inbound messages.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {templates.map((t) => {
              const Icon = channelIcon(t.channel_type);
              return (
                <div key={t.id} className="flex items-start gap-3 rounded-lg border p-3">
                  <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">{t.label}</span>
                      <Badge variant="secondary" className="text-xs">{channelLabel(t.channel_type)}</Badge>
                      {t.is_default && <Badge className="text-xs">Default</Badge>}
                      {!t.is_active && <Badge variant="outline" className="text-xs">Inactive</Badge>}
                    </div>
                    <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{t.content}</p>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <Button size="sm" variant="ghost" onClick={() => startEdit(t)}>
                      <Pencil className="size-3" />
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => handleDelete(t.id)}>
                      <Trash2 className="size-3" />
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Main Export
// ---------------------------------------------------------------------------

export function InboundRoutingSection() {
  return (
    <div className="space-y-6">
      <ChannelDefaultsSection />
      <Separator />
      <InboundDestinationsSection />
      <Separator />
      <PromptTemplatesSection />
    </div>
  );
}
