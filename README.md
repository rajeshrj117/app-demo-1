# ProcureFlow AI — Firestore-backed demo

This version fixes `/api/rfqs` POST failing on Vercel due to writing local JSON files. The existing UI and readable CSS are preserved.

## Setup
1. Create a Firebase project and enable **Firestore Database**.
2. Firebase Console → Project settings → Service accounts → Generate new private key. **Never commit or upload that JSON key.**
3. Copy `.env.example` to `.env.local` and enter your values. Map the service account JSON `project_id`, `client_email`, `private_key` to `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY`.
4. On Vercel → Project → Settings → Environment Variables, add the same values for Production (and Preview if needed). Redeploy.
5. Run `npm install` then `npm run dev` locally; `npm run build` to verify.

## Security and limitations
- This is a **demo**, not production-ready: the existing API endpoints do not authenticate users or enforce buyer/vendor roles. Anyone who can reach the endpoints can change data. **Do not use for real procurement data or publish publicly without authentication and authorization.**
- Server Admin SDK bypasses Firestore Security Rules; API authorization must be implemented separately.
- The demo uses one Firestore document (`procureflowDemo/workspace`) for compatibility with the existing APIs. Firestore documents have a **1 MiB limit**. Production requires separate collections, role checks, and immutable audit logs.
- Real email reminders, vendor identity, and secure bidding are not implemented.
- `.env.local` is intentionally excluded from the ZIP. Never put service-account private keys in `NEXT_PUBLIC_` variables.
