# ViCom Firebase setup

The app uses Firebase Authentication and Cloud Firestore with the existing
`vicom-capstone` project. PHP/MySQL is no longer used by the app pages.

## One-time setup

1. In Firebase Console, enable Authentication > Email/Password.
2. Create the Firestore database if it does not already exist.
3. Publish `firestore.rules` in Firestore Database > Rules.
4. Serve this folder through a local web server such as XAMPP Apache. Do not
   open the pages using `file://`, because Firebase browser modules require a
   web origin.

## Collections

- `users/{uid}` stores the profile fields; credentials and email are managed by
  Firebase Authentication.
- `artworks/{artworkId}` stores public artwork details and a compressed image.
- `artistRates/{rateId}` stores public service types, descriptions, and rates;
  only the artist who owns a rate can create, update, or delete it.
- `commissions/{commissionId}` stores the request and five-stage progress data.
- `commissions/{commissionId}/messages/{messageId}` stores commission chat.
- `users/{uid}/notifications/{notificationId}` stores private notifications.

Artwork and commission images are compressed in the browser before they are
stored in Firestore documents. No Firebase Storage bucket is required.

## Existing MySQL data

Changing the app backend does not import records from `vicom_database`. Users
must create new accounts with Firebase Authentication; existing MySQL password
hashes cannot be used to sign in to Firebase Auth. Existing artwork and
commission records also need an explicit migration if they should appear in the
Firestore project. The old SQL files and `api.php` are retained as reference,
but the migrated pages no longer call them.