"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { toast } from "sonner";
import type { Settings } from "@/lib/types";

export function SettingsForm({ initialSettings, devMode }: { initialSettings: Settings; devMode: boolean }) {
  const [settings, setSettings] = useState(initialSettings);
  const [saving, setSaving] = useState(false);
  const [newHoliday, setNewHoliday] = useState("");

  async function handleSave() {
    setSaving(true);
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });
      if (res.ok) {
        toast.success("Settings saved");
      } else {
        const data = await res.json();
        toast.error(data.error ?? "Failed to save");
      }
    } finally {
      setSaving(false);
    }
  }

  function addHoliday() {
    if (newHoliday && !settings.holidays.includes(newHoliday)) {
      setSettings((s) => ({ ...s, holidays: [...s.holidays, newHoliday].sort() }));
      setNewHoliday("");
    }
  }

  function removeHoliday(date: string) {
    setSettings((s) => ({ ...s, holidays: s.holidays.filter((h) => h !== date) }));
  }

  return (
    <div className="max-w-2xl space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Auto-Approval Threshold</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Confidence Threshold</Label>
              <span className="text-sm font-medium">{settings.confidence_threshold}%</span>
            </div>
            <Slider
              value={[settings.confidence_threshold]}
              onValueChange={([v]) => setSettings((s) => ({ ...s, confidence_threshold: v }))}
              min={0}
              max={100}
              step={5}
            />
            <p className="text-xs text-muted-foreground">
              Drafts with confidence at or above this threshold (with 5-point buffer) and a valid
              recipient will be auto-approved. Set to 100 to require manual approval for all drafts.
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Business Hours</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>CEO Email</Label>
            <Input
              type="email"
              value={settings.ceo_email}
              onChange={(e) => setSettings((s) => ({ ...s, ceo_email: e.target.value }))}
              placeholder="ceo@company.com"
            />
            <p className="text-xs text-muted-foreground">
              The Gmail inbox to monitor for incoming emails.
            </p>
          </div>
          <div className="space-y-2">
            <Label>CEO Timezone</Label>
            <Input
              value={settings.ceo_timezone}
              onChange={(e) => setSettings((s) => ({ ...s, ceo_timezone: e.target.value }))}
              placeholder="America/New_York"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Start Time</Label>
              <Input
                type="time"
                value={settings.business_hours_start}
                onChange={(e) =>
                  setSettings((s) => ({ ...s, business_hours_start: e.target.value }))
                }
              />
            </div>
            <div className="space-y-2">
              <Label>End Time</Label>
              <Input
                type="time"
                value={settings.business_hours_end}
                onChange={(e) =>
                  setSettings((s) => ({ ...s, business_hours_end: e.target.value }))
                }
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Company Domains</Label>
            <Input
              value={settings.company_domains}
              onChange={(e) => setSettings((s) => ({ ...s, company_domains: e.target.value }))}
              placeholder="company.com, subsidiary.com"
            />
            <p className="text-xs text-muted-foreground">
              Comma-separated. Only emails from these domains will be processed.
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Holidays</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-2">
            <Input
              type="date"
              value={newHoliday}
              onChange={(e) => setNewHoliday(e.target.value)}
            />
            <Button variant="outline" onClick={addHoliday}>
              Add
            </Button>
          </div>
          <div className="flex flex-wrap gap-2">
            {settings.holidays.map((date) => (
              <span
                key={date}
                className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-1 text-sm"
              >
                {date}
                <button onClick={() => removeHoliday(date)} className="text-muted-foreground hover:text-foreground">
                  &times;
                </button>
              </span>
            ))}
            {settings.holidays.length === 0 && (
              <p className="text-sm text-muted-foreground">No holidays configured.</p>
            )}
          </div>
        </CardContent>
      </Card>

      {devMode && (
        <Card className="border-amber-300 bg-amber-50">
          <CardHeader>
            <CardTitle className="text-amber-900">Dev Mode — Email Redirect</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <Label className="text-amber-900">Redirect All Emails To</Label>
            <Input
              value={settings.dev_redirect_emails ?? ""}
              onChange={(e) => setSettings((s) => ({ ...s, dev_redirect_emails: e.target.value || null }))}
              placeholder="you@example.com, other@example.com"
            />
            <p className="text-xs text-amber-800">
              Comma-separated. When set, all outgoing emails will be sent to these addresses instead of the real recipients. Leave empty to block all sending.
            </p>
          </CardContent>
        </Card>
      )}

      <Button onClick={handleSave} disabled={saving}>
        {saving ? "Saving..." : "Save Settings"}
      </Button>
    </div>
  );
}
