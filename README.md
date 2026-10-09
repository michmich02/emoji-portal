# Emoji Portal

> Gesture-driven expressions and anime effects in the browser.

[**View live demo →**](https://michmich02.github.io/emoji-portal/)

## Overview

Emoji Portal turns hand movement into a playful visual language. The experience combines live camera input, gesture recognition, animated emoji, and layered effects in a compact browser prototype.

## Interaction

- Allow camera access.
- Keep one hand visible in good lighting.
- Move and change gestures to shift the on-screen expression and effects.

## Built with

`JavaScript` · `MediaPipe` · `Canvas` · `CSS`

## Run locally

```sh
python3 -m http.server 8000 --directory docs
```

Open [http://localhost:8000](http://localhost:8000) in a desktop browser. Camera and microphone APIs require localhost or HTTPS; external models and CDN dependencies require an internet connection.

## Design notes

- Immediate visual feedback keeps the gesture-to-effect relationship legible.
- The experience is designed as a focused, full-screen interaction.
- Processing happens in the browser; camera and microphone streams are not uploaded by this project.
