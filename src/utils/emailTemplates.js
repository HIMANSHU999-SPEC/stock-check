export function generateEmailDraft(asset, employee, type = 'assignment') {
    const templates = {
        assignment: {
            subject: `Asset Assignment: ${asset.asset_number} - ${asset.name}`,
            body: `Dear ${employee.name},

This email confirms that the following asset has been assigned to you:

Asset Number: ${asset.asset_number}
Asset Name: ${asset.name}
Category: ${asset.category_name || 'N/A'}
Model: ${asset.model || 'N/A'}
Serial Number: ${asset.serial_number || 'N/A'}

Please acknowledge receipt of this asset and ensure it is properly maintained.

If you have any questions or concerns, please contact the IT department.

Best regards,
London Academy for Applied Technology
IT Asset Management

---
Powered by JH Infotech Stock Management System`
        },
        return: {
            subject: `Asset Return: ${asset.asset_number} - ${asset.name}`,
            body: `Dear ${employee.name},

This email confirms that you need to return the following asset:

Asset Number: ${asset.asset_number}
Asset Name: ${asset.name}
Category: ${asset.category_name || 'N/A'}
Model: ${asset.model || 'N/A'}

Please return this asset to the IT department at your earliest convenience.

Best regards,
London Academy for Applied Technology
IT Asset Management

---
Powered by JH Infotech Stock Management System`
        },
        maintenance: {
            subject: `Asset Maintenance Required: ${asset.asset_number}`,
            body: `Dear ${employee.name},

The following asset assigned to you requires maintenance:

Asset Number: ${asset.asset_number}
Asset Name: ${asset.name}
Category: ${asset.category_name || 'N/A'}

Please contact the IT department to schedule maintenance.

Best regards,
London Academy for Applied Technology
IT Asset Management

---
Powered by JH Infotech Stock Management System`
        }
    };

    return templates[type] || templates.assignment;
}

export function openEmailDraft(to, subject, body, cc) {
    const encodedSubject = encodeURIComponent(subject);
    const encodedBody = encodeURIComponent(body);
    const ccPart = cc ? `&cc=${encodeURIComponent(cc)}` : '';
    const mailtoLink = `mailto:${encodeURIComponent(to)}?subject=${encodedSubject}&body=${encodedBody}${ccPart}`;
    window.location.href = mailtoLink;
}
