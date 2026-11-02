# publish-video: changes after publishing

All commands are `node <skill>/tools/publish.mjs …`, `<skill>` being the publish-video folder.

- **Another text or time** for a scheduled target: `cancel publish/<name> --to <target>`, change `descriptions.json` (then video-descriptions' `check`), `publish` again with the new time. `publish` refuses a target scheduled with other texts until the old post is taken back.
- **All back**: `cancel publish/<name>`. A post that is out is deleted in the app, not here: say so.
- **Another video**: `check <new video> publish/<name>` again; the old one's scheduled posts are taken back first.
