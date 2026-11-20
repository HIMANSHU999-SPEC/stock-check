# Microsoft 365 setup

Single sign-on, outgoing email and the SharePoint list all use **one** app
registration in Microsoft Entra ID. Each feature switches on by itself once
its piece is in place, and **Settings → Microsoft 365** in the app shows
exactly what is still missing.

You need to be a Global Administrator (or Application Administrator plus
someone who can grant admin consent).

## 1. Register the app

1. Open <https://entra.microsoft.com> → **Identity → Applications → App registrations → New registration**.
2. **Name:** `Stock Management System`
3. **Supported account types:** *Accounts in this organizational directory only (single tenant)*.
4. **Redirect URI:** platform **Web**, value

   ```
   https://YOUR-STOCK-ADDRESS/api/auth/sso/callback
   ```

   Use the address staff type to reach the system, exactly, with `https`.
   (The app shows the precise value under Settings once `APP_BASE_URL` is set.)
5. **Register.**

From the **Overview** page copy:

| Entra field | Goes in `.env` as |
|---|---|
| Application (client) ID | `ENTRA_CLIENT_ID` |
| Directory (tenant) ID | `ENTRA_TENANT_ID` |

## 2. Create a client secret

**Certificates & secrets → Client secrets → New client secret.** Pick an expiry
(note it in your calendar — sign-in, email and sync all stop when it lapses),
then copy the **Value** (not the Secret ID) straight away into
`ENTRA_CLIENT_SECRET`. It is shown only once.

## 3. Grant permissions

**API permissions → Add a permission → Microsoft Graph.**

| Feature | Type | Permission |
|---|---|---|
| Sign in with Microsoft | Delegated | `openid`, `profile`, `email` |
| Send email | **Application** | `Mail.Send` |
| SharePoint list | **Application** | `Sites.ReadWrite.All` |
| Leaver check (Staff reports) | **Application** | `User.Read.All` |
| Intune check | **Application** | `DeviceManagementManagedDevices.Read.All` |

Then click **Grant admin consent for <your organisation>**. Every row should
show a green tick. Skip a row if you are not using that feature.

### Recommended: limit which mailbox the app can send from

`Mail.Send` as an application permission lets the app send as *any* mailbox in
the tenant. Restrict it to the IT support mailbox in Exchange Online
PowerShell:

```powershell
Connect-ExchangeOnline
# A mail-enabled security group containing only the mailbox the app may use
New-ApplicationAccessPolicy -AppId <ENTRA_CLIENT_ID> `
  -PolicyScopeGroupId stock-system-senders@yourdomain.ac.uk `
  -AccessRight RestrictAccess `
  -Description "Stock system may only send as IT Support"
Test-ApplicationAccessPolicy -AppId <ENTRA_CLIENT_ID> -Identity itsupport@yourdomain.ac.uk
```

Microsoft is replacing application access policies with *RBAC for
Applications*; either works. Check Microsoft's current guidance before
relying on one.

### Recommended: limit who can sign in

**Enterprise applications → Stock Management System → Properties →
Assignment required? = Yes**, then add the IT team under **Users and groups**.
The app has its own gate as well: only people listed under **Users** in the
stock system are let in, whoever they are in Entra.

## 4. Configure the server

On the server, in the app directory:

```bash
cp .env.example .env
nano .env            # fill in AUTH_SECRET, APP_BASE_URL and the three ENTRA_ values
chmod 600 .env
pm2 restart stock-backend --update-env
```

`AUTH_SECRET` must be set (`openssl rand -hex 32`). Without it login sessions
are signed with a default that is public in the source code, and single
sign-on stays switched off. Setting it signs everyone out once.

nginx needs nothing new as long as it already proxies `/api/` to the backend
and serves `index.html` for unknown paths (`try_files $uri /index.html;`) —
the sticker links (`/s/AST-…`) rely on that.

## 5. Finish in the app

Sign in as an administrator and open **Settings**.

1. **Single sign-on** should say *On*. Add each member of the IT team under
   **Users** with their work email (leave the password blank). Open a private
   browser window and try **Sign in with Microsoft**.
2. **Email:** check *Send from*, press **Send test email**. If it fails the
   message says why — almost always `Mail.Send` consent or the access policy.
   The wording of every email is under **Email templates**.
3. **SharePoint list:** paste the site address, tick *Keep the SharePoint list
   up to date*, **Save**, then **Test connection** (this creates the list) and
   **Sync everything now**.

4. **Intune check:** open **Assets → Intune check**. It reads Intune's device
   list (read-only: the permission cannot change anything in Intune) and
   compares it with the register by serial number. If it says Microsoft 365
   denied the request, `DeviceManagementManagedDevices.Read.All` is missing or
   has no admin consent.

Once everybody signs in with Microsoft, set `DISABLE_PASSWORD_LOGIN=true` in
`.env` and restart. Remove it again if you ever need a password to get back in.

## Troubleshooting

| Symptom | Cause |
|---|---|
| `AADSTS50011` redirect URI mismatch | The Redirect URI in Entra differs from `APP_BASE_URL` + `/api/auth/sso/callback` (check `http` vs `https`, `www`, trailing slash). |
| "…has not been given access" after signing in | The person signed in fine but is not listed under **Users**, or is listed under a different email address. |
| `AADSTS7000215` invalid client secret | The secret *ID* was copied instead of the *Value*, or the secret has expired. |
| Email: "Microsoft 365 denied the request" | `Mail.Send` has no admin consent, or the access policy does not include the *Send from* mailbox. |
| SharePoint: "The provided path does not exist" | The site address is wrong — copy it from the browser when on the site's home page. |
| SharePoint: access denied | `Sites.ReadWrite.All` has no admin consent. |
| Intune check: "Microsoft 365 denied the request" | `DeviceManagementManagedDevices.Read.All` (application) is not added, or has no admin consent. Consent can take a few minutes to take effect. |
| Intune check: a device shows as "Not in Intune" although it is enrolled | The serial number on the asset differs from the one Intune reports. Search the Intune device name under *Not in the register* and correct the asset. |
