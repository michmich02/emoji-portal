# Emoji Portal

A browser-based interactive creative coding experiment by Michelle Guan.

## Live demo

https://michmich02.github.io/emoji-portal/

## Run locally

```sh
python3 -m http.server 8000 --directory docs
```

Open http://localhost:8000. Camera access requires localhost or HTTPS. Use a desktop browser and good lighting; allow camera or microphone access when the experience asks for it. External models and CDN scripts require internet access.

## Files

The root contains the project source. `docs/` contains the prepared static demo.

## Publishing

Enable GitHub Pages with **Deploy from a branch**, branch **main**, folder **/docs**.

Camera, microphone and gesture behavior should be verified on the target device.
