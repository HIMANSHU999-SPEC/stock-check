const nodemailer = require('nodemailer');
const db = require('../database');

function getEmailSettings() {
    const row = db.prepare("SELECT value FROM settings WHERE key = 'email_settings'").get();
    if (!row) return null;
    try { return JSON.parse(row.value); } catch { return null; }
}

function createTransporter(settings) {
    return nodemailer.createTransport({
        host: settings.host,
        port: settings.port || 587,
        secure: settings.port === 465,
        auth: {
            user: settings.user,
            pass: settings.pass
        },
        tls: { rejectUnauthorized: false }
    });
}

async function sendEmail({ to, subject, html, text }) {
    const settings = getEmailSettings();
    if (!settings || !settings.enabled || !settings.host || !settings.user) {
        return { skipped: true, reason: 'Email not configured or disabled' };
    }
    const transporter = createTransporter(settings);
    const info = await transporter.sendMail({
        from: settings.from || settings.user,
        to,
        subject,
        html,
        text
    });
    return { sent: true, messageId: info.messageId };
}

async function sendAssetAssigned({ asset, employee, assignedBy }) {
    return sendEmail({
        to: employee.email,
        subject: `Asset Assigned: ${asset.name} (${asset.asset_number})`,
        html: `
            <h2>Asset Assignment Notification</h2>
            <p>Dear ${employee.name},</p>
            <p>The following asset has been assigned to you:</p>
            <table style="border-collapse:collapse;width:100%">
                <tr><td style="padding:6px;border:1px solid #ddd"><strong>Asset Number</strong></td><td style="padding:6px;border:1px solid #ddd">${asset.asset_number}</td></tr>
                <tr><td style="padding:6px;border:1px solid #ddd"><strong>Name</strong></td><td style="padding:6px;border:1px solid #ddd">${asset.name}</td></tr>
                <tr><td style="padding:6px;border:1px solid #ddd"><strong>Model</strong></td><td style="padding:6px;border:1px solid #ddd">${asset.model || 'N/A'}</td></tr>
                <tr><td style="padding:6px;border:1px solid #ddd"><strong>Serial Number</strong></td><td style="padding:6px;border:1px solid #ddd">${asset.serial_number || 'N/A'}</td></tr>
            </table>
            <p>Assigned by: ${assignedBy || 'IT Support'}</p>
            <p>Please acknowledge receipt by replying to this email.</p>
            <br><p>Regards,<br>IT Support Team<br>London Academy for Applied Technology</p>
        `
    });
}

async function sendAssetReturned({ asset, employee, returnedBy }) {
    return sendEmail({
        to: employee.email,
        subject: `Asset Returned: ${asset.name} (${asset.asset_number})`,
        html: `
            <h2>Asset Return Confirmation</h2>
            <p>Dear ${employee.name},</p>
            <p>The following asset has been returned and is no longer assigned to you:</p>
            <table style="border-collapse:collapse;width:100%">
                <tr><td style="padding:6px;border:1px solid #ddd"><strong>Asset Number</strong></td><td style="padding:6px;border:1px solid #ddd">${asset.asset_number}</td></tr>
                <tr><td style="padding:6px;border:1px solid #ddd"><strong>Name</strong></td><td style="padding:6px;border:1px solid #ddd">${asset.name}</td></tr>
                <tr><td style="padding:6px;border:1px solid #ddd"><strong>Model</strong></td><td style="padding:6px;border:1px solid #ddd">${asset.model || 'N/A'}</td></tr>
            </table>
            <p>Processed by: ${returnedBy || 'IT Support'}</p>
            <br><p>Regards,<br>IT Support Team<br>London Academy for Applied Technology</p>
        `
    });
}

async function sendAssetMaintenance({ asset, notes }) {
    const settings = getEmailSettings();
    if (!settings || !settings.admin_email) return { skipped: true, reason: 'No admin email configured' };
    return sendEmail({
        to: settings.admin_email,
        subject: `Asset Maintenance Alert: ${asset.name} (${asset.asset_number})`,
        html: `
            <h2>Asset Maintenance Notification</h2>
            <p>An asset has been marked for maintenance:</p>
            <table style="border-collapse:collapse;width:100%">
                <tr><td style="padding:6px;border:1px solid #ddd"><strong>Asset Number</strong></td><td style="padding:6px;border:1px solid #ddd">${asset.asset_number}</td></tr>
                <tr><td style="padding:6px;border:1px solid #ddd"><strong>Name</strong></td><td style="padding:6px;border:1px solid #ddd">${asset.name}</td></tr>
                <tr><td style="padding:6px;border:1px solid #ddd"><strong>Model</strong></td><td style="padding:6px;border:1px solid #ddd">${asset.model || 'N/A'}</td></tr>
                <tr><td style="padding:6px;border:1px solid #ddd"><strong>Notes</strong></td><td style="padding:6px;border:1px solid #ddd">${notes || 'N/A'}</td></tr>
            </table>
            <br><p>Regards,<br>Stock Management System</p>
        `
    });
}

module.exports = { sendEmail, sendAssetAssigned, sendAssetReturned, sendAssetMaintenance, getEmailSettings };
