# School Management Portal — Starter Project

A blank, responsive school portal starter. No student, staff, fee, attendance or examination records are preloaded. It includes a Node.js/Express server, SQLite database, server-side password hashing, session login, role checks, school branding settings, admin-managed accounts, CRUD modules, automatic exam totals/percentage/grade calculation, report-book generation and a Capacitor Android build workflow.

## Important scope and safety

This is a **starter/MVP, not a certified production school information system**. Before using real learner data, have a developer review and harden it: deploy behind HTTPS, set strong secrets, configure backups and retention, add CSRF protection and audit logs, validate all fields against school policy, review privacy/child-data obligations in your country, and test recovery and concurrency. The current report card uses a configurable generic percentage grade scale (A >=80, B >=70, C >=60, D >=50, E >=40, otherwise F); replace it with your school's official grading rules before issuing reports. It does not integrate a payment provider, SMS/email gateway, biometric attendance, government education APIs or a production file storage service.

## Run locally

1. Install Node.js 20 LTS or newer.
2. Copy `.env.example` to `.env`.
3. Change `SESSION_SECRET`, `ADMIN_EMAIL` and `ADMIN_INITIAL_PASSWORD` in `.env` before starting.
4. Run `npm install`.
5. Run `npm start`.
6. Open `http://localhost:3000`.

The `.env.example` uses the requested admin email `nyakundi1759@gmail.com` and initial password `1759` for first-time setup. Copy it to `.env`, then change `SESSION_SECRET`. The first admin account is created only when the database has no admin and valid `ADMIN_EMAIL` plus `ADMIN_INITIAL_PASSWORD` are set. The admin must change the initial password after sign-in. **Change the weak initial password immediately and do not deploy a public site with it unchanged.** The SQLite database is stored in `server/data/school-portal.sqlite`; do not commit it to GitHub.

## Initial login

Use the admin email and initial password you set in `.env`. **Do not use a public or shared initial password on a live site.** After the first login, change the password and store it securely. Create student accounts from **User accounts**. The student login ID should be the admission number; the portal sets the initial password to that same admission number as requested. Students must change their password after signing in; server access is blocked until that change is completed. This initial-password scheme is weak, so replace it with unique temporary passwords if you want stronger security.

## Deploy online

This project needs a Node.js host that can run Express and persist the SQLite database (or a developer can adapt it to PostgreSQL). GitHub Pages alone cannot run this backend. Deploy the full project to a Node-capable host, set the environment variables from `.env.example`, enable HTTPS, and use persistent storage for `server/data`. Do not commit `.env`, database files or real student data to a public repository.

## Add exam results and generate report books

1. Create student records and user accounts.
2. Add exam sessions, classes and subjects.
3. Open **Exam results → Add result**. In Subject marks, enter JSON such as:

   ```json
   [
     {"subject":"Mathematics","score":78,"outOf":100},
     {"subject":"English","score":65,"outOf":100}
   ]
   ```

4. Save the result. The server calculates total marks, total possible marks, percentage and the generic grade.
5. Open **Report books**, select the student, then choose **Print / Save as PDF**. Report books group saved results by student, term and academic year.

Review the school's official grading policy, subject weighting, missing marks and ranking rules with a qualified school administrator before relying on these reports.

## Android app / APK

The project includes a Capacitor configuration and a GitHub Actions workflow at `.github/workflows/build-android-apk.yml`. To build an Android APK:

1. Deploy the backend first and make sure it uses HTTPS.
2. Edit `public/config.js` and set `window.PORTAL_API_URL` to your deployed backend origin, for example `https://school-portal.example.com` (no trailing slash). The mobile app must reach that server to share records with the web portal.
3. Push the project to GitHub. Open **Actions → Build Android APK → Run workflow** (or trigger the workflow by pushing a change).
4. Download the `school-portal-android-apk` artifact from the completed workflow. It contains a **debug APK for testing**, not a Play Store release.
5. To make the portal's **Download APK** button download a file from your website, copy the built APK to `public/downloads/school-portal.apk`, commit it if appropriate for your distribution model, and redeploy. Do not publish a debug APK as a trusted production app; a production release should be signed and the signing key kept secret.

The Download APK button checks whether the APK file exists and explains what to do if it has not been built yet. A genuine APK cannot be supplied by the web front end alone; Android packaging/building is required. The portal can also be installed as a PWA in compatible browsers.

## Modules included

- Dashboard
- Students; staff; classes/streams; subjects
- Examinations; exam results with automatic totals/percentage/grade; report books
- Attendance; timetable; fees and payments ledger
- Parents/guardians; library; transport; discipline/welfare; documents; announcements
- User accounts and password reset; school profile, logo, cover image, contact details, colours and academic-year settings

Only admin accounts can create/edit/delete records or change school settings. Student accounts can view their own student profile/result data and report books. The starter currently supports staff accounts as provisioned logins, but a separate configurable staff permission matrix should be added before production use.
