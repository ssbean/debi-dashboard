"use client";

import { useState } from "react";
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
import type { Trigger } from "@/lib/types";

export function TriggersManager({ initialTriggers }: { initialTriggers: Trigger[] }) {
  const router = useRouter();
  const [triggers, setTriggers] = useState(initialTriggers);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingTrigger, setEditingTrigger] = useState<Trigger | null>(null);

  const [form, setForm] = useState({
    name: "",
    description: "",
    email_type: "congratulatory" as Trigger["email_type"],
    reply_in_thread: false,
  });

  function resetForm() {
    setForm({ name: "", description: "", email_type: "congratulatory", reply_in_thread: false });
    setEditingTrigger(null);
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

  async function handleSave() {
    const url = editingTrigger ? `/api/triggers/${editingTrigger.id}` : "/api/triggers";
    const method = editingTrigger ? "PUT" : "POST";

    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
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
              <Label>Description</Label>
              <Textarea
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                placeholder="Natural language description of what triggers this..."
                rows={3}
              />
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
            <Button onClick={handleSave} className="w-full">
              {editingTrigger ? "Update" : "Create"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <div className="space-y-3">
        {triggers.map((trigger) => (
          <Card key={trigger.id}>
            <CardContent className="flex items-center justify-between py-4">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{trigger.name}</span>
                  <Badge variant="outline">{trigger.email_type}</Badge>
                  {trigger.reply_in_thread && <Badge variant="secondary">Thread</Badge>}
                </div>
                <p className="text-sm text-muted-foreground">{trigger.description}</p>
              </div>
              <div className="flex items-center gap-3">
                <Switch
                  checked={trigger.enabled}
                  onCheckedChange={() => handleToggleEnabled(trigger)}
                />
                <Button variant="ghost" size="sm" onClick={() => openEdit(trigger)}>
                  Edit
                </Button>
                <Button variant="ghost" size="sm" onClick={() => handleDelete(trigger.id)}>
                  Delete
                </Button>
              </div>
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
