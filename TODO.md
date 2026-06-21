# TODO

- [ ] Inspect current code for faults causing blank/broken pages
- [x] Found high-confidence fault in `services.js` escaping logic (`escapeHtml` is broken)
- [x] Patch `services.js`: fix `escapeHtml` to correctly escape `& < > " '`
- [x] Patch `post.js`: remove/disable noisy console logging and global error handlers if they are not required
- [ ] Quick sanity check: ensure pages still load without JS module errors
- [ ] Run any available lint/build/test (if present)

