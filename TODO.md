# TODO - Firebase Storage image uploads (HUSTLR)

- [x] Update Firebase initialization to export `storage` instance from `firebase.js`.
- [x] Update `post.html` to use file input for image upload (no URL paste).
- [x] Update `post.js` to:

  - [x] Validate client file type + size
  - [x] Upload to Storage at `services/{uid}/{timestamp_filename}`
  - [x] Retrieve download URL
  - [x] Save Firestore doc with `imageUrl`
  - [x] Add loading/error UI and disable submit during upload.
- [x] Update `services.js` to render `imageUrl` in cards.
- [x] Update `dashboard.js` to render `imageUrl` in “My Services” cards.
- [x] Review for any other pages that reference the `image`/`imageUrl` fields and update them.
- [ ] Add/adjust any CSS for image thumbnails (if necessary).
- [ ] Verify Firebase Storage + Firestore security rules compatibility and list required rule patterns.

