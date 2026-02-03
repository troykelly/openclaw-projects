---
name: send-reminder
description: Send a reminder message to a contact
args:
  - name: contact
    description: Contact name or phone/email
    required: true
  - name: message
    description: Reminder message content
    required: true
  - name: channel
    description: Channel to use (sms or email)
    default: sms
---

Send a reminder to {{contact}} via {{channel}}:

**Message:** {{message}}

## Steps:

1. **Look up the contact**
   - Use `contact_search` to find the contact by name
   - If phone/email provided directly, verify the format

2. **Verify their {{channel}} endpoint**
   - For SMS: Ensure they have a valid phone number in E.164 format
   - For Email: Ensure they have a valid email address
   - If the preferred channel isn't available, suggest an alternative

3. **Send the message**
   - For SMS: Use `sms_send` with the phone number and message
   - For Email: Use `email_send` with appropriate subject line

4. **Confirm delivery**
   - Report the message status (queued, sent, etc.)
   - Store a memory of this communication if appropriate

## Important Notes:
- Always confirm before sending to prevent accidental messages
- For email, generate an appropriate subject line based on the message content
- Be mindful of message length limits (1600 chars for SMS)
