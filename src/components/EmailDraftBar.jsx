import React, { useEffect, useState } from 'react';
import { pendingDrafts, dismissDraft, mailtoLink, outlookWebLink } from '../utils/emailTemplates';

/**
 * Messages the server could not send itself, offered as ready-written
 * drafts: one click opens a new message in Outlook with the recipient,
 * subject and wording filled in, for the person to check and send.
 */
export default function EmailDraftBar() {
    const [drafts, setDrafts] = useState(pendingDrafts());

    useEffect(() => {
        const update = () => setDrafts(pendingDrafts());
        window.addEventListener('email-drafts', update);
        return () => window.removeEventListener('email-drafts', update);
    }, []);

    if (drafts.length === 0) return null;
    return (
        <div className="draft-bar" role="status">
            {drafts.map((draft) => (
                <div key={draft.id} className="draft-bar-item">
                    <div className="draft-bar-text">
                        <strong>Email not sent automatically</strong>
                        <span> — to {draft.to}: {draft.subject}</span>
                    </div>
                    <div className="draft-bar-actions">
                        <a
                            className="btn btn-sm btn-primary" target="_blank" rel="noreferrer"
                            href={outlookWebLink(draft.to, draft.subject, draft.body)}
                        >
                            Open draft in Outlook
                        </a>
                        <a className="btn btn-sm btn-secondary" href={mailtoLink(draft.to, draft.subject, draft.body)}>
                            Open in mail app
                        </a>
                        <button type="button" className="btn btn-sm btn-secondary" onClick={() => dismissDraft(draft.id)}>
                            Done
                        </button>
                    </div>
                </div>
            ))}
        </div>
    );
}
