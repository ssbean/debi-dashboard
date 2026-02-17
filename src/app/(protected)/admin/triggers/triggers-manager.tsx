"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import type { Trigger, StyleExample } from "@/lib/types";

export function TriggersManager({ initialTriggers }: { initialTriggers: Trigger[] }) {
  const router = useRouter();
  const [triggers, setTriggers] = useState(initialTriggers);

  // Sync with server data after router.refresh()
  useEffect(() => {
    setTriggers(initialTriggers);
  }, [initialTriggers]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingTrigger, setEditingTrigger] = useState<Trigger | null>(null);

  // Style examples state
  const [expandedTriggerId, setExpandedTriggerId] = useState<string | null>(null);
  const [examples, setExamples] = useState<StyleExample[]>([]);
  const [loadingExamples, setLoadingExamples] = useState(false);
  const [exampleDialogOpen, setExampleDialogOpen] = useState(false);
  const [exampleForm, setExampleForm] = useState({ body: "" });
  const [editingExampleId, setEditingExampleId] = useState<string | null>(null);
  const [filterTestResults, setFilterTestResults] = useState<{ from: string; subject: string; date: string }[]>([]);
  const [filterTestLoading, setFilterTestLoading] = useState(false);
  const [filterTestRan, setFilterTestRan] = useState(false);
  const [expandedExampleId, setExpandedExampleId] = useState<string | null>(null);

  const fetchExamples = useCallback(async (triggerId: string) => {
    setLoadingExamples(true);
    const res = await fetch(`/api/triggers/${triggerId}/examples`);
    if (res.ok) {
      setExamples(await res.json());
    }
    setLoadingExamples(false);
  }, []);

  useEffect(() => {
    if (expandedTriggerId) {
      fetchExamples(expandedTriggerId);
    }
  }, [expandedTriggerId, fetchExamples]);

  async function handleAddExample() {
    if (!expandedTriggerId) return;
    const res = await fetch(`/api/triggers/${expandedTriggerId}/examples`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(exampleForm),
    });
    if (res.ok) {
      const newExample = await res.json();
      setExamples((prev) => [newExample, ...prev]);
      setExampleDialogOpen(false);
      setExampleForm({ body: "" });
      toast.success("Example added");
    } else {
      const data = await res.json();
      toast.error(data.error ?? "Failed to add example");
    }
  }

  function openEditExample(ex: StyleExample) {
    setEditingExampleId(ex.id);
    setExampleForm({ body: ex.body });
    setExampleDialogOpen(true);
  }

  async function handleSaveExample() {
    if (editingExampleId) {
      if (!expandedTriggerId) return;
      const res = await fetch(`/api/triggers/${expandedTriggerId}/examples`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: editingExampleId, body: exampleForm.body }),
      });
      if (res.ok) {
        const updated = await res.json();
        setExamples((prev) => prev.map((e) => (e.id === updated.id ? updated : e)));
        setExampleDialogOpen(false);
        setExampleForm({ body: "" });
        setEditingExampleId(null);
        toast.success("Example updated");
      } else {
        const data = await res.json();
        toast.error(data.error ?? "Failed to update example");
      }
    } else {
      await handleAddExample();
    }
  }

  async function handleDeleteExample(exampleId: string) {
    if (!expandedTriggerId) return;
    const res = await fetch(
      `/api/triggers/${expandedTriggerId}/examples?exampleId=${exampleId}`,
      { method: "DELETE" },
    );
    if (res.ok) {
      setExamples((prev) => prev.filter((e) => e.id !== exampleId));
      toast.success("Example deleted");
    }
  }

  const defaultSystemPrompt = "You are drafting an email as a CEO. Write in the CEO's voice and style based on the provided examples. The email should be:\n- Warm but professional\n- Personal and specific to the situation\n- Concise (2-4 paragraphs)\n- Match the tone and patterns from the style examples";

  const [form, setForm] = useState({
    name: "",
    description: "",
    email_type: "congratulatory" as Trigger["email_type"],
    reply_in_thread: false,
    match_mode: "llm" as Trigger["match_mode"],
    gmail_filter_query: "",
    system_prompt: defaultSystemPrompt,
    reply_window_min_hours: 4,
    reply_window_max_hours: 6,
  });

  function resetForm() {
    setForm({ name: "", description: "", email_type: "congratulatory", reply_in_thread: false, match_mode: "llm", gmail_filter_query: "", system_prompt: defaultSystemPrompt, reply_window_min_hours: 4, reply_window_max_hours: 6 });
    setEditingTrigger(null);
    setFilterTestResults([]);
    setFilterTestRan(false);
  }

  async function handleToggleEnabled(trigger: Trigger) {
    const res = await fetch(`/api/triggers/${trigger.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...trigger, enabled: !trigger.enabled }),
    });
    if (res.ok) {
      setTriggers((prev) =>
        prev.map((t) => (t.id === trigger.id ? { ...t, enabled: !t.enabled } : t)),
      );
    }
  }

  async function handleTestFilter() {
    if (!form.gmail_filter_query.trim()) {
      toast.error("Enter a filter query first");
      return;
    }
    setFilterTestLoading(true);
    setFilterTestRan(true);
    try {
      const res = await fetch("/api/triggers/test-filter", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: form.gmail_filter_query }),
      });
      if (res.ok) {
        setFilterTestResults(await res.json());
      } else {
        const data = await res.json();
        toast.error(data.error ?? "Test failed");
        setFilterTestResults([]);
      }
    } catch {
      toast.error("Test failed");
      setFilterTestResults([]);
    } finally {
      setFilterTestLoading(false);
    }
  }

  async function handleSave() {
    if (form.match_mode === "llm" && !form.description.trim()) {
      toast.error("Description is required for LLM mode");
      return;
    }
    if (form.match_mode === "gmail_filter" && !form.gmail_filter_query.trim()) {
      toast.error("Gmail filter query is required for filter mode");
      return;
    }
    if (form.reply_window_min_hours >= form.reply_window_max_hours || form.reply_window_min_hours <= 0) {
      toast.error("Reply window: min must be less than max, both must be > 0");
      return;
    }
    const url = editingTrigger ? `/api/triggers/${editingTrigger.id}` : "/api/triggers";
    const method = editingTrigger ? "PUT" : "POST";

    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...form,
        gmail_filter_query: form.gmail_filter_query.trim() || null,
      }),
    });

    if (res.ok) {
      toast.success(editingTrigger ? "Trigger updated" : "Trigger created");
      setDialogOpen(false);
      resetForm();
      router.refresh();
    } else {
      const data = await res.json();
      toast.error(data.error ?? "Failed");
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this trigger?")) return;
    const res = await fetch(`/api/triggers/${id}`, { method: "DELETE" });
    if (res.ok) {
      setTriggers((prev) => prev.filter((t) => t.id !== id));
      toast.success("Trigger deleted");
    }
  }

  function openEdit(trigger: Trigger) {
    setEditingTrigger(trigger);
    setForm({
      name: trigger.name,
      description: trigger.description,
      email_type: trigger.email_type,
      reply_in_thread: trigger.reply_in_thread,
      match_mode: trigger.match_mode,
      gmail_filter_query: trigger.gmail_filter_query ?? "",
      system_prompt: trigger.system_prompt,
      reply_window_min_hours: trigger.reply_window_min_hours,
      reply_window_max_hours: trigger.reply_window_max_hours,
    });
    setDialogOpen(true);
  }

  return (
    <>
      <Dialog
        open={dialogOpen}
        onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open) resetForm();
        }}
      >
        <DialogTrigger asChild>
          <Button>Add Trigger</Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingTrigger ? "Edit Trigger" : "New Trigger"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Name</Label>
              <Input
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="e.g., Exceptional Sales"
              />
            </div>
            <div className="space-y-2">
              <Label>Match Mode</Label>
              <div className="flex gap-4">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="radio"
                    name="match_mode"
                    value="llm"
                    checked={form.match_mode === "llm"}
                    onChange={() => setForm((f) => ({ ...f, match_mode: "llm" }))}
                  />
                  LLM Classification
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="radio"
                    name="match_mode"
                    value="gmail_filter"
                    checked={form.match_mode === "gmail_filter"}
                    onChange={() => setForm((f) => ({ ...f, match_mode: "gmail_filter" }))}
                  />
                  Gmail Filter
                </label>
              </div>
            </div>
            <div className="space-y-2">
              <Label>Description</Label>
              <Textarea
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                placeholder="Natural language description of what triggers this..."
                rows={3}
              />
            </div>
            <div className="space-y-2">
              <Label>Gmail Filter Query</Label>
              <Input
                value={form.gmail_filter_query}
                onChange={(e) => setForm((f) => ({ ...f, gmail_filter_query: e.target.value }))}
                placeholder="e.g. from:company.com subject:invoice"
              />
              <div className="flex items-center justify-between">
                <p className="text-xs text-muted-foreground">
                  Uses Gmail search syntax. Only used in Gmail Filter mode.
                </p>
                {form.match_mode === "gmail_filter" && (
                  <button
                    type="button"
                    onClick={handleTestFilter}
                    disabled={filterTestLoading}
                    className="text-xs text-primary hover:underline disabled:opacity-50"
                  >
                    {filterTestLoading ? "Testing..." : "Test filter"}
                  </button>
                )}
              </div>
              {filterTestRan && form.match_mode === "gmail_filter" && (
                <div className="rounded-md border p-2 space-y-1">
                  {filterTestResults.length === 0 ? (
                    <p className="text-xs text-muted-foreground">No emails matched this filter.</p>
                  ) : (
                    filterTestResults.map((r, i) => (
                      <div key={i} className="text-xs space-y-0.5 border-b last:border-0 pb-1 last:pb-0">
                        <p className="font-medium truncate">{r.from}</p>
                        <p className="text-muted-foreground truncate">{r.subject}</p>
                        <p className="text-muted-foreground">{new Date(r.date).toLocaleDateString()}</p>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
            <div className="space-y-2">
              <Label>Email Type</Label>
              <select
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm"
                value={form.email_type}
                onChange={(e) =>
                  setForm((f) => ({ ...f, email_type: e.target.value as Trigger["email_type"] }))
                }
              >
                <option value="congratulatory">Congratulatory</option>
                <option value="promotional">Promotional</option>
                <option value="welcome">Welcome</option>
              </select>
            </div>
            <div className="flex items-center gap-2">
              <Switch
                checked={form.reply_in_thread}
                onCheckedChange={(checked) => setForm((f) => ({ ...f, reply_in_thread: checked }))}
              />
              <Label>Reply in thread</Label>
            </div>
            <div className="space-y-2">
              <Label>Reply Window (hours after email received)</Label>
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  min={0.5}
                  step={0.5}
                  value={form.reply_window_min_hours}
                  onChange={(e) => setForm((f) => ({ ...f, reply_window_min_hours: parseFloat(e.target.value) || 0 }))}
                  className="w-24"
                />
                <span className="text-sm text-muted-foreground">to</span>
                <Input
                  type="number"
                  min={0.5}
                  step={0.5}
                  value={form.reply_window_max_hours}
                  onChange={(e) => setForm((f) => ({ ...f, reply_window_max_hours: parseFloat(e.target.value) || 0 }))}
                  className="w-24"
                />
                <span className="text-sm text-muted-foreground">hours</span>
              </div>
              {form.reply_window_min_hours >= form.reply_window_max_hours && (
                <p className="text-sm text-destructive">Min must be less than max</p>
              )}
            </div>
            <div>
              <Label>System Prompt</Label>
              <Textarea
                value={form.system_prompt}
                onChange={(e) => setForm((f) => ({ ...f, system_prompt: e.target.value }))}
                rows={6}
                className="mt-1 font-mono text-xs"
                placeholder="System prompt for draft generation..."
              />
              <p className="text-xs text-muted-foreground mt-1">Controls how Claude generates draft replies for this trigger.</p>
            </div>
            <Button onClick={handleSave} className="w-full">
              {editingTrigger ? "Update" : "Create"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <div className="space-y-3">
        {triggers.map((trigger) => (
          <Card key={trigger.id}>
            <CardContent className="py-4">
              <div className="flex items-center justify-between">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{trigger.name}</span>
                    <Badge variant="outline">{trigger.email_type}</Badge>
                    <Badge variant={trigger.match_mode === "gmail_filter" ? "default" : "secondary"}>
                      {trigger.match_mode === "gmail_filter" ? "Filter" : "LLM"}
                    </Badge>
                    {trigger.reply_in_thread && <Badge variant="secondary">Thread</Badge>}
                  </div>
                  <p className="text-sm text-muted-foreground">{trigger.description}</p>
                </div>
                <div className="flex items-center gap-3">
                  <Switch
                    checked={trigger.enabled}
                    onCheckedChange={() => handleToggleEnabled(trigger)}
                  />
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      setExpandedTriggerId(expandedTriggerId === trigger.id ? null : trigger.id)
                    }
                  >
                    Examples
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => openEdit(trigger)}>
                    Edit
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => handleDelete(trigger.id)}>
                    Delete
                  </Button>
                </div>
              </div>

              {expandedTriggerId === trigger.id && (
                <div className="mt-4 border-t pt-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <h4 className="text-sm font-medium">Style Examples</h4>
                    <Dialog open={exampleDialogOpen} onOpenChange={(open) => {
                      setExampleDialogOpen(open);
                      if (!open) { setEditingExampleId(null); setExampleForm({ body: "" }); }
                    }}>
                      <DialogTrigger asChild>
                        <Button size="sm" variant="outline">
                          Add Example
                        </Button>
                      </DialogTrigger>
                      <DialogContent>
                        <DialogHeader>
                          <DialogTitle>{editingExampleId ? "Edit Style Example" : "Add Style Example"}</DialogTitle>
                        </DialogHeader>
                        <div className="space-y-4">
                          <div className="space-y-2">
                            <Label>Body</Label>
                            <Textarea
                              value={exampleForm.body}
                              onChange={(e) =>
                                setExampleForm((f) => ({ ...f, body: e.target.value }))
                              }
                              placeholder="Example email body..."
                              rows={8}
                            />
                          </div>
                          <Button onClick={handleSaveExample} className="w-full">
                            {editingExampleId ? "Update" : "Add"}
                          </Button>
                        </div>
                      </DialogContent>
                    </Dialog>
                  </div>

                  {loadingExamples ? (
                    <p className="text-sm text-muted-foreground">Loading...</p>
                  ) : examples.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      No examples yet. Add one to help match the CEO&apos;s voice.
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {examples.map((ex) => (
                        <div
                          key={ex.id}
                          className="rounded-md border p-3 text-sm space-y-1"
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <Badge variant="secondary">{ex.source}</Badge>
                            </div>
                            <div className="flex items-center gap-1">
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() =>
                                  setExpandedExampleId(
                                    expandedExampleId === ex.id ? null : ex.id,
                                  )
                                }
                              >
                                {expandedExampleId === ex.id ? "Collapse" : "Expand"}
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => openEditExample(ex)}
                              >
                                Edit
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleDeleteExample(ex.id)}
                              >
                                Delete
                              </Button>
                            </div>
                          </div>
                          <p className="text-muted-foreground whitespace-pre-wrap">
                            {expandedExampleId === ex.id
                              ? ex.body
                              : ex.body.length > 150
                                ? ex.body.slice(0, 150) + "..."
                                : ex.body}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        ))}
        {triggers.length === 0 && (
          <p className="text-muted-foreground">No triggers configured. Add one to get started.</p>
        )}
      </div>
    </>
  );
}
