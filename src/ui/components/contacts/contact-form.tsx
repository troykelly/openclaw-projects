import * as React from 'react';
import { useState, useEffect } from 'react';
import { cn } from '@/ui/lib/utils';
import { Button } from '@/ui/components/ui/button';
import { Input } from '@/ui/components/ui/input';
import { Textarea } from '@/ui/components/ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from '@/ui/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/ui/components/ui/select';
import type { Contact, ContactKind, CreateContactBody } from './types';

export interface ContactFormProps {
  contact?: Contact;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (data: CreateContactBody) => void;
  className?: string;
}

const CONTACT_KINDS: { value: ContactKind; label: string }[] = [
  { value: 'person', label: 'Person' },
  { value: 'organisation', label: 'Organisation' },
  { value: 'group', label: 'Group' },
  { value: 'agent', label: 'AI Agent' },
];

export function ContactForm({ contact, open, onOpenChange, onSubmit, className }: ContactFormProps) {
  const [contactKind, setContactKind] = useState<ContactKind>(contact?.contact_kind ?? 'person');
  const [givenName, setGivenName] = useState(contact?.given_name ?? '');
  const [familyName, setFamilyName] = useState(contact?.family_name ?? '');
  const [displayName, setDisplayName] = useState(contact?.display_name ?? '');
  const [nickname, setNickname] = useState(contact?.nickname ?? '');
  const [email, setEmail] = useState(contact?.endpoints?.find((e) => e.type === 'email')?.value ?? '');
  const [phone, setPhone] = useState(contact?.endpoints?.find((e) => e.type === 'phone')?.value ?? '');
  const [notes, setNotes] = useState(contact?.notes ?? '');

  useEffect(() => {
    setContactKind(contact?.contact_kind ?? 'person');
    setGivenName(contact?.given_name ?? '');
    setFamilyName(contact?.family_name ?? '');
    setDisplayName(contact?.display_name ?? '');
    setNickname(contact?.nickname ?? '');
    setEmail(contact?.endpoints?.find((e) => e.type === 'email')?.value ?? '');
    setPhone(contact?.endpoints?.find((e) => e.type === 'phone')?.value ?? '');
    setNotes(contact?.notes ?? '');
  }, [contact]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const body: CreateContactBody = {
      contact_kind: contactKind,
      ...(contactKind === 'person'
        ? { given_name: givenName || undefined, family_name: familyName || undefined }
        : { display_name: displayName || undefined }),
      nickname: nickname || undefined,
      notes: notes || undefined,
      endpoints: [
        ...(email ? [{ type: 'email' as const, value: email }] : []),
        ...(phone ? [{ type: 'phone' as const, value: phone }] : []),
      ],
    };
    onSubmit(body);
  };

  const isPerson = contactKind === 'person';
  const isValid = isPerson ? (givenName.trim() || familyName.trim()) : displayName.trim();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={cn('sm:max-w-md', className)}>
        <DialogHeader>
          <DialogTitle>{contact ? 'Edit Contact' : 'Add Contact'}</DialogTitle>
          <DialogDescription className="sr-only">{contact ? 'Edit contact details' : 'Add a new contact'}</DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <label htmlFor="contact_kind" className="text-sm font-medium">
              Type
            </label>
            <Select value={contactKind} onValueChange={(v) => setContactKind(v as ContactKind)}>
              <SelectTrigger id="contact_kind">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CONTACT_KINDS.map((k) => (
                  <SelectItem key={k.value} value={k.value}>
                    {k.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {isPerson ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <label htmlFor="given_name" className="text-sm font-medium">
                  Given Name <span className="text-destructive">*</span>
                </label>
                <Input id="given_name" value={givenName} onChange={(e) => setGivenName(e.target.value)} placeholder="John" />
              </div>
              <div className="space-y-2">
                <label htmlFor="family_name" className="text-sm font-medium">
                  Family Name
                </label>
                <Input id="family_name" value={familyName} onChange={(e) => setFamilyName(e.target.value)} placeholder="Doe" />
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              <label htmlFor="display_name" className="text-sm font-medium">
                Name <span className="text-destructive">*</span>
              </label>
              <Input id="display_name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Acme Corp" />
            </div>
          )}

          <div className="space-y-2">
            <label htmlFor="nickname" className="text-sm font-medium">
              Nickname
            </label>
            <Input id="nickname" value={nickname} onChange={(e) => setNickname(e.target.value)} placeholder="Johnny" />
          </div>

          <div className="space-y-2">
            <label htmlFor="email" className="text-sm font-medium">
              Email
            </label>
            <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="john@example.com" />
          </div>

          <div className="space-y-2">
            <label htmlFor="phone" className="text-sm font-medium">
              Phone
            </label>
            <Input id="phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+1 (555) 123-4567" />
          </div>

          <div className="space-y-2">
            <label htmlFor="notes" className="text-sm font-medium">
              Notes
            </label>
            <Textarea id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Additional notes..." rows={3} />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!isValid}>
              {contact ? 'Save Changes' : 'Add Contact'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
