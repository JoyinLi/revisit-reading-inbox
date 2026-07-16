# v0.7 — Manual image cleanup

- Added a delete control to every saved inline image in Reader.
- Added deletion for X website/video/image preview covers.
- Image deletion uses one in-product confirmation dialog.
- Removing an image also removes its item-level preview reference.
- Locally cached files are pruned immediately when no other saved item references them.
- Shared deduplicated files are retained until their final reference is removed.
