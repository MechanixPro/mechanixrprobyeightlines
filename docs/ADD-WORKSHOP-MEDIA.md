# Add photos or videos to /workshop/

The gallery on `/workshop/` and the three-photo teaser on the home page are built from `src/workshop.json`. Adding media is one entry plus the files.

## Privacy rules (check before anything goes on the site)
- Blur every face, including people in the background.
- Cover all number plates (bikes, scooters, cars, also those far away or behind a gate). Use a plate-shaped "MECHANIX PRO / SERVICED" label or heavy pixelation. Zoom in to 200% to check.
- Hide phone numbers painted on walls or boards, customer names, bills, screens and documents.
- Captions describe only what is visible ("Tool wall"). Never claim a photo shows a specific customer job.
- Do not use stock photos or photos of another business.
- Any edit (blur, label, signboard artwork) is noted in the item's `edit` field. The page already says photos are edited for privacy; if you add a new kind of edit, add a sentence to `WS_DISCLOSE_EXTRA` in `scripts/build_pages.py`.

## Add a photo
1. Export a 16:9 image, about 2400 x 1350, JPEG.
2. Pick a file name: lowercase letters, digits and hyphens only, for example `bay-two`.
3. Make two WebP sizes at quality 80 into `assets/img/workshop/`:
   ```
   cwebp -q 80 -resize 1200 0 photo.jpg -o assets/img/workshop/bay-two-1200.webp
   cwebp -q 80 -resize 600 0 photo.jpg -o assets/img/workshop/bay-two-600.webp
   ```
   Keep each 1200 file under about 150 KB and each 600 file under about 60 KB.
4. Add an entry to `items` in `src/workshop.json`:
   ```
   {"id": "bay-two", "file": "bay-two", "kind": "photo", "alt": "What is visible, in one sentence.", "caption": "Short caption", "edit": "Faces blurred."}
   ```
   Add `"teaser": true` to show it in the home teaser (the first three flagged photos are used). The first item in the list is shown large.
5. Rebuild: `BUILD_DATE=<today> python3 scripts/build_pages.py`, then `npm test`.

## Add a video
1. Strip the sound if people talk, blur faces and cover plates in every frame, keep it under about 8 MB and 30 seconds, H.264 MP4.
2. Save as `assets/video/workshop/<name>.mp4` and make a poster `assets/img/workshop/<poster>-1200.webp` (and `-600`).
3. Add `{"id": "...", "file": "<name>", "kind": "video", "poster": "<poster>", "alt": "...", "caption": "...", "edit": "..."}`.
4. Rebuild and test as above. Videos load only when played.

## Check
- `npm test` must pass (it checks that files exist, alt text is present, no phone numbers in captions).
- Look at `/workshop/` at 360 px and 1280 px wide.
