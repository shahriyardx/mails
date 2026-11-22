# Install and offline use

Mails is an installable app (a PWA). It opens and shows your mail with no
connection.

## Install it

- **Chrome, Edge:** open Mails, then click the install icon at the right of
  the address bar (or menu → **Install Mails**).
- **Android:** menu → **Add to Home screen**.
- **iPhone, iPad (Safari):** Share → **Add to Home Screen**.

The installed app has its own window and icon. It is the same site, so you
stay signed in.

## What works offline

| Works offline | Needs a connection |
| --- | --- |
| Open the app | Send mail |
| Every list and conversation you already opened | Search |
| The newest 50 conversations in the Inbox, even unopened | Lists and conversations you never opened |
| Sender pictures and attachments you already opened | Settings changes |
| Archive, Trash, Star, Read, Labels, Snooze | Remote images in mail |

A note at the bottom says **Offline · showing saved mail**.

Actions you take offline wait on this device, also after a reload. The note
counts them ("1 change waits"). They run when the connection comes back.

Writing mail offline: the composer stays open with your text. **Send** shows
an error and never sends by itself later. Send again when you are back
online.

## Updates

When a new version of Mails is out, a message says **A new version of Mails
is ready**. Click **Reload** to use it. Nothing reloads in the middle of your
work.

## Privacy

Saved mail stays only in this browser on this device (IndexedDB and the
service worker cache). It is kept for up to 7 days without a refresh.

**Sign out** deletes all of it. If the server ends your session, the saved
mail is deleted the next time the app reaches the server.

Do not sign in on a shared computer unless you sign out after.
