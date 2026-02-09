import * as React from 'react';
import { useState } from 'react';
import { cn } from '@/ui/lib/utils';
import { Button } from '@/ui/components/ui/button';
import { Input } from '@/ui/components/ui/input';
import { Textarea } from '@/ui/components/ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from '@/ui/components/ui/dialog';
import type { Contact } from './types';

export interface ContactFormData {
  name: string;
  email: string;
  company?: string;
  role?: string;
  phone?: string;
  notes?: string;
}

export interface ContactFormProps {
  contact?: Contact;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (data: ContactFormData) => void;
  className?: string;
}

export function ContactForm({ contact, open, onOpenChange, onSubmit, className }: ContactFormProps) {
  const [formData, setFormData] = useState<ContactFormData>({
    name: contact?.name ?? '',
    email: contact?.email ?? '',
    company: contact?.company ?? '',
    role: contact?.role ?? '',
    phone: contact?.phone ?? '',
    notes: contact?.notes ?? '',
  });

  const handleChange = (field: keyof ContactFormData) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setFormData((prev) => ({ ...prev, [field]: e.target.value }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit(formData);
  };

  const isValid = formData.name.trim() && formData.email.trim();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={cn('sm:max-w-md', className)}>
        <DialogHeader>
          <DialogTitle>{contact ? 'Edit Contact' : 'Add Contact'}</DialogTitle>
          <DialogDescription className="sr-only">{contact ? 'Edit contact details' : 'Add a new contact'}</DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <label htmlFor="name" className="text-sm font-medium">
              Name <span className="text-destructive">*</span>
            </label>
            <Input id="name" value={formData.name} onChange={handleChange('name')} placeholder="John Doe" required />
          </div>

          <div className="space-y-2">
            <label htmlFor="email" className="text-sm font-medium">
              Email <span className="text-destructive">*</span>
            </label>
            <Input id="email" type="email" value={formData.email} onChange={handleChange('email')} placeholder="john@example.com" required />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <label htmlFor="company" className="text-sm font-medium">
                Company
              </label>
              <Input id="company" value={formData.company} onChange={handleChange('company')} placeholder="Acme Corp" />
            </div>

            <div className="space-y-2">
              <label htmlFor="role" className="text-sm font-medium">
                Role
              </label>
              <Input id="role" value={formData.role} onChange={handleChange('role')} placeholder="Product Manager" />
            </div>
          </div>

          <div className="space-y-2">
            <label htmlFor="phone" className="text-sm font-medium">
              Phone
            </label>
            <Input id="phone" type="tel" value={formData.phone} onChange={handleChange('phone')} placeholder="+1 (555) 123-4567" />
          </div>

          <div className="space-y-2">
            <label htmlFor="notes" className="text-sm font-medium">
              Notes
            </label>
            <Textarea id="notes" value={formData.notes} onChange={handleChange('notes')} placeholder="Additional notes..." rows={3} />
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
