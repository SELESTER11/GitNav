# Privacy Policy for GitNav

**Last Updated:** January 2, 2025

## Overview

GitNav is committed to protecting your privacy. This extension does NOT collect, store, or transmit any personal data to external servers.

## Data Collection

**GitNav collects ZERO personal data.**

## What Data is Stored Locally

The following data is stored **only in your browser's local storage** (never sent anywhere):

1. **GitHub Personal Access Token** (optional)
   - Stored in Chrome's `chrome.storage.local`
   - Used to access private repositories
   - Encrypted by Chrome
   - Only you can access it
   - Can be deleted anytime by removing the extension

2. **Repository Cache** (temporary)
   - Analyzed repository data cached for 30 minutes
   - Stored in browser memory
   - Automatically cleared after 30 minutes
   - Cleared when you close Chrome

## What Data is NOT Collected

-  No personal information
-  No browsing history
-  No analytics or tracking
-  No repository contents sent to external servers
-  No usage statistics
-  No crash reports
-  No cookies

## Permissions Explained

GitNav requests the following Chrome permissions:

### `storage`
**Why:** To securely store your GitHub token locally in your browser  
**Data stored:** GitHub token only  
**Where:** Chrome's local storage (encrypted, never leaves your computer)

### `activeTab`
**Why:** To inject the "Analyze Codebase" button on GitHub pages  
**Access:** Only when you click the button

### `https://github.com/*`
**Why:** To display the extension on GitHub pages  
**Access:** Read-only access to current GitHub page

### `https://api.github.com/*`
**Why:** To fetch repository data from GitHub's API  
**Data sent:** API requests to GitHub (using your token if provided)  
**Data received:** Public repository data from GitHub

## Third-Party Services

GitNav communicates with **only one** external service:

**GitHub API (api.github.com)**
- Purpose: Fetch repository data
- Data sent: Repository name, your GitHub token (if private repo)
- Data received: Public repository information
- Privacy policy: [GitHub Privacy Statement](https://docs.github.com/en/site-policy/privacy-policies/github-privacy-statement)

**No other external services are used.**

## How We Use Data

1. **GitHub Token:** Used only to authenticate API requests to GitHub for private repositories
2. **Repository Cache:** Speeds up repeat visits to the same repository (avoids redundant API calls)

## Data Security

- All data stays in your browser
- GitHub tokens encrypted by Chrome
- No data transmitted to external servers (except GitHub API)
- No backend servers operated by GitNav
- Code is open source - audit it yourself

## Your Rights

You have complete control:

- **View data:** Check Chrome storage at `chrome://extensions` → GitNav → "Inspect views: service worker" → Application → Storage
- **Delete data:** Remove the extension to delete all stored data
- **Opt-out:** Don't provide a GitHub token to avoid storing anything

## Children's Privacy

GitNav does not collect any data from anyone, including children under 13.

## Changes to This Policy

We may update this privacy policy. Changes will be posted on this page with an updated "Last Updated" date.

## Contact

For privacy questions or concerns:
- Email: vkaramchanda@binghamton.edu
- GitHub Issues: https://github.com/SELESTER11/GitNav/issues

## Open Source

GitNav is open source. You can:
- Review the code: https://github.com/SELESTER11/GitNav
- Verify no data is collected
- Submit privacy improvements

---

**Summary:** GitNav respects your privacy. Zero data collection. All processing happens locally in your browser.
```
