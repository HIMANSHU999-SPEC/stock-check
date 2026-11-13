// Email wording lives on the server (Settings → Email templates). When the
// server cannot send a message itself — no mailbox configured, or Microsoft
// refused it — the same wording is offered as a draft in the person's own
// mailbox, so nothing is silently lost.

const drafts = [];
let nextId = 1;
const changed = () => window.dispatchEvent(new CustomEvent('email-drafts'));

/** Drafts waiting to be opened (shown by EmailDraftBar). */
export function pendingDrafts() {
    return [...drafts];
}

export function queueDraft(to, subject, body) {
    if (!to || !subject) return;
    drafts.push({ id: nextId++, to, subject, body: body || '' });
    changed();
}

export function dismissDraft(id) {
    const index = drafts.findIndex((d) => d.id === id);
    if (index > -1) drafts.splice(index, 1);
    changed();
}

export function mailtoLink(to, subject, body) {
    return `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

// Opens a new message in Outlook on the web, already filled in.
export function outlookWebLink(to, subject, body) {
    const params = new URLSearchParams({ to, subject, body });
    return `https://outlook.office.com/mail/deeplink/compose?${params.toString().replace(/\+/g, '%20')}`;
}

export function openEmailDraft(to, subject, body) {
    window.location.href = mailtoLink(to, subject, body);
}

// Turn the server's answer to a "send email" request into a line for the
// user. A message that could not be sent is queued as a draft.
export function handleEmailResult(result) {
    if (!result) return '';
    if (result.status === 'sent') return `Email sent to ${result.to}.`;
    if (result.status === 'no_recipient') return 'No email was sent: there is no email address on record.';
    if (result.subject) {
        if (!result.to) return 'No email address on record.';
        queueDraft(result.to, result.subject, result.body);
        return `The email to ${result.to} was not sent automatically — use the draft at the bottom of the screen to send it yourself.`;
    }
    if (result.status === 'not_configured') return '';
    return `The email could not be sent: ${result.error || 'unknown error'}`;
}
