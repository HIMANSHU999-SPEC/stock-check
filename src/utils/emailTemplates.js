// Email wording lives on the server (Settings → Email templates). This is the
// fallback for when no sending mailbox is configured: open the user's own
// mail app with the rendered message.
export function openEmailDraft(to, subject, body, cc) {
    const encodedSubject = encodeURIComponent(subject);
    const encodedBody = encodeURIComponent(body);
    const ccPart = cc ? `&cc=${encodeURIComponent(cc)}` : '';
    const mailtoLink = `mailto:${encodeURIComponent(to)}?subject=${encodedSubject}&body=${encodedBody}${ccPart}`;
    window.location.href = mailtoLink;
}

// Turn the server's answer to a "send email" request into a line for the user,
// falling back to a mail-app draft when the server has no mailbox to send from.
export function handleEmailResult(result) {
    if (!result) return '';
    if (result.status === 'sent') return `Email sent to ${result.to}.`;
    if (result.status === 'not_configured' && result.subject) {
        if (!result.to) return 'No email address on record.';
        openEmailDraft(result.to, result.subject, result.body);
        return '';
    }
    if (result.status === 'not_configured') return '';
    if (result.status === 'no_recipient') return 'No email was sent: there is no email address on record.';
    return `The email could not be sent: ${result.error || 'unknown error'}`;
}
